// XOLOLO OPS Users 360 · Fase B — export CSV del roster filtrado.
//
// GET /api/admin/ops/users-roster.csv?<mismos filtros que roster>
//   Devuelve CSV con los users que coinciden con los filtros (sin
//   paginación — hasta MAX_EXPORT rows por request). Audita el export.
//
// Columns incluidas (16): id, email, displayName, firstName, lastName,
// slug, createdAt, lastSeenAt, lastActivityAt, type, verified,
// stripeConnected, subscriptionStatus, legalApproved/total, state, city,
// listingsTotal, listingsPublished, listingsNew, listingsUsed,
// listingsService, salesCount, gmvYTD, purchasesCount.

const {
  getSnapshot,
  applyFilters,
  applySortAndPagination,
} = require('../api-util/opsUsersRoster');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { recordAudit } = require('../api-util/opsAudit');

const MAX_EXPORT = 10_000;

const COLUMNS = [
  ['id', e => e.id],
  ['email', e => e.email],
  ['displayName', e => e.displayName],
  ['firstName', e => e.firstName],
  ['lastName', e => e.lastName],
  ['slug', e => e.slug],
  ['createdAt', e => e.createdAt],
  ['lastSeenAt', e => e.lastSeenAt],
  ['lastActivityAt', e => e.lastActivityAt],
  ['type', e => e.type],
  ['verified', e => (e.verified ? 'yes' : 'no')],
  ['stripeConnected', e => (e.stripeConnected ? 'yes' : 'no')],
  ['subscriptionStatus', e => e.subscriptionStatus || ''],
  ['legalPersonType', e => e.legal.personType || ''],
  ['legalApproved', e => e.legal.approved],
  ['legalTotal', e => e.legal.total],
  ['state', e => e.state || ''],
  ['city', e => e.city || ''],
  ['listingsTotal', e => e.listings.total],
  ['listingsPublished', e => e.listings.published],
  ['listingsNew', e => e.listings.new],
  ['listingsUsed', e => e.listings.used],
  ['listingsService', e => e.listings.service],
  ['salesCount', e => e.sales.count],
  ['gmvYTD', e => e.sales.gmvYTD],
  ['purchasesCount', e => e.purchases.count],
];

const csvEscape = v => {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const { snapshot } = await getSnapshot();
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
    const filtered = applyFilters(snapshot.entries, filters);
    const rows = applySortAndPagination(filtered, {
      sort: req.query.sort || 'lastActivity',
      dir: req.query.dir === 'asc' ? 'asc' : 'desc',
      page: 1,
      pageSize: MAX_EXPORT,
    });

    const header = COLUMNS.map(([k]) => k).join(',');
    const body = rows
      .map(e => COLUMNS.map(([, fn]) => csvEscape(fn(e))).join(','))
      .join('\n');
    const csv = `${header}\n${body}\n`;

    // Audit log del export (no bloquea respuesta).
    const isdk = getIntegrationSdk();
    if (isdk && req.operator) {
      // Un entry global, no por user. Lo guardamos como "export" en el
      // audit del propio operator (así no inflamos N users). Para v1
      // basta con un log en stdout + recordAudit en el propio operator
      // si tenemos su userId; si no, solo log.
      // eslint-disable-next-line no-console
      console.log(
        `[ops-export-audit] operator=${req.operator.email} rows=${rows.length} filters=${JSON.stringify(filters)}`
      );
    }

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="xololo-users-${stamp}.csv"`
    );
    return res.send(csv);
  } catch (e) {
    if (e?.message === 'integration_api_missing') {
      return res.status(500).json({ error: 'integration_api_missing' });
    }
    // eslint-disable-next-line no-console
    console.error('[ops-users-export] error:', e?.message || e);
    return res.status(500).json({ error: 'internal' });
  }
};
