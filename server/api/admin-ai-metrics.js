// XOLOLO Fase 2 — endpoint para que operadores vean el consumo de IA.
//
// GET /api/admin/ai-metrics?days=30
//   Response: {
//     days: [{ date, calls:{...}, tokens:{...}, estimatedCostUsd }],
//     totals: { calls, tokens, estimatedCostUsd },
//     averages: { dailyCost, dailyCalls }
//   }

const { getMetricsForLastDays, PURPOSES } = require('../api-util/aiMetrics');

module.exports = async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 90);
    const perDay = await getMetricsForLastDays(days);

    // Totales agregados sobre todo el período.
    const totals = {
      calls: Object.fromEntries(PURPOSES.map(p => [p, 0])),
      tokens: Object.fromEntries(PURPOSES.map(p => [p, { in: 0, out: 0 }])),
      estimatedCostUsd: 0,
      totalCalls: 0,
    };
    for (const d of perDay) {
      for (const p of PURPOSES) {
        totals.calls[p] += d.calls[p] || 0;
        totals.totalCalls += d.calls[p] || 0;
        totals.tokens[p].in += d.tokens[p]?.in || 0;
        totals.tokens[p].out += d.tokens[p]?.out || 0;
      }
      totals.estimatedCostUsd += d.estimatedCostUsd || 0;
    }
    totals.estimatedCostUsd = Math.round(totals.estimatedCostUsd * 10000) / 10000;

    const averages = {
      dailyCost: Math.round((totals.estimatedCostUsd / days) * 10000) / 10000,
      dailyCalls: Math.round(totals.totalCalls / days),
    };

    return res.status(200).json({
      ok: true,
      days: perDay,
      totals,
      averages,
      pricingReference: {
        model: 'claude-haiku-5-5',
        inputUsdPer1M: 0.8,
        outputUsdPer1M: 4.0,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[admin-ai-metrics]', err?.message);
    return res.status(500).json({ error: err?.message || 'internal' });
  }
};
