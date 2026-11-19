// XOLOLO 2026-11-18 — ADR-006 PR-3: service de membership + mirror.
//
// Core lógico de join/leave + sincronización del espejo en los
// listings del seller.
//
// Flujo join(sellerId, communityId, type):
//   1. Leer profile actual del seller via Integration SDK.
//   2. Idempotencia: si ya pertenece, no-op (return 200).
//   3. Actualizar profile.publicData.communities (helper inmutable).
//   4. Calcular nuevo mirror = flat ids de los 3 arrays.
//   5. updateProfile del user.
//   6. Para TODOS los listings published del seller, update
//      publicData.sellerCommunities = nuevo mirror.
//      Mejor-esfuerzo: si uno falla, log y sigue (consistencia
//      eventual; cron de PR-5 corregirá drift).
//   7. Invalida cache de communitiesService.
//
// Flujo leave: idéntico pero con remove + mirror recalculado.
//
// LOCKED (ver docs/MODEL_COMMUNITIES_V1.md §7):
//   - profile es la fuente de verdad. Si el mirror diverge, el
//     profile gana y el cron corrige.
//   - NO escribir sellerCommunities desde la UI del wizard de
//     listing — solo este helper lo hace.
//   - Si el seller NO pertenece a ninguna comunidad post-leave,
//     sellerCommunities queda como [] (no undefined) para que la
//     query Sharetribe pub_sellerCommunities:has:opf siga
//     funcionando.

const { getIntegrationSdk } = require('./integrationSdk');
const {
  addCommunityMembership,
  removeCommunityMembership,
  getListingCommunityMirror,
  computeMirrorForListing,
  isSellerInCommunity,
  isValidCommunityType,
  isValidCommunityId,
} = require('../../src/util/communities');
const communitiesService = require('./communitiesService');

// Lee el profile del seller. Devuelve {profile, publicData, raw}.
// XOLOLO 2026-11-19: fields.user explícito. Sin él, publicData puede
// no venir populado por el Integration SDK y getCommunitiesForType
// devolvería [] aunque el user esté unido a comunidades. Mismo pitfall
// que listings.show sin include:['author'].
const _fetchSellerProfile = async (isdk, sellerId) => {
  const resp = await isdk.users.show({
    id: sellerId,
    'fields.user': [
      'profile.displayName',
      'profile.abbreviatedName',
      'profile.publicData',
      'profile.metadata',
    ],
  });
  const user = resp.data.data;
  const profile = user.attributes?.profile || {};
  const publicData = profile.publicData || {};
  return { profile, publicData, raw: user };
};

// Actualiza el mirror en TODOS los listings published del seller.
// Mejor-esfuerzo: errores por listing se loggean, no se abortan.
//
// XOLOLO 2026-11-19 — respeta el modo opt-in/opt-out por comunidad:
//   - Sectoriales (OPF) default opt-in: el listing NO aparece a menos
//     que esté en includeInCommunities[].
//   - Geográficas default opt-out: aparece salvo que esté en
//     excludeFromCommunities[].
// Recibe el catalog para resolver el modo de cada comunidad.
//
// Devuelve stats {updated, failed, total}.
const _syncListingsMirror = async ({ isdk, sellerId, profile, catalog = [] }) => {
  let page = 1;
  let updated = 0;
  let failed = 0;
  let total = 0;

  while (page <= 10) {
    let resp;
    try {
      resp = await isdk.listings.query({
        authorId: sellerId,
        perPage: 100,
        page,
        states: ['published', 'closed', 'pendingApproval'],
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[communityMembership:syncMirror] listings.query failed p', page, e?.message);
      break;
    }

    const data = resp.data?.data || [];
    const meta = resp.data?.meta || {};
    total += data.length;

    for (const l of data) {
      const listingId = l.id?.uuid;
      if (!listingId) continue;
      // Mirror específico para este listing — respeta su modo
      // opt-in/opt-out según el type de cada comunidad del seller.
      const perListingMirror = computeMirrorForListing(
        profile,
        l.attributes?.publicData || {},
        catalog
      );
      try {
        await isdk.listings.update({
          id: listingId,
          publicData: { sellerCommunities: perListingMirror },
        });
        updated += 1;
      } catch (e) {
        failed += 1;
        // eslint-disable-next-line no-console
        console.error(
          '[communityMembership:syncMirror] listings.update failed',
          listingId,
          e?.message
        );
      }
    }

    if (data.length < 100 || page >= (meta.totalPages || 1)) break;
    page += 1;
  }

  return { updated, failed, total };
};

/**
 * Agrega al seller a una comunidad y sincroniza el mirror.
 *
 * @param {string} sellerId
 * @param {{id: string, type: string}} community
 * @returns {Promise<{status, mirror, stats, alreadyMember?}>}
 */
const joinCommunity = async (sellerId, community) => {
  if (!sellerId) throw new Error('missing_seller_id');
  if (!community?.id || !isValidCommunityId(community.id)) {
    throw new Error('invalid_community_id');
  }
  if (!isValidCommunityType(community.type)) {
    throw new Error('invalid_community_type');
  }

  const isdk = getIntegrationSdk();
  if (!isdk) throw new Error('integration_api_missing');

  const { profile, publicData } = await _fetchSellerProfile(isdk, sellerId);

  // Idempotencia.
  if (isSellerInCommunity(profile, community)) {
    const currentMirror = getListingCommunityMirror(profile);
    return {
      status: 'already_member',
      mirror: currentMirror,
      stats: { updated: 0, failed: 0, total: 0 },
      alreadyMember: true,
    };
  }

  // Actualizar profile.
  const newCommunities = addCommunityMembership(publicData, community);
  const newProfile = { ...profile, publicData: { ...publicData, communities: newCommunities } };
  const newMirror = getListingCommunityMirror(newProfile);

  await isdk.users.updateProfile({
    id: sellerId,
    publicData: { communities: newCommunities },
  });

  // Sync mirror en los listings — respeta include/exclude por listing
  // + catálogo (modo opt-in para sectoriales, opt-out para geográficas).
  const catalog = communitiesService.getAllRaw();
  const stats = await _syncListingsMirror({
    isdk,
    sellerId,
    profile: newProfile,
    catalog,
  });

  // Invalida cache del service público.
  communitiesService.invalidateCache();

  return { status: 'joined', mirror: newMirror, stats };
};

/**
 * Quita al seller de una comunidad y sincroniza el mirror.
 */
const leaveCommunity = async (sellerId, community) => {
  if (!sellerId) throw new Error('missing_seller_id');
  if (!community?.id || !isValidCommunityId(community.id)) {
    throw new Error('invalid_community_id');
  }
  if (!isValidCommunityType(community.type)) {
    throw new Error('invalid_community_type');
  }

  const isdk = getIntegrationSdk();
  if (!isdk) throw new Error('integration_api_missing');

  const { profile, publicData } = await _fetchSellerProfile(isdk, sellerId);

  if (!isSellerInCommunity(profile, community)) {
    return {
      status: 'not_member',
      mirror: getListingCommunityMirror(profile),
      stats: { updated: 0, failed: 0, total: 0 },
    };
  }

  const newCommunities = removeCommunityMembership(publicData, community);
  const newProfile = { ...profile, publicData: { ...publicData, communities: newCommunities } };
  const newMirror = getListingCommunityMirror(newProfile);

  await isdk.users.updateProfile({
    id: sellerId,
    publicData: { communities: newCommunities },
  });

  const catalog = communitiesService.getAllRaw();
  const stats = await _syncListingsMirror({
    isdk,
    sellerId,
    profile: newProfile,
    catalog,
  });
  communitiesService.invalidateCache();

  return { status: 'left', mirror: newMirror, stats };
};

/**
 * Lista las comunidades del seller con metadata pública.
 * @param {string} sellerId
 * @returns {Promise<Array<{id, type, ...public}>>}
 */
const listSellerMemberships = async sellerId => {
  if (!sellerId) throw new Error('missing_seller_id');
  const isdk = getIntegrationSdk();
  if (!isdk) throw new Error('integration_api_missing');

  const { profile } = await _fetchSellerProfile(isdk, sellerId);
  const communitiesObj = profile?.publicData?.communities || {};
  const out = [];
  for (const type of ['sectorial', 'modelo', 'geografica']) {
    const arr = Array.isArray(communitiesObj[type]) ? communitiesObj[type] : [];
    for (const id of arr) {
      if (!isValidCommunityId(id)) continue;
      const community = communitiesService.getBySlugPublic(id, type);
      if (community) {
        out.push(community);
      } else {
        // La comunidad existe en el profile pero ya no está en el
        // catálogo (deleted o unpublished). Devuelve un stub para
        // que la UI pueda mostrar "quedaste en una comunidad que
        // ya no existe" en vez de ocultarla.
        out.push({ id, type, name: id, _stale: true });
      }
    }
  }
  return out;
};

/**
 * XOLOLO 2026-11-19 — Setter de inclusiones/exclusiones por listing.
 *
 * El seller puede marcar explícitamente en qué comunidades aparece
 * ESTE listing. Dos modos:
 *   - includeInCommunities[]: opt-in (sectoriales como OPF). El
 *     listing SOLO aparece si está aquí.
 *   - excludeFromCommunities[]: opt-out (geográficas como Morelos).
 *     El listing aparece salvo que esté aquí.
 *
 * El modo real se resuelve community por community según su
 * listingDefaultInclusion ('opt-in' | 'opt-out', default por type).
 *
 * Valida que:
 * - El listing pertenece al seller (o es colaborador activo del
 *   Negocio dueño).
 * - Las ids en include/exclude son válidas y existen en las
 *   memberships del seller (no se puede opt-in/opt-out a una
 *   comunidad a la que el seller no pertenece).
 *
 * @param {object} args
 * @param {string} args.sellerId — currentUser.id (puede ser colaborador)
 * @param {string} args.listingId
 * @param {string[]} [args.includeInCommunities]
 * @param {string[]} [args.excludeFromCommunities]
 * @returns {Promise<{included, excluded, mirror, profileMirror}>}
 */
const setListingCommunities = async ({
  sellerId,
  listingId,
  includeInCommunities,
  excludeFromCommunities,
}) => {
  if (!sellerId) throw new Error('missing_seller_id');
  if (!listingId) throw new Error('missing_listing_id');
  // Al menos uno debe venir; ambos deben ser arrays si vienen.
  if (includeInCommunities !== undefined && !Array.isArray(includeInCommunities)) {
    throw new Error('invalid_include_list');
  }
  if (excludeFromCommunities !== undefined && !Array.isArray(excludeFromCommunities)) {
    throw new Error('invalid_exclude_list');
  }
  if (includeInCommunities === undefined && excludeFromCommunities === undefined) {
    throw new Error('missing_include_or_exclude');
  }

  const isdk = getIntegrationSdk();
  if (!isdk) throw new Error('integration_api_missing');

  // XOLOLO 2026-11-19: include=['author'] es imprescindible para que
  // relationships.author.data.id.uuid venga poblado. Sin él, el ownership
  // check siempre fallaba con not_listing_owner.
  const listingResp = await isdk.listings.show({
    id: listingId,
    include: ['author'],
  });
  const listing = listingResp.data.data;
  const authorId = listing.relationships?.author?.data?.id?.uuid;
  if (!authorId) {
    throw new Error('author_not_found');
  }

  // XOLOLO 2026-11-19: ownership flexible — el currentUser es dueño si:
  //   a) es directamente el author, o
  //   b) es colaborador con workspace activo en el author (modo Equipo).
  // El target del update es siempre el author (el Negocio real).
  if (sellerId !== authorId) {
    // Soporte colaborador: ver si el currentUser tiene workspace activo
    // con el author.
    const currentUserResp = await isdk.users.show({ id: sellerId });
    const currentUser = currentUserResp.data?.data;
    const workspaces =
      currentUser?.attributes?.profile?.publicData?.xololoWorkspaces?.workspaces || [];
    const activeWs = workspaces.find(
      ws => ws?.adminId === authorId && ws?.status === 'active'
    );
    if (!activeWs) {
      throw new Error('not_listing_owner');
    }
    // OK: es colaborador. El target del profile/mirror es el author.
  }

  // Traer profile del Negocio (author) para calcular el mirror correcto.
  const { profile } = await _fetchSellerProfile(isdk, authorId);
  const sellerMemberships = new Set(getListingCommunityMirror(profile));

  // XOLOLO 2026-11-19 — diagnostic log para debug del bug reportado
  // por earias (sanitize silencioso). Muestra en server log:
  // - currentUser id (el que hace el PATCH)
  // - author id (del listing)
  // - memberships del Negocio dueño
  // - ids pedidas vs ids sanitizadas
  // eslint-disable-next-line no-console
  console.log(
    `[setListingCommunities] listingId=${listingId} currentUserId=${sellerId} authorId=${authorId} businessMemberships=${JSON.stringify(
      Array.from(sellerMemberships)
    )} requestedInclude=${JSON.stringify(includeInCommunities || [])} requestedExclude=${JSON.stringify(
      excludeFromCommunities || []
    )}`
  );

  // Sanitizar: ids válidas Y que el seller tenga membership.
  const listingPd = listing.attributes?.publicData || {};
  const sanitize = arr => {
    if (!Array.isArray(arr)) return undefined;
    return arr
      .filter(isValidCommunityId)
      .filter(id => sellerMemberships.has(id));
  };

  // Si el campo no se pasó explícito, preservamos el valor actual
  // del listing (upsert parcial).
  const sanitizedInclude =
    includeInCommunities !== undefined
      ? sanitize(includeInCommunities)
      : (Array.isArray(listingPd.includeInCommunities)
          ? listingPd.includeInCommunities.filter(isValidCommunityId)
          : []);
  const sanitizedExclude =
    excludeFromCommunities !== undefined
      ? sanitize(excludeFromCommunities)
      : (Array.isArray(listingPd.excludeFromCommunities)
          ? listingPd.excludeFromCommunities.filter(isValidCommunityId)
          : []);

  // Mirror esperado para este listing con los nuevos include/exclude
  // + catálogo.
  const catalog = communitiesService.getAllRaw();
  const newListingPd = {
    ...listingPd,
    includeInCommunities: sanitizedInclude,
    excludeFromCommunities: sanitizedExclude,
  };
  const newMirror = computeMirrorForListing(profile, newListingPd, catalog);

  // XOLOLO 2026-11-19 — log adicional para el bug persistente.
  // eslint-disable-next-line no-console
  console.log(
    `[setListingCommunities:result] listingId=${listingId} sanitizedInclude=${JSON.stringify(
      sanitizedInclude
    )} sanitizedExclude=${JSON.stringify(sanitizedExclude)} newMirror=${JSON.stringify(
      newMirror
    )} catalogSize=${catalog.length} profileHasCommunities=${JSON.stringify(
      profile?.publicData?.communities || null
    )}`
  );

  await isdk.listings.update({
    id: listingId,
    publicData: {
      includeInCommunities: sanitizedInclude,
      excludeFromCommunities: sanitizedExclude,
      sellerCommunities: newMirror,
    },
  });

  // Invalida cache del service público (las landings pueden
  // cambiar por el flip).
  communitiesService.invalidateCache();

  return {
    included: sanitizedInclude,
    excluded: sanitizedExclude,
    mirror: newMirror,
    profileMirror: Array.from(sellerMemberships),
  };
};

module.exports = {
  joinCommunity,
  leaveCommunity,
  listSellerMemberships,
  setListingCommunities,
};
