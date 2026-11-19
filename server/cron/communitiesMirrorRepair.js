// XOLOLO 2026-11-18 — ADR-006 PR-5: cron de reparación del mirror
// listing.publicData.sellerCommunities ← profile.publicData.communities.
//
// Por qué existe:
//  - PR-3 escribe el mirror en cada join/leave con mejor-esfuerzo.
//    Si un listings.update falla, queda drift.
//  - Un seller puede editar un listing via wizard SIN disparar el
//    thunk de community (p.ej. pega un `publicData` custom). El
//    mirror puede quedar sin inclusión del community.
//  - Comunidades borradas del seed deben salir del mirror también.
//
// Qué hace:
//  1. Pagina users (hasta 10 páginas de 100).
//  2. Por cada user, calcula expectedMirror = getListingCommunityMirror.
//  3. Pagina sus listings (hasta 10 páginas de 100).
//  4. Si listing.publicData.sellerCommunities !== expectedMirror,
//     listings.update con el nuevo valor.
//  5. Reporta stats {usersScanned, listingsScanned, listingsUpdated,
//     listingsSkipped, errors}.
//
// Diseñado para ejecutarse via Render Cron o manual (ver
// scripts/communities-mirror-repair.js). Idempotente: correrlo 2
// veces seguidas la segunda no cambia nada.

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const communitiesService = require('../api-util/communitiesService');
const {
  computeMirrorForListing,
  isValidCommunityId,
} = require('../../src/util/communities');

// Compara arrays de strings sin importar el orden. Ambos deben ser
// listas planas (sin duplicados). Devuelve true si representan el
// mismo conjunto.
const sameSet = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const aSorted = [...a].sort();
  const bSorted = [...b].sort();
  for (let i = 0; i < aSorted.length; i++) {
    if (aSorted[i] !== bSorted[i]) return false;
  }
  return true;
};

const _pageUsers = async (isdk, maxPages = 10) => {
  const users = [];
  for (let page = 1; page <= maxPages; page++) {
    let resp;
    try {
      resp = await isdk.users.query({ perPage: 100, page });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[mirrorRepair] users.query failed p', page, e?.message);
      break;
    }
    const data = resp.data?.data || [];
    users.push(...data);
    if (data.length < 100) break;
  }
  return users;
};

const _pageSellerListings = async (isdk, sellerId, maxPages = 10) => {
  const listings = [];
  for (let page = 1; page <= maxPages; page++) {
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
      console.error('[mirrorRepair] listings.query failed', sellerId, 'p', page, e?.message);
      break;
    }
    const data = resp.data?.data || [];
    listings.push(...data);
    if (data.length < 100) break;
  }
  return listings;
};

/**
 * Ejecuta un pase de reparación del mirror.
 * @param {object} opts
 * @param {boolean} opts.dryRun — si true, no hace writes, solo reporta.
 * @param {object} opts.isdk — Integration SDK (default lo resuelve).
 * @returns {Promise<{usersScanned, listingsScanned, listingsUpdated, listingsSkipped, errors, drift: Array}>}
 */
const repairMirror = async ({ dryRun = false, isdk = null } = {}) => {
  const sdk = isdk || getIntegrationSdk();
  if (!sdk) throw new Error('integration_api_missing');

  const stats = {
    usersScanned: 0,
    usersWithMemberships: 0,
    listingsScanned: 0,
    listingsUpdated: 0,
    listingsSkipped: 0,
    errors: 0,
    drift: [], // sample de hasta 20 drifts encontrados para log
    startedAt: new Date().toISOString(),
    dryRun,
  };

  // Catálogo con el modo de inclusión por comunidad (opt-in/opt-out).
  // Se lee una vez por run y se pasa al helper por listing.
  const catalog = communitiesService.getAllRaw();

  const users = await _pageUsers(sdk);
  stats.usersScanned = users.length;

  for (const user of users) {
    const userId = user.id?.uuid;
    if (!userId) continue;

    const profile = user.attributes?.profile || {};
    const communities = profile?.publicData?.communities;
    // Si el user no tiene communities, su mirror esperado es []. Pero
    // sólo procesamos este caso si alguno de sus listings tiene
    // sellerCommunities != [] (probablemente drift legacy). Para no
    // escanear a TODOS los users sin memberships, los saltamos. El
    // thunk de leave ya vacía el mirror; sólo quedarían drifts muy
    // antiguos aquí, cubiertos por un recorrido ocasional con
    // --scan-empty (no implementado en V1).
    const hasAnyMembership =
      communities &&
      ['sectorial', 'modelo', 'geografica'].some(
        t => Array.isArray(communities[t]) && communities[t].length > 0
      );
    if (!hasAnyMembership) continue;

    stats.usersWithMemberships += 1;

    const listings = await _pageSellerListings(sdk, userId);
    stats.listingsScanned += listings.length;

    for (const l of listings) {
      const listingId = l.id?.uuid;
      if (!listingId) continue;
      // XOLOLO 2026-11-19 — mirror esperado POR LISTING (respeta
      // include/exclude + modo opt-in/opt-out según catalog).
      const pd = l.attributes?.publicData || {};
      const expectedMirror = computeMirrorForListing(profile, pd, catalog).filter(
        isValidCommunityId
      );
      const current = pd.sellerCommunities || [];
      if (sameSet(current, expectedMirror)) {
        stats.listingsSkipped += 1;
        continue;
      }
      if (stats.drift.length < 20) {
        stats.drift.push({ listingId, from: current, to: expectedMirror });
      }
      if (dryRun) {
        stats.listingsUpdated += 1; // cuenta como "sería actualizado"
        continue;
      }
      try {
        await sdk.listings.update({
          id: listingId,
          publicData: { sellerCommunities: expectedMirror },
        });
        stats.listingsUpdated += 1;
      } catch (e) {
        stats.errors += 1;
        // eslint-disable-next-line no-console
        console.error('[mirrorRepair] listings.update failed', listingId, e?.message);
      }
    }
  }

  stats.finishedAt = new Date().toISOString();
  stats.durationMs =
    new Date(stats.finishedAt).getTime() - new Date(stats.startedAt).getTime();

  return stats;
};

module.exports = { repairMirror, sameSet };
