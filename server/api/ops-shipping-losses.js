// XOLOLO 2026-10-27: endpoint /ops que lista las discrepancias de
// envío detectadas en los últimos N días.
//
// Contrato:
//   GET /admin/shipping-losses?days=30
//   Auth: requireOperator con MFA.
//   200 → {
//     total: number,
//     totalLossMxn: number,
//     items: [{
//       txId, carrier, service, expected, actual, diff, diffPct,
//       lossMxn, detectedAt
//     }],
//     windowDays: number,
//   }

const { getIntegrationSdk } = require('../api-util/integrationSdk');

const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 365;
const PER_PAGE = 100;
const MAX_PAGES = 10;

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const windowDays = Math.min(
    Math.max(Number(req.query?.days) || DEFAULT_WINDOW_DAYS, 1),
    MAX_WINDOW_DAYS
  );
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const isdk = getIntegrationSdk();
  if (!isdk) {
    return res.status(500).json({ error: 'internal', details: 'Integration SDK sin configurar.' });
  }

  try {
    // Query transactions con createdAtStart = since. No podemos filtrar
    // por metadata.xololoShippingDiscrepancy desde el server (Sharetribe
    // Integration API no soporta filtros arbitrarios sobre metadata), así
    // que paginamos y filtramos en memoria.
    const items = [];
    let totalLossMxn = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const resp = await isdk.transactions.query({
        createdAtStart: since.toISOString(),
        perPage: PER_PAGE,
        page,
        'fields.transaction': ['createdAt', 'metadata'],
      });
      const txs = resp.data.data || [];
      for (const tx of txs) {
        const disc = tx.attributes?.metadata?.xololoShippingDiscrepancy;
        if (disc) {
          items.push({
            txId: tx.id?.uuid || tx.id,
            carrier: disc.context?.carrier,
            service: disc.context?.service,
            expected: disc.expected,
            actual: disc.actual,
            diff: disc.diff,
            diffPct: disc.diffPct,
            lossMxn: disc.lossMxn,
            detectedAt: disc.detectedAt,
          });
          totalLossMxn += Number(disc.lossMxn) || 0;
        }
      }
      const totalPages = resp.data.meta?.totalPages || 1;
      if (page >= totalPages) break;
    }

    items.sort((a, b) => (b.detectedAt || '').localeCompare(a.detectedAt || ''));

    return res.json({
      total: items.length,
      totalLossMxn: Number(totalLossMxn.toFixed(2)),
      items,
      windowDays,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[ops-shipping-losses] error:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};
