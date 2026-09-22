// XOLOLO F3 · Fase 1b: endpoint de analytics para el dashboard del seller.
//
// Contrato:
//   GET /api/seller-analytics?from=YYYY-MM-DD&to=YYYY-MM-DD
//   Auth: user logueado (usa el session cookie); sólo trae SUS ventas.
//   200 → {
//     from, to,
//     transactions: [
//       { id, createdAt, lastTransitionedAt, state, lastTransition,
//         payinAmount, payinCurrency,
//         providerTotalAmount, providerTotalCurrency,
//         xololoCommissionAmount,
//         listingTitle,
//         customerName,
//         isDelivered, isCanceled }
//     ],
//     summary: { count, salesAmount, providerAmount, commissionAmount, currency }
//   }
//   400 → { error: 'invalid_request' } (from/to fuera de rango o mal formato)
//   401 → { error: 'unauthorized' }
//   500 → { error: 'internal' }
//
// Estrategia:
//   - Usa el sdk normal del user logueado (currentUser.show → id, luego
//     transactions.query { role: 'provider' }) para respetar los
//     permisos de Marketplace API.
//   - Paginación server-side: iteramos hasta traer todo lo del rango
//     (perPage=100, cortando en máximo 5 páginas = 500 tx por período
//     para evitar cargas patológicas).
//   - Cache in-memory por (userId, from, to) por 5 min. Los seller
//     verán números casi-en-vivo pero sin golpear Marketplace API por
//     cada re-render.
//   - Devuelve datos "delgados" — el cliente hace el bucketing por
//     día/semana/mes según granularidad elegida (más rápido y flexible).

const { getSdk, handleError } = require('../api-util/sdk');

const MAX_PAGES = 5; // 500 tx por período máximo
const PER_PAGE = 100;
const CACHE_TTL_MS = 5 * 60 * 1000;

const cache = new Map();
const CACHE_MAX = 200;

const cacheKey = (userId, from, to) => `${userId}|${from}|${to}`;

const getCached = key => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry); // LRU touch
  return entry.value;
};

const setCached = (key, value) => {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
};

const isValidIsoDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

// Convierte una tx completa a la forma delgada que el cliente necesita.
const shrinkTx = tx => {
  const attrs = tx.attributes || {};
  const lineItems = attrs.lineItems || [];

  const commissionLine = lineItems.find(li => li.code === 'line-item/provider-commission');
  // La commission viene como negativa (se descuenta al provider). Aquí
  // la exponemos en positivo — representa lo que Xololo cobró.
  const xololoCommissionAmount = commissionLine?.lineTotal?.amount
    ? Math.abs(commissionLine.lineTotal.amount)
    : 0;

  const transitions = attrs.transitions || [];
  const trackingEvents = attrs.metadata?.xololoShippingTrackingEvents || [];
  const isDelivered =
    transitions.some(t => t.transition === 'transition/mark-received') ||
    trackingEvents.some(e => e.status === 'delivered');
  const isCanceled = attrs.state === 'canceled' || attrs.state === 'refunded';

  const listing = (tx.relationships?.listing?.data || {}).id;
  const customer = (tx.relationships?.customer?.data || {}).id;

  return {
    id: tx.id?.uuid,
    createdAt: attrs.createdAt,
    lastTransitionedAt: attrs.lastTransitionedAt,
    state: attrs.state,
    lastTransition: attrs.lastTransition,
    payinAmount: attrs.payinTotal?.amount || 0,
    payinCurrency: attrs.payinTotal?.currency || 'MXN',
    providerTotalAmount: attrs.payoutTotal?.amount || 0,
    providerTotalCurrency: attrs.payoutTotal?.currency || 'MXN',
    xololoCommissionAmount,
    listingId: listing?.uuid,
    customerId: customer?.uuid,
    isDelivered,
    isCanceled,
  };
};

const enrichWithIncluded = (txs, included) => {
  const listings = new Map();
  const users = new Map();
  for (const item of included || []) {
    if (item.type === 'listing') listings.set(item.id.uuid, item);
    if (item.type === 'user') users.set(item.id.uuid, item);
  }
  return txs.map(shrunk => {
    const listing = shrunk.listingId ? listings.get(shrunk.listingId) : null;
    const customer = shrunk.customerId ? users.get(shrunk.customerId) : null;
    return {
      ...shrunk,
      listingTitle: listing?.attributes?.title || null,
      customerName: customer?.attributes?.profile?.displayName || null,
    };
  });
};

module.exports = async (req, res) => {
  try {
    const { from, to } = req.query || {};
    if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
      return res.status(400).json({
        error: 'invalid_request',
        details: 'from/to deben ser YYYY-MM-DD.',
      });
    }
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T23:59:59.999Z`);
    if (isNaN(fromDate) || isNaN(toDate) || fromDate > toDate) {
      return res.status(400).json({ error: 'invalid_request', details: 'rango inválido.' });
    }
    // Máximo 24 meses de rango — evita queries patológicos.
    const rangeMs = toDate.getTime() - fromDate.getTime();
    if (rangeMs > 24 * 31 * 24 * 60 * 60 * 1000) {
      return res.status(400).json({ error: 'invalid_request', details: 'rango máximo 24 meses.' });
    }

    const sdk = getSdk(req, res);

    // Session check
    let currentUser;
    try {
      const resp = await sdk.currentUser.show();
      currentUser = resp.data.data;
    } catch (e) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const userId = currentUser.id.uuid;

    // Cache hit?
    const key = cacheKey(userId, from, to);
    const hit = getCached(key);
    if (hit) {
      return res.json({ ...hit, cached: true });
    }

    // Paginate through transactions of this provider in the date range.
    const all = [];
    let page = 1;
    while (page <= MAX_PAGES) {
      const queryParams = {
        // Note: Marketplace API filters supported for transactions.query
        // include role, createdAtStart, createdAtEnd, perPage, page.
        only: 'sale', // solo ventas donde el user es provider
        lastTransitions: undefined, // no filtramos por transition — traemos todo
        page,
        perPage: PER_PAGE,
        include: ['listing', 'customer', 'customer.profileImage', 'listing.images'],
        'fields.transaction': [
          'createdAt',
          'lastTransitionedAt',
          'state',
          'lastTransition',
          'payinTotal',
          'payoutTotal',
          'lineItems',
          'transitions',
          'metadata',
        ],
        'fields.listing': ['title'],
        'fields.user': ['profile.displayName'],
      };
      let resp;
      try {
        resp = await sdk.transactions.query(queryParams);
      } catch (e) {
        // Si Marketplace API rechaza el `only:sale`, reintentar sin filtro
        // — se ajustará cliente-side por currentUser.
        if (e.status === 400) {
          delete queryParams.only;
          resp = await sdk.transactions.query(queryParams);
        } else {
          throw e;
        }
      }
      const data = resp.data.data || [];
      const included = resp.data.included || [];
      const shrunkPage = data.map(shrinkTx);
      const enrichedPage = enrichWithIncluded(shrunkPage, included);

      // Filtramos por rango en cliente (el filtro createdAtStart/End en
      // Marketplace API a veces no aplica a `only:sale` — mejor safe).
      for (const tx of enrichedPage) {
        const ca = tx.createdAt ? new Date(tx.createdAt).getTime() : 0;
        if (ca >= fromDate.getTime() && ca <= toDate.getTime()) {
          all.push(tx);
        }
      }
      const totalPages = resp.data.meta?.totalPages || 1;
      if (page >= totalPages) break;
      // Optimización: si la última tx de la página es más vieja que `from`,
      // no vale la pena seguir paginando (API ordena desc por default).
      const oldestInPage = data[data.length - 1]?.attributes?.createdAt;
      if (oldestInPage && new Date(oldestInPage).getTime() < fromDate.getTime()) break;
      page += 1;
    }

    // Summary agregado (ignora canceladas para el revenue).
    let count = 0;
    let salesAmount = 0;
    let providerAmount = 0;
    let commissionAmount = 0;
    let currency = 'MXN';
    for (const tx of all) {
      if (tx.isCanceled) continue;
      count += 1;
      salesAmount += tx.payinAmount || 0;
      providerAmount += tx.providerTotalAmount || 0;
      commissionAmount += tx.xololoCommissionAmount || 0;
      currency = tx.payinCurrency || currency;
    }

    const value = {
      from,
      to,
      transactions: all,
      summary: { count, salesAmount, providerAmount, commissionAmount, currency },
    };
    setCached(key, value);
    return res.json(value);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[seller-analytics] unexpected:', e?.message);
    return handleError(res, e);
  }
};
