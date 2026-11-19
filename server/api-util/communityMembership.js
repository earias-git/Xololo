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
  isSellerInCommunity,
  isValidCommunityType,
  isValidCommunityId,
} = require('../../src/util/communities');
const communitiesService = require('./communitiesService');

// Lee el profile del seller. Devuelve {profile, publicData, raw}.
const _fetchSellerProfile = async (isdk, sellerId) => {
  const resp = await isdk.users.show({ id: sellerId });
  const user = resp.data.data;
  const profile = user.attributes?.profile || {};
  const publicData = profile.publicData || {};
  return { profile, publicData, raw: user };
};

// Actualiza el mirror en TODOS los listings published del seller.
// Mejor-esfuerzo: errores por listing se loggean, no se abortan.
// Devuelve stats {updated, failed, total}.
const _syncListingsMirror = async ({ isdk, sellerId, newMirror }) => {
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
      try {
        await isdk.listings.update({
          id: listingId,
          publicData: { sellerCommunities: newMirror },
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

  // Sync mirror en los listings.
  const stats = await _syncListingsMirror({ isdk, sellerId, newMirror });

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

  const stats = await _syncListingsMirror({ isdk, sellerId, newMirror });
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

module.exports = {
  joinCommunity,
  leaveCommunity,
  listSellerMemberships,
};
