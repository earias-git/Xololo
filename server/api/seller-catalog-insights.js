// XOLOLO F3 · Sprint 3: insights de catálogo para el seller.
//
// Contrato:
//   GET /api/seller-catalog-insights?from=YYYY-MM-DD&to=YYYY-MM-DD
//   Auth: user logueado.
//   200 → {
//     from, to,
//     topBySales: [
//       { listingId, title, imageUrl, unitsSold, revenueAmount,
//         revenueCurrency, pctOfTotal }
//     ],
//     alerts: {
//       lowStock:   [{ listingId, title, imageUrl, stock }],
//       stale:      [{ listingId, title, imageUrl, updatedAt, daysSince }],
//       noSales:    [{ listingId, title, imageUrl, createdAt, daysSince }],
//     },
//     totals: { salesAmount, salesCurrency, unitsSold, listingsCount },
//   }
//   400 → { error: 'invalid_request' }
//   401 → { error: 'unauthorized' }
//   500 → { error: 'internal' }
//
// Estrategia:
//   - Trae en paralelo las tx del provider (via sdk normal, paginado) y
//     los listings del provider (via ownListings.query).
//   - Agrupa tx por listing (usando tx.lineItems) para top-sales.
//   - Alertas:
//       lowStock: currentStock ≤ 3 (sólo listings con stock definido).
//       stale: attributes.state === 'published' Y updatedAt/createdAt
//              hace >90d Y publishedAt > hace >90d.
//       noSales: listings publicados >30d que no aparecen en top-sales
//                del rango.
//   - Cache in-memory 5min por (userId, from, to).

const { getSdk } = require('../api-util/sdk');

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 200;
const cache = new Map();

const cacheKey = (userId, from, to) => `${userId}|${from}|${to}`;

const getCached = key => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
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

const LOW_STOCK_THRESHOLD = 3;
const STALE_DAYS = 90;
const NO_SALES_DAYS = 30;
const TOP_N = 10;

// --------- helpers ---------

// Suma unidades vendidas + revenue por listing desde las tx del rango.
// Usa tx.lineItems para capturar carritos multi-item (cada item cuenta).
const aggregateByListing = txs => {
  const byListing = new Map();
  for (const tx of txs) {
    const attrs = tx.attributes || {};
    if (attrs.state === 'canceled' || attrs.state === 'refunded') continue;
    const primaryListingId = tx.relationships?.listing?.data?.id?.uuid;
    if (!primaryListingId) continue;

    const lineItems = attrs.lineItems || [];
    // Contamos cada línea 'line-item/item' del customer+provider como
    // unidad vendida. En carritos multi-item Cart.5, el "primary listing"
    // de la tx tiene su línea + puede haber extras (pero esos extras
    // apuntan al mismo primaryListingId en Sharetribe — así que en v1
    // los agrupamos bajo el primary. Cart.6 planned: refactor para
    // atribuir cada extra a su propio listingId).
    for (const li of lineItems) {
      if (li.code !== 'line-item/item') continue;
      const includes = li.includeFor || [];
      if (!includes.includes('customer') || !includes.includes('provider')) continue;
      const qty = Number(li.quantity) || 0;
      const lineTotal = li.lineTotal?.amount || 0;
      let entry = byListing.get(primaryListingId);
      if (!entry) {
        entry = { unitsSold: 0, revenueAmount: 0, revenueCurrency: 'MXN' };
        byListing.set(primaryListingId, entry);
      }
      entry.unitsSold += qty;
      entry.revenueAmount += lineTotal;
      entry.revenueCurrency = li.lineTotal?.currency || entry.revenueCurrency;
    }
  }
  return byListing;
};

// Extrae url de la primer imagen 'listing-card' del listing.
const firstImageUrl = (listing, included) => {
  const imgRels = listing.relationships?.images?.data || [];
  const firstImgId = imgRels[0]?.id?.uuid;
  if (!firstImgId) return null;
  const imgResource = (included || []).find(
    r => r.type === 'image' && r.id.uuid === firstImgId
  );
  const variants = imgResource?.attributes?.variants || {};
  return (
    variants['listing-card']?.url ||
    variants['default']?.url ||
    variants['square-small']?.url ||
    null
  );
};

const daysBetween = (fromIso, toDate = new Date()) => {
  if (!fromIso) return null;
  const diff = toDate.getTime() - new Date(fromIso).getTime();
  return Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)));
};

module.exports = async (req, res) => {
  try {
    const { from, to } = req.query || {};
    if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
      return res.status(400).json({ error: 'invalid_request', details: 'from/to deben ser YYYY-MM-DD.' });
    }
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T23:59:59.999Z`);
    if (isNaN(fromDate) || isNaN(toDate) || fromDate > toDate) {
      return res.status(400).json({ error: 'invalid_request', details: 'rango inválido.' });
    }

    const sdk = getSdk(req, res);

    let currentUser;
    try {
      const resp = await sdk.currentUser.show();
      currentUser = resp.data.data;
    } catch (e) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const userId = currentUser.id.uuid;

    const key = cacheKey(userId, from, to);
    const hit = getCached(key);
    if (hit) return res.json({ ...hit, cached: true });

    // Fetch en paralelo: tx del provider en rango + own listings.
    const [txsResult, listingsResult] = await Promise.all([
      (async () => {
        const all = [];
        for (let page = 1; page <= 5; page++) {
          const resp = await sdk.transactions.query({
            only: 'sale',
            page,
            perPage: 100,
            include: ['listing'],
            'fields.transaction': [
              'createdAt',
              'lastTransitionedAt',
              'state',
              'lineItems',
            ],
            'fields.listing': ['title'],
          });
          const data = resp.data.data || [];
          for (const tx of data) {
            const ca = tx.attributes?.createdAt
              ? new Date(tx.attributes.createdAt).getTime()
              : 0;
            if (ca >= fromDate.getTime() && ca <= toDate.getTime()) {
              all.push(tx);
            }
          }
          const totalPages = resp.data.meta?.totalPages || 1;
          if (page >= totalPages) break;
          const oldestInPage = data[data.length - 1]?.attributes?.createdAt;
          if (oldestInPage && new Date(oldestInPage).getTime() < fromDate.getTime()) break;
        }
        return all;
      })(),
      (async () => {
        const all = [];
        let included = [];
        for (let page = 1; page <= 5; page++) {
          const resp = await sdk.ownListings.query({
            page,
            perPage: 100,
            include: ['images'],
            'fields.image': ['variants.listing-card'],
          });
          all.push(...(resp.data.data || []));
          included = included.concat(resp.data.included || []);
          const totalPages = resp.data.meta?.totalPages || 1;
          if (page >= totalPages) break;
        }
        return { listings: all, included };
      })(),
    ]);

    const txs = txsResult;
    const listings = listingsResult.listings;
    const included = listingsResult.included;

    // Index de listings por id para lookups rápidos.
    const listingById = new Map();
    for (const l of listings) {
      listingById.set(l.id.uuid, l);
    }

    // Aggregate por listing.
    const salesByListing = aggregateByListing(txs);

    // Total revenue para calcular %.
    let totalRevenue = 0;
    let totalUnits = 0;
    let currency = 'MXN';
    for (const [, v] of salesByListing) {
      totalRevenue += v.revenueAmount;
      totalUnits += v.unitsSold;
      currency = v.revenueCurrency || currency;
    }

    // Top-N by revenue, con datos del listing (title + imagen).
    const sortedIds = Array.from(salesByListing.entries())
      .sort((a, b) => b[1].revenueAmount - a[1].revenueAmount)
      .slice(0, TOP_N)
      .map(([id]) => id);

    const topBySales = sortedIds.map(id => {
      const stats = salesByListing.get(id);
      const listing = listingById.get(id);
      return {
        listingId: id,
        title: listing?.attributes?.title || 'Producto',
        imageUrl: listing ? firstImageUrl(listing, included) : null,
        unitsSold: stats.unitsSold,
        revenueAmount: stats.revenueAmount,
        revenueCurrency: stats.revenueCurrency,
        pctOfTotal: totalRevenue > 0 ? Math.round((stats.revenueAmount / totalRevenue) * 100) : 0,
      };
    });

    // Alertas.
    const lowStock = [];
    const stale = [];
    const noSales = [];
    const now = new Date();

    for (const listing of listings) {
      const attrs = listing.attributes || {};
      if (attrs.state !== 'published') continue; // solo activos
      const listingId = listing.id.uuid;
      const title = attrs.title || 'Producto';
      const imageUrl = firstImageUrl(listing, included);

      // Stock. En Sharetribe products, stock viene en `currentStock`
      // (relación separada) o en publicData según setup. Aquí leemos
      // attributes.publicData.stock si existe, fallback a attributes.stock.
      const stock =
        attrs.publicData?.stock ??
        attrs.stock ??
        null;
      if (typeof stock === 'number' && stock <= LOW_STOCK_THRESHOLD && stock > 0) {
        lowStock.push({ listingId, title, imageUrl, stock });
      }

      // Stale: sin actualizar > 90 días. Usamos attributes.updatedAt si
      // existe, sino createdAt como fallback (listing nunca editado).
      const updatedIso = attrs.updatedAt || attrs.createdAt;
      const daysSinceUpdate = daysBetween(updatedIso, now);
      if (daysSinceUpdate !== null && daysSinceUpdate > STALE_DAYS) {
        stale.push({ listingId, title, imageUrl, updatedAt: updatedIso, daysSince: daysSinceUpdate });
      }

      // No sales: publicado > 30 días y sin ventas en el rango consultado.
      const createdIso = attrs.createdAt;
      const daysSinceCreated = daysBetween(createdIso, now);
      if (
        daysSinceCreated !== null &&
        daysSinceCreated > NO_SALES_DAYS &&
        !salesByListing.has(listingId)
      ) {
        noSales.push({ listingId, title, imageUrl, createdAt: createdIso, daysSince: daysSinceCreated });
      }
    }

    // Ordena las alertas por severidad natural.
    lowStock.sort((a, b) => a.stock - b.stock);
    stale.sort((a, b) => b.daysSince - a.daysSince);
    noSales.sort((a, b) => b.daysSince - a.daysSince);

    const value = {
      from,
      to,
      topBySales,
      alerts: {
        lowStock: lowStock.slice(0, 20),
        stale: stale.slice(0, 20),
        noSales: noSales.slice(0, 20),
      },
      totals: {
        salesAmount: totalRevenue,
        salesCurrency: currency,
        unitsSold: totalUnits,
        listingsCount: listings.length,
      },
    };

    setCached(key, value);
    return res.json(value);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[seller-catalog-insights] unexpected:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};
