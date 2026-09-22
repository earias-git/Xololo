// XOLOLO F3 · Sprint 6B: helper compartido para armar el reporte
// mensual de un seller. Lo usan:
//   - server/jobs/monthly-report.js (cron día 1 del mes)
//   - server/api/seller-monthly-report-preview.js (endpoint "enviarme
//     uno de prueba" desde /dashboard?section=reportes)
//
// Devuelve un context listo para sendEventNotifications con evento
// 'seller.monthly_report'.
//
// Uso:
//   const { buildMonthlyReportForSeller } = require('./monthlyReport');
//   const ctx = await buildMonthlyReportForSeller(isdk, sellerId, {
//     year: 2026, month: 8  // month es 0-indexed (agosto = 7)
//   });
//   await sendEventNotifications('seller.monthly_report', ctx);

const MONTH_LABELS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

const formatMxn = subunits => {
  const n = Number(subunits) || 0;
  return (n / 100).toLocaleString('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
};

// Rango del mes calendario en UTC.
const monthRange = (year, month) => {
  const from = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const to = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
  return { from, to, monthLabel: `${MONTH_LABELS_ES[month]} ${year}` };
};

// Trae todas las tx de venta del seller en un rango específico.
const fetchSellerSalesInRange = async (isdk, sellerId, { from, to }) => {
  const all = [];
  const included = [];
  for (let page = 1; page <= 5; page++) {
    const resp = await isdk.transactions.query({
      providerId: sellerId,
      page,
      perPage: 100,
      include: ['listing'],
      'fields.transaction': [
        'createdAt',
        'lastTransitionedAt',
        'state',
        'lastTransition',
        'lineItems',
        'payinTotal',
        'payoutTotal',
      ],
      'fields.listing': ['title'],
    });
    const data = resp.data.data || [];
    for (const inc of resp.data.included || []) included.push(inc);
    for (const tx of data) {
      const ca = tx.attributes?.createdAt ? new Date(tx.attributes.createdAt).getTime() : 0;
      if (ca >= from.getTime() && ca <= to.getTime()) {
        all.push(tx);
      }
    }
    const totalPages = resp.data.meta?.totalPages || 1;
    if (page >= totalPages) break;
    const oldest = data[data.length - 1]?.attributes?.createdAt;
    if (oldest && new Date(oldest).getTime() < from.getTime()) break;
  }
  return { txs: all, included };
};

// Suma agregada del período.
const summarize = txs => {
  let count = 0;
  let salesAmount = 0;
  let providerAmount = 0;
  for (const tx of txs) {
    const attrs = tx.attributes || {};
    if (attrs.state === 'canceled' || attrs.state === 'refunded') continue;
    count += 1;
    salesAmount += attrs.payinTotal?.amount || 0;
    providerAmount += attrs.payoutTotal?.amount || 0;
  }
  return { count, salesAmount, providerAmount };
};

// Top 3 productos por revenue.
const topProducts = (txs, included) => {
  const listings = new Map();
  for (const inc of included) {
    if (inc.type === 'listing') listings.set(inc.id.uuid, inc);
  }
  const agg = new Map();
  for (const tx of txs) {
    if (tx.attributes?.state === 'canceled' || tx.attributes?.state === 'refunded') continue;
    const listingId = tx.relationships?.listing?.data?.id?.uuid;
    if (!listingId) continue;
    for (const li of tx.attributes?.lineItems || []) {
      if (li.code !== 'line-item/item') continue;
      const inc = li.includeFor || [];
      if (!inc.includes('customer') || !inc.includes('provider')) continue;
      let e = agg.get(listingId);
      if (!e) {
        e = { revenue: 0, units: 0 };
        agg.set(listingId, e);
      }
      e.revenue += li.lineTotal?.amount || 0;
      e.units += Number(li.quantity) || 0;
    }
  }
  return Array.from(agg.entries())
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 3)
    .map(([id, stats]) => ({
      title: listings.get(id)?.attributes?.title || 'Producto',
      units: stats.units,
      revenue: stats.revenue,
    }));
};

// Construye el context completo para sendEventNotifications.
const buildMonthlyReportForSeller = async (isdk, sellerId, { year, month }) => {
  // 1. Rango actual + previo para % comparativa.
  const cur = monthRange(year, month);
  const prevDate = new Date(Date.UTC(year, month - 1, 1));
  const prev = monthRange(prevDate.getUTCFullYear(), prevDate.getUTCMonth());

  // 2. Fetch en paralelo.
  const [curRes, prevRes, userRes] = await Promise.all([
    fetchSellerSalesInRange(isdk, sellerId, cur),
    fetchSellerSalesInRange(isdk, sellerId, prev),
    isdk.users.show({ id: sellerId }),
  ]);

  const curSum = summarize(curRes.txs);
  const prevSum = summarize(prevRes.txs);
  const top = topProducts(curRes.txs, curRes.included);

  // Delta %.
  const deltaPct = prevSum.salesAmount > 0
    ? Math.round(((curSum.salesAmount - prevSum.salesAmount) / prevSum.salesAmount) * 100)
    : null;
  const deltaLabel = deltaPct == null
    ? ''
    : deltaPct > 0
    ? ` (+${deltaPct}% vs ${prev.monthLabel})`
    : deltaPct < 0
    ? ` (${deltaPct}% vs ${prev.monthLabel})`
    : ` (sin cambio vs ${prev.monthLabel})`;

  const topText = top.length > 0
    ? 'Top productos:\n' + top.map((p, i) => `  ${i + 1}. ${p.title} — ${p.units} vendidos (${formatMxn(p.revenue)})`).join('\n')
    : 'Aún sin ventas este mes.';

  const ticket = curSum.count > 0 ? Math.round(curSum.salesAmount / curSum.count) : 0;

  const rootUrl = (process.env.REACT_APP_MARKETPLACE_ROOT_URL || 'https://xololo.mx').replace(/\/$/, '');
  const dashboardUrl = `${rootUrl}/dashboard`;

  // User + branding para dual-brand del email.
  const userAttrs = userRes.data.data.attributes || {};
  const userPd = userAttrs.profile?.publicData || {};

  return {
    seller: {
      name: userAttrs.profile?.displayName || 'Vendedor',
      email: userAttrs.email,
      logoUrl: userPd.logoUrl || userPd.brandLogoUrl || null,
      primaryColor: userPd.brandPrimaryColor || userPd.storePrimaryColor || null,
      slug: userPd.slug || null,
    },
    report: {
      monthLabel: cur.monthLabel,
      salesMxn: formatMxn(curSum.salesAmount) + deltaLabel,
      count: String(curSum.count),
      ticketMxn: formatMxn(ticket),
      netMxn: formatMxn(curSum.providerAmount),
      topProductsText: topText,
      dashboardUrl,
    },
    // No hay data del buyer en este email (es al seller, no dual-brand
    // completo). Dejamos el objeto mínimo para no romper el template.
    buyer: { name: '', email: '' },
    listing: { title: '' },
    order: { url: dashboardUrl },
  };
};

module.exports = {
  buildMonthlyReportForSeller,
  monthRange,
  MONTH_LABELS_ES,
};
