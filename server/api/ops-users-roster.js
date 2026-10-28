// XOLOLO OPS Users 360 · Fase A — endpoint que lista todos los users
// del marketplace para la vista /ops/users, con filtros server-side,
// paginación, sort y facets.
//
// GET /api/admin/ops/users-roster
//   Query params:
//     q              — búsqueda por email/nombre/slug (case-insensitive)
//     type           — csv: store,casual_reseller,buyer_only,admin,lead
//     verified       — yes | no
//     sub            — csv: active,past_due,canceled,none
//     stripe         — yes | no
//     legal          — complete | partial | none
//     state          — ISO 3166-2 MX (ej. MX-MOR)
//     activity       — today | 7d | 30d | 90d | 90d+ | never
//     sort           — lastActivity (default) | createdAt | gmv | listings
//     dir            — desc (default) | asc
//     page           — 1-indexed, default 1
//     pageSize       — default 50, max 200
//
//   200 → {
//     generatedAt, cached, total, filteredTotal, page, pageSize,
//     facets: { byType, byVerified, bySub, byStripe, byLegal, byState, byActivity },
//     users: [RosterEntry]
//   }

const {
  getSnapshot,
  applyFilters,
  applySortAndPagination,
  computeFacets,
} = require('../api-util/opsUsersRoster');

const MAX_PAGE_SIZE = 200;

module.exports = async (req, res) => {
  // Auth: montado con requireOperator en apiRouter — req.operator está presente.
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const { snapshot, cached } = await getSnapshot();
    const filters = {
      q: req.query.q,
      type: req.query.type,
      verified: req.query.verified,
      sub: req.query.sub,
      stripe: req.query.stripe,
      legal: req.query.legal,
      state: req.query.state,
      activity: req.query.activity,
    };
    const sort = req.query.sort || 'lastActivity';
    const dir = req.query.dir === 'asc' ? 'asc' : 'desc';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, parseInt(req.query.pageSize, 10) || 50)
    );

    const filtered = applyFilters(snapshot.entries, filters);
    const pageEntries = applySortAndPagination(filtered, { sort, dir, page, pageSize });
    const facets = computeFacets(snapshot.entries);

    return res.json({
      generatedAt: new Date(snapshot.at).toISOString(),
      cached,
      total: snapshot.totalUsers,
      filteredTotal: filtered.length,
      page,
      pageSize,
      sort,
      dir,
      facets,
      users: pageEntries,
    });
  } catch (e) {
    if (e?.message === 'integration_api_missing') {
      return res.status(500).json({ error: 'integration_api_missing' });
    }
    // eslint-disable-next-line no-console
    console.error('[ops-users-roster] error:', e?.message || e);
    return res.status(500).json({ error: 'internal' });
  }
};
