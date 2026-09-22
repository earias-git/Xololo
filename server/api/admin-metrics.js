// XOLOLO F3 · Fase 3: endpoints /api/admin/* para el panel interno.
//
// Todos gated por adminGate (email en XOLOLO_ADMIN_EMAILS).
//
// Endpoints exportados:
//   - health   → GET /api/admin/health
//     Métricas globales del marketplace en el período: GMV, # tx,
//     # sellers activos, # buyers únicos, ticket promedio, comisión
//     Xololo total.
//   - disputes → GET /api/admin/disputes
//     Lista de tx con xololoDispute abierto. Devuelve buyer, seller,
//     listing, motivo, fecha y monto para triage.
//   - sellers  → GET /api/admin/sellers-ranking
//     Top sellers por revenue en el período. Incluye # tx, ventas,
//     comisión pagada, promedio de rating (v2: cuando existan
//     reviews).
//
// Todos aceptan ?from=YYYY-MM-DD&to=YYYY-MM-DD con default últimos 30
// días. Todos usan Integration SDK para cruzar data de todos los
// sellers/buyers/tx.

const { requireAdmin } = require('../api-util/adminGate');
const { getIntegrationSdk } = require('../api-util/integrationSdk');

const MAX_PAGES = 10; // 1000 tx por request
const PER_PAGE = 100;

const isValidYmd = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

const defaultRange = () => {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ymd = d => d.toISOString().slice(0, 10);
  return { from: ymd(from), to: ymd(to) };
};

const parseRange = query => {
  const def = defaultRange();
  const from = isValidYmd(query.from) ? query.from : def.from;
  const to = isValidYmd(query.to) ? query.to : def.to;
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T23:59:59.999Z`);
  if (isNaN(fromDate) || isNaN(toDate) || fromDate > toDate) return null;
  return { from, to, fromDate, toDate };
};

// Fetch de todas las tx del marketplace en un rango. Requiere
// Integration SDK (single tenant view — el sdk regular sólo ve tx
// del user autenticado).
const fetchAllTxs = async (isdk, { fromDate, toDate }, extraParams = {}) => {
  const all = [];
  const included = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const resp = await isdk.transactions.query({
      createdAtStart: fromDate.toISOString(),
      createdAtEnd: toDate.toISOString(),
      page,
      perPage: PER_PAGE,
      include: ['listing', 'customer', 'provider'],
      'fields.transaction': [
        'createdAt',
        'state',
        'lastTransition',
        'payinTotal',
        'payoutTotal',
        'lineItems',
        'metadata',
      ],
      'fields.listing': ['title'],
      'fields.user': ['profile.displayName', 'email'],
      ...extraParams,
    });
    const data = resp.data.data || [];
    for (const inc of resp.data.included || []) included.push(inc);
    all.push(...data);
    const totalPages = resp.data.meta?.totalPages || 1;
    if (page >= totalPages) break;
  }
  return { txs: all, included };
};

// -------------- health --------------

const health = async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin.ok) return;

  const range = parseRange(req.query);
  if (!range) return res.status(400).json({ error: 'invalid_request' });

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    const { txs } = await fetchAllTxs(isdk, range);
    const sellers = new Set();
    const buyers = new Set();
    let txCount = 0;
    let gmv = 0;
    let commission = 0;
    let disputes = 0;
    let currency = 'MXN';

    for (const tx of txs) {
      const attrs = tx.attributes || {};
      if (attrs.state === 'canceled' || attrs.state === 'refunded') continue;
      txCount += 1;
      gmv += attrs.payinTotal?.amount || 0;
      currency = attrs.payinTotal?.currency || currency;

      // Provider commission viene negativa; usamos abs.
      const cLine = (attrs.lineItems || []).find(li => li.code === 'line-item/provider-commission');
      if (cLine?.lineTotal?.amount) commission += Math.abs(cLine.lineTotal.amount);

      const providerId = tx.relationships?.provider?.data?.id?.uuid;
      const customerId = tx.relationships?.customer?.data?.id?.uuid;
      if (providerId) sellers.add(providerId);
      if (customerId) buyers.add(customerId);

      if (attrs.metadata?.xololoDispute) disputes += 1;
    }

    return res.json({
      range: { from: range.from, to: range.to },
      metrics: {
        gmv,
        currency,
        txCount,
        sellersActive: sellers.size,
        buyersUnique: buyers.size,
        commissionXololo: commission,
        ticketAverage: txCount > 0 ? Math.round(gmv / txCount) : 0,
        openDisputes: disputes,
      },
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[admin/health] error:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

// -------------- disputes --------------

const disputes = async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin.ok) return;

  const range = parseRange({
    // Disputas: ampliamos el rango default a 90 días (una disputa
    // puede vivir semanas antes de resolverse).
    from: req.query.from,
    to: req.query.to,
  });
  if (!range) return res.status(400).json({ error: 'invalid_request' });

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    // Traemos rango amplio y filtramos client-side por xololoDispute
    // (Marketplace API no filtra por metadata anidada de forma
    // eficiente).
    const now = new Date();
    const wideRange = {
      ...range,
      fromDate: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
      toDate: now,
    };
    const { txs, included } = await fetchAllTxs(isdk, wideRange);

    const users = new Map();
    const listings = new Map();
    for (const r of included) {
      if (r.type === 'user') users.set(r.id.uuid, r);
      else if (r.type === 'listing') listings.set(r.id.uuid, r);
    }

    const items = [];
    for (const tx of txs) {
      const dispute = tx.attributes?.metadata?.xololoDispute;
      if (!dispute) continue;
      const listingId = tx.relationships?.listing?.data?.id?.uuid;
      const buyerId = tx.relationships?.customer?.data?.id?.uuid;
      const sellerId = tx.relationships?.provider?.data?.id?.uuid;
      items.push({
        transactionId: tx.id.uuid,
        openedAt: dispute.openedAt,
        status: dispute.status || 'pending_review',
        issueDetail: dispute.issueDetail || '',
        listing: {
          id: listingId,
          title: listings.get(listingId)?.attributes?.title || '',
        },
        buyer: {
          id: buyerId,
          name: users.get(buyerId)?.attributes?.profile?.displayName || '',
          email: users.get(buyerId)?.attributes?.email || '',
        },
        seller: {
          id: sellerId,
          name: users.get(sellerId)?.attributes?.profile?.displayName || '',
          email: users.get(sellerId)?.attributes?.email || '',
        },
        amountAtStake: tx.attributes?.payinTotal?.amount || 0,
        currency: tx.attributes?.payinTotal?.currency || 'MXN',
      });
    }

    // Ordena: más recientes primero.
    items.sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime());

    return res.json({ range: { from: range.from, to: range.to }, disputes: items });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[admin/disputes] error:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

// -------------- sellers ranking --------------

const sellersRanking = async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin.ok) return;

  const range = parseRange(req.query);
  if (!range) return res.status(400).json({ error: 'invalid_request' });

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    const { txs, included } = await fetchAllTxs(isdk, range);
    const users = new Map();
    for (const r of included) {
      if (r.type === 'user') users.set(r.id.uuid, r);
    }

    const bySeller = new Map();
    for (const tx of txs) {
      const attrs = tx.attributes || {};
      if (attrs.state === 'canceled' || attrs.state === 'refunded') continue;
      const providerId = tx.relationships?.provider?.data?.id?.uuid;
      if (!providerId) continue;
      let entry = bySeller.get(providerId);
      if (!entry) {
        entry = { txCount: 0, revenue: 0, commission: 0 };
        bySeller.set(providerId, entry);
      }
      entry.txCount += 1;
      entry.revenue += attrs.payinTotal?.amount || 0;
      const cLine = (attrs.lineItems || []).find(li => li.code === 'line-item/provider-commission');
      if (cLine?.lineTotal?.amount) entry.commission += Math.abs(cLine.lineTotal.amount);
    }

    const ranking = Array.from(bySeller.entries())
      .map(([sellerId, stats]) => {
        const u = users.get(sellerId);
        const pd = u?.attributes?.profile?.publicData || {};
        return {
          sellerId,
          name: u?.attributes?.profile?.displayName || '',
          email: u?.attributes?.email || '',
          storeSlug: pd.slug || null,
          storeUrl: pd.slug ? `https://${pd.slug}.xololo.mx` : null,
          ...stats,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    return res.json({ range: { from: range.from, to: range.to }, sellers: ranking });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[admin/sellers-ranking] error:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

module.exports = { health, disputes, sellersRanking };
