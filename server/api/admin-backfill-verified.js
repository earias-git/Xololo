// XOLOLO Task #22: backfill del badge Xololo Verified para sellers
// activos.
//
// Rationale: el badge xololoVerified se sincroniza con syncVerifiedBadge
// desde los call sites conocidos (upload-legal-doc, admin-legal-docs,
// stripeBilling webhook). Pero sellers que cumplieron los criterios
// ANTES de que esos call sites existieran, o que cambiaron el status
// de algún criterio sin disparar un sync, pueden tener el badge
// desactualizado. Este endpoint re-evalúa a TODOS los sellers con
// listings y aplica el estado correcto.
//
// Endpoints:
//   GET /api/admin/backfill-verified-badge/dry-run
//     Barre todos los users-sellers y cuenta cuántos cambiarían
//     (should-be-verified pero no está, o lo contrario). NO escribe.
//     200 → { total, wouldBecomeVerified, wouldLoseVerified, samples: [...10] }
//
//   POST /api/admin/backfill-verified-badge/run
//     Ejecuta el backfill real. Idempotente — syncVerifiedBadge
//     ignora los que ya están correctos.
//     200 → { total, becameVerified, lostVerified, errors, startedAt, finishedAt }

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { computeVerifiedFromUser, syncVerifiedBadge } = require('../api-util/sellerVerified');

const MAX_PAGES = 50;
const PER_PAGE = 100;

// Carga todos los sellers del marketplace. "Seller" = user con al menos
// 1 listing publicado (reduce ruido de buyers puros).
const fetchAllSellers = async isdk => {
  const sellers = new Map(); // userId → user entity completo
  // Barremos listings e indexamos sus authors.
  for (let page = 1; page <= MAX_PAGES; page++) {
    const resp = await isdk.listings.query({
      page,
      perPage: PER_PAGE,
      include: ['author'],
      'fields.listing': ['state'],
    });
    const included = resp.data.included || [];
    for (const inc of included) {
      if (inc.type === 'user' && !sellers.has(inc.id.uuid)) {
        sellers.set(inc.id.uuid, inc);
      }
    }
    const totalPages = resp.data.meta?.totalPages || 1;
    if (page >= totalPages) break;
  }
  return sellers;
};

// users.show trae metadata privada (necesaria para computeVerifiedFromUser).
// El include=listings de la query no trae profile.metadata, por eso
// re-fetcheamos cada seller individualmente.
const fetchUserFullProfile = async (isdk, userId) => {
  const resp = await isdk.users.show({ id: userId });
  return resp.data.data;
};

const dryRun = async (req, res) => {
  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    const sellers = await fetchAllSellers(isdk);
    let wouldBecomeVerified = 0;
    let wouldLoseVerified = 0;
    const samples = [];
    for (const [sellerId] of sellers.entries()) {
      try {
        const user = await fetchUserFullProfile(isdk, sellerId);
        const publicData = user.attributes?.profile?.publicData || {};
        const prev = publicData.xololoVerified === true;
        const next = computeVerifiedFromUser(user);
        if (prev !== next) {
          const sampleEntry = {
            sellerId,
            displayName:
              publicData.displayName ||
              user.attributes?.profile?.displayName ||
              user.attributes?.profile?.firstName ||
              '(sin nombre)',
            email: user.attributes?.email || null,
            was: prev,
            willBe: next,
            change: next && !prev ? 'become_verified' : 'lose_verified',
          };
          if (next && !prev) wouldBecomeVerified += 1;
          else wouldLoseVerified += 1;
          if (samples.length < 10) samples.push(sampleEntry);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[admin-backfill-verified] skip', sellerId, e?.message);
      }
    }

    return res.json({
      total: sellers.size,
      wouldBecomeVerified,
      wouldLoseVerified,
      noChange: sellers.size - wouldBecomeVerified - wouldLoseVerified,
      samples,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[admin-backfill-verified] dry-run error:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

const run = async (req, res) => {
  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  const startedAt = new Date().toISOString();
  try {
    const sellers = await fetchAllSellers(isdk);
    let becameVerified = 0;
    let lostVerified = 0;
    let noChange = 0;
    const errors = [];
    for (const [sellerId] of sellers.entries()) {
      try {
        const result = await syncVerifiedBadge({ isdk, sellerId });
        if (result.changed) {
          if (result.verified) becameVerified += 1;
          else lostVerified += 1;
        } else {
          noChange += 1;
        }
      } catch (e) {
        errors.push({ sellerId, error: e?.message || 'unknown' });
      }
    }
    const finishedAt = new Date().toISOString();

    return res.json({
      total: sellers.size,
      becameVerified,
      lostVerified,
      noChange,
      errorCount: errors.length,
      errors: errors.slice(0, 20),
      startedAt,
      finishedAt,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[admin-backfill-verified] run error:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

module.exports = { dryRun, run };
