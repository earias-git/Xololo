// XOLOLO F3 · ampliación admin: endpoint consolidado con todo lo
// necesario para analizar el marketplace y decidir estrategia —
// catálogo, usuarios/buyers y tráfico — en un solo round-trip.
//
// Gated por adminGate (email en XOLOLO_ADMIN_EMAILS).
//
// Contrato:
//   GET /api/admin/overview?months=6
//   200 → {
//     generatedAt: ISO,
//     catalog: {
//       productsCount, servicesCount, otherCount, totalPublished,
//       growth: [{ period: 'YYYY-MM', products, services, other }]
//     },
//     buyers: {
//       totalUsers, activeBuyers, dormantBuyers, neverPurchased,
//       candidates: [{ userId, name, email, ordersCount, lastOrderAt }]
//     },
//     traffic: {
//       listingViews: { total, bySource },
//       storeViews:   { total, bySource },
//       topListings: [{ listingId, title, sellerName, views,
//                        unitsSold, conversionPct }],
//       topStores:   [{ sellerId, sellerName, sellerSlug, views }]
//     }
//   }
//   400 → { error: 'invalid_request' }
//   401/403 → gate de adminGate
//   500 → { error: 'internal' | 'integration_api_missing' }
//
// -------------------- Definiciones / supuestos (documentar en la
// respuesta a earias, no sólo aquí) --------------------
//
//  · "Producto" vs "Servicio": Sharetribe no tiene un campo booleano
//    product/service — lo inferimos de publicData.unitType:
//      'item'                        → producto (venta física)
//      'hour' | 'day' | 'night' | 'fixed' → servicio (booking)
//      cualquier otro / ausente      → "otro" (inquiry, offer, etc.)
//
//  · "Buyer activo/inactivo": Xololo no tiene roles duros buyer/seller
//    (cualquier user puede vender y comprar). Por eso reportamos sobre
//    TODOS los users registrados:
//      activo   = compró (tx no cancelada) en los últimos
//                 ACTIVE_BUYER_WINDOW_DAYS días.
//      dormido  = compró alguna vez, pero no en la ventana activa.
//      nunca compró = 0 tx como customer, histórico completo.
//
//  · "Candidato a seller": user con ≥ SELLER_CANDIDATE_MIN_ORDERS
//    compras (como customer) que TODAVÍA no tiene ningún listing
//    publicado. Ordenados por # de compras desc.
//
//  · Tráfico: agrega metadata.xololoAnalytics de TODOS los listings
//    (vistas/carrito/checkout/shares por source — Sprint 2) y
//    profile.metadata.xololoStoreAnalytics de TODOS los users (vistas
//    de storefront — ampliación de hoy). "unitsSold" y "conversionPct"
//    de topListings salen de cruzar vistas con las tx reales del
//    mismo listing.
//
//  · Límite de escala v1: itera hasta MAX_PAGES páginas de cada
//    recurso (listings/users/tx). Con el volumen actual de Xololo es
//    holgado; si el marketplace crece, esto necesita migrar a
//    agregación en DB (ver DASHBOARDS_V1.md §5.4).

const { requireAdmin } = require('../api-util/adminGate');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { readLineItemQty } = require('../api-util/lineItemMoney');

const MAX_PAGES = 20; // hasta 2000 recursos por tipo
const PER_PAGE = 100;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 20;
const cache = new Map();

const ACTIVE_BUYER_WINDOW_DAYS = 60;
const SELLER_CANDIDATE_MIN_ORDERS = 3;
const DEFAULT_GROWTH_MONTHS = 6;
const CANDIDATES_LIMIT = 20;
const TOP_LISTINGS_LIMIT = 10;
const TOP_STORES_LIMIT = 10;

const getCached = key => {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, e); // LRU touch
  return e.value;
};

const setCached = (key, value) => {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
};

// -------------------- fetch helpers --------------------

const fetchAllListings = async isdk => {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const resp = await isdk.listings.query({
      states: ['published'],
      page,
      perPage: PER_PAGE,
      include: ['author'],
      'fields.listing': ['title', 'createdAt', 'publicData', 'metadata'],
      'fields.user': ['profile.displayName'],
    });
    all.push(...(resp.data.data || []));
    const totalPages = resp.data.meta?.totalPages || 1;
    if (page >= totalPages) break;
  }
  return all;
};

const fetchAllUsers = async isdk => {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const resp = await isdk.users.query({
      page,
      perPage: PER_PAGE,
      'fields.user': [
        'email',
        'createdAt',
        'profile.displayName',
        'profile.publicData',
        'profile.metadata',
      ],
    });
    all.push(...(resp.data.data || []));
    const totalPages = resp.data.meta?.totalPages || 1;
    if (page >= totalPages) break;
  }
  return all;
};

const fetchAllTxs = async isdk => {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const resp = await isdk.transactions.query({
      page,
      perPage: PER_PAGE,
      include: ['listing', 'customer', 'provider'],
      'fields.transaction': ['createdAt', 'state', 'lineItems'],
    });
    all.push(...(resp.data.data || []));
    const totalPages = resp.data.meta?.totalPages || 1;
    if (page >= totalPages) break;
  }
  return all;
};

// -------------------- helpers de negocio --------------------

const SERVICE_UNIT_TYPES = new Set(['hour', 'day', 'night', 'fixed']);

const classifyListing = listing => {
  const unitType = listing.attributes?.publicData?.unitType;
  if (unitType === 'item') return 'products';
  if (SERVICE_UNIT_TYPES.has(unitType)) return 'services';
  return 'other';
};

const monthKeyOf = isoOrDate => {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

const sumSourceMap = m => Object.values(m || {}).reduce((s, n) => s + (Number(n) || 0), 0);

const mergeInto = (dst, src) => {
  for (const [k, v] of Object.entries(src || {})) {
    dst[k] = (dst[k] || 0) + (Number(v) || 0);
  }
};

module.exports = async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin.ok) return;

  const months = Math.min(24, Math.max(1, parseInt(req.query.months, 10) || DEFAULT_GROWTH_MONTHS));
  const cacheKey = `overview:${months}`;
  const hit = getCached(cacheKey);
  if (hit) return res.json({ ...hit, cached: true });

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    const [listings, users, txs] = await Promise.all([
      fetchAllListings(isdk),
      fetchAllUsers(isdk),
      fetchAllTxs(isdk),
    ]);

    // ==================== CATÁLOGO ====================
    let productsCount = 0;
    let servicesCount = 0;
    let otherCount = 0;

    // Seed de buckets vacíos para los últimos `months` meses — así
    // meses sin publicaciones nuevas aparecen en 0, no ausentes.
    const growthBuckets = new Map();
    const seedCursor = new Date();
    seedCursor.setUTCDate(1);
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(seedCursor);
      d.setUTCMonth(d.getUTCMonth() - i);
      growthBuckets.set(monthKeyOf(d), { products: 0, services: 0, other: 0 });
    }

    // authorId → # listings publicados (para detectar "ya es seller").
    const listingCountByAuthor = new Map();

    for (const l of listings) {
      const cat = classifyListing(l);
      if (cat === 'products') productsCount += 1;
      else if (cat === 'services') servicesCount += 1;
      else otherCount += 1;

      const createdAt = l.attributes?.createdAt;
      if (createdAt) {
        const k = monthKeyOf(createdAt);
        const bucket = growthBuckets.get(k);
        if (bucket) bucket[cat] += 1;
      }

      const authorId = l.relationships?.author?.data?.id?.uuid;
      if (authorId) {
        listingCountByAuthor.set(authorId, (listingCountByAuthor.get(authorId) || 0) + 1);
      }
    }

    const growth = Array.from(growthBuckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([period, v]) => ({ period, ...v }));

    // ==================== UNIDADES VENDIDAS POR LISTING (para tráfico) ====================
    const unitsSoldByListing = new Map();
    const buyerOrders = new Map(); // customerId → { count, lastOrderAt }

    for (const tx of txs) {
      const attrs = tx.attributes || {};
      const isCanceled = attrs.state === 'canceled' || attrs.state === 'refunded';

      // --- buyers: contamos toda compra no cancelada como "orden" ---
      const buyerId = tx.relationships?.customer?.data?.id?.uuid;
      if (buyerId && !isCanceled) {
        let e = buyerOrders.get(buyerId);
        if (!e) {
          e = { count: 0, lastOrderAt: null };
          buyerOrders.set(buyerId, e);
        }
        e.count += 1;
        if (attrs.createdAt && (!e.lastOrderAt || attrs.createdAt > e.lastOrderAt)) {
          e.lastOrderAt = attrs.createdAt;
        }
      }

      // --- unidades vendidas por listing (para conversion rate) ---
      if (isCanceled) continue;
      const listingId = tx.relationships?.listing?.data?.id?.uuid;
      if (!listingId) continue;
      for (const li of attrs.lineItems || []) {
        if (li.code !== 'line-item/item') continue;
        const inc = li.includeFor || [];
        if (!inc.includes('customer') || !inc.includes('provider')) continue;
        unitsSoldByListing.set(
          listingId,
          (unitsSoldByListing.get(listingId) || 0) + readLineItemQty(li)
        );
      }
    }

    // ==================== BUYERS / USUARIOS ====================
    const now = Date.now();
    const activeCutoffMs = now - ACTIVE_BUYER_WINDOW_DAYS * 24 * 60 * 60 * 1000;

    let activeBuyers = 0;
    let dormantBuyers = 0;
    let neverPurchased = 0;

    const usersById = new Map(users.map(u => [u.id.uuid, u]));

    for (const u of users) {
      const stats = buyerOrders.get(u.id.uuid);
      if (!stats) {
        neverPurchased += 1;
        continue;
      }
      const lastMs = stats.lastOrderAt ? new Date(stats.lastOrderAt).getTime() : 0;
      if (lastMs >= activeCutoffMs) activeBuyers += 1;
      else dormantBuyers += 1;
    }

    const candidates = [];
    for (const [buyerId, stats] of buyerOrders) {
      if (stats.count < SELLER_CANDIDATE_MIN_ORDERS) continue;
      if (listingCountByAuthor.has(buyerId)) continue; // ya es seller
      const u = usersById.get(buyerId);
      candidates.push({
        userId: buyerId,
        name: u?.attributes?.profile?.displayName || '',
        email: u?.attributes?.email || '',
        ordersCount: stats.count,
        lastOrderAt: stats.lastOrderAt,
      });
    }
    candidates.sort((a, b) => b.ordersCount - a.ordersCount);

    // ==================== TRÁFICO ====================
    let totalListingViews = 0;
    const listingViewsBySource = {};
    const topListingsRaw = [];

    for (const l of listings) {
      const analytics = l.attributes?.metadata?.xololoAnalytics;
      const views = analytics?.totals?.['listing.viewed'] || {};
      const viewsSum = sumSourceMap(views);
      if (viewsSum > 0) {
        totalListingViews += viewsSum;
        mergeInto(listingViewsBySource, views);
      }
      const sold = unitsSoldByListing.get(l.id.uuid) || 0;
      if (viewsSum > 0 || sold > 0) {
        topListingsRaw.push({
          listingId: l.id.uuid,
          title: l.attributes?.title || '',
          sellerId: l.relationships?.author?.data?.id?.uuid || null,
          views: viewsSum,
          unitsSold: sold,
          conversionPct: viewsSum > 0 ? Math.round((sold / viewsSum) * 1000) / 10 : null,
        });
      }
    }
    topListingsRaw.sort((a, b) => b.views - a.views);
    const topListings = topListingsRaw.slice(0, TOP_LISTINGS_LIMIT).map(item => {
      const seller = usersById.get(item.sellerId);
      return { ...item, sellerName: seller?.attributes?.profile?.displayName || '' };
    });

    let totalStoreViews = 0;
    const storeViewsBySource = {};
    const topStoresRaw = [];

    for (const u of users) {
      const analytics = u.attributes?.profile?.metadata?.xololoStoreAnalytics;
      const views = analytics?.totals?.['store.viewed'] || {};
      const viewsSum = sumSourceMap(views);
      if (viewsSum === 0) continue;
      totalStoreViews += viewsSum;
      mergeInto(storeViewsBySource, views);
      const pd = u.attributes?.profile?.publicData || {};
      topStoresRaw.push({
        sellerId: u.id.uuid,
        sellerName: u.attributes?.profile?.displayName || '',
        sellerSlug: pd.slug || null,
        views: viewsSum,
      });
    }
    topStoresRaw.sort((a, b) => b.views - a.views);
    const topStores = topStoresRaw.slice(0, TOP_STORES_LIMIT);

    const value = {
      generatedAt: new Date().toISOString(),
      catalog: {
        productsCount,
        servicesCount,
        otherCount,
        totalPublished: listings.length,
        growth,
      },
      buyers: {
        totalUsers: users.length,
        activeBuyers,
        dormantBuyers,
        neverPurchased,
        candidates: candidates.slice(0, CANDIDATES_LIMIT),
      },
      traffic: {
        listingViews: { total: totalListingViews, bySource: listingViewsBySource },
        storeViews: { total: totalStoreViews, bySource: storeViewsBySource },
        topListings,
        topStores,
      },
    };

    setCached(cacheKey, value);
    return res.json(value);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[admin-overview] unexpected:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};
