// XOLOLO F3 · Fase 4: métricas públicas de la tienda de un seller.
// Se consumen desde el widget que aparece en {slug}.xololo.mx para
// dar "prueba social" a buyers casuales.
//
// Contrato:
//   GET /api/public-store-stats?sellerId=<uuid>  o  ?slug=<slug>
//   200 → {
//     eligible: bool,
//     seller: { name, slug, memberSince, primaryColor?, logoUrl? },
//     stats?: {                       // presente sólo si eligible=true
//       ordersTotal, productsSold,
//       verified: bool,               // Sello Xololo verificado
//       memberMonths: number,
//     }
//   }
//   404 → { error: 'seller_not_found' }
//   500 → { error: 'internal' }
//
// Regla de "eligible" (ver §3.3 del doc):
//   Un seller sólo muestra el widget si tiene ≥ N ventas totales
//   (N=5 en v1). Esto evita que un seller nuevo con 0 ventas se
//   vea débil por defecto. Cuando aún no aplica, devolvemos
//   eligible:false con la data básica del seller para que el widget
//   pueda mostrar sólo "Vendedor nuevo" o esconderse.
//
// Sensible que exponemos y NO exponemos:
//   ✓ ordersTotal (# de ventas confirmadas, histórico)
//   ✓ productsSold (# de unidades)
//   ✓ verified (bool derivado del sello Xololo)
//   ✗ Revenue (montos) — privado, sólo el seller lo ve
//   ✗ Emails/teléfono
//   ✗ Data de buyers
//
// Cache in-memory 10 min por (sellerId) — las stats públicas no
// cambian tan rápido.

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { readLineItemQty } = require('../api-util/lineItemMoney');

const MIN_ORDERS_FOR_ELIGIBLE = 5;
const MEMBER_MONTHS_VERIFIED = 2; // > 2 meses en la plataforma
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map();

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

// Cuenta ventas confirmadas del seller + unidades vendidas.
// No filtramos por rango — es histórico total (prueba social se
// beneficia de números grandes).
const fetchSellerStats = async (isdk, sellerId) => {
  let ordersTotal = 0;
  let productsSold = 0;
  for (let page = 1; page <= 20; page++) {
    const resp = await isdk.transactions.query({
      providerId: sellerId,
      page,
      perPage: 100,
      'fields.transaction': ['state', 'lineItems'],
    });
    const data = resp.data.data || [];
    for (const tx of data) {
      const s = tx.attributes?.state;
      if (s === 'canceled' || s === 'refunded') continue;
      // Cuenta la tx sólo si tuvo pago confirmado (state !== 'inquired'
      // o 'pending-payment'). Sharetribe expone 'purchased', 'delivered',
      // 'completed', etc. como confirmed.
      if (s === 'inquired' || s === 'pending-payment' || s === 'pending') continue;
      ordersTotal += 1;
      for (const li of tx.attributes?.lineItems || []) {
        if (li.code !== 'line-item/item') continue;
        const inc = li.includeFor || [];
        if (!inc.includes('customer') || !inc.includes('provider')) continue;
        productsSold += readLineItemQty(li);
      }
    }
    const totalPages = resp.data.meta?.totalPages || 1;
    if (page >= totalPages) break;
  }
  return { ordersTotal, productsSold };
};

const findSellerBySlug = async (isdk, slug) => {
  // Búsqueda por publicData.slug con Integration API.
  const resp = await isdk.users.query({
    'pub_slug': slug,
    perPage: 5,
  });
  const users = resp.data.data || [];
  // Match exacto — case-insensitive por si acaso.
  const match = users.find(
    u => String(u.attributes?.profile?.publicData?.slug || '').toLowerCase() === String(slug).toLowerCase()
  );
  return match || null;
};

module.exports = async (req, res) => {
  try {
    const sellerId = String(req.query.sellerId || '').trim();
    const slug = String(req.query.slug || '').trim();
    if (!sellerId && !slug) {
      return res.status(400).json({ error: 'invalid_request', details: 'sellerId o slug requerido.' });
    }

    const cacheK = sellerId ? `id:${sellerId}` : `slug:${slug.toLowerCase()}`;
    const hit = getCached(cacheK);
    if (hit) return res.json({ ...hit, cached: true });

    const isdk = getIntegrationSdk();
    if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

    // Resolver el seller.
    let seller;
    try {
      if (sellerId) {
        const r = await isdk.users.show({ id: sellerId });
        seller = r.data.data;
      } else {
        seller = await findSellerBySlug(isdk, slug);
      }
    } catch (e) {
      if (e.status === 404) return res.status(404).json({ error: 'seller_not_found' });
      throw e;
    }
    if (!seller) return res.status(404).json({ error: 'seller_not_found' });

    const sellerAttrs = seller.attributes || {};
    const profile = sellerAttrs.profile || {};
    const pd = profile.publicData || {};

    // Fetch stats.
    const { ordersTotal, productsSold } = await fetchSellerStats(isdk, seller.id.uuid);

    // Miembro desde: usamos createdAt del user.
    const createdAt = sellerAttrs.createdAt || null;
    const memberMonths = createdAt
      ? Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / (30.4 * 24 * 60 * 60 * 1000)))
      : 0;

    const eligible = ordersTotal >= MIN_ORDERS_FOR_ELIGIBLE;
    const verified = eligible && memberMonths >= MEMBER_MONTHS_VERIFIED;

    const response = {
      eligible,
      seller: {
        id: seller.id.uuid,
        name: profile.displayName || 'Tienda',
        slug: pd.slug || null,
        primaryColor: pd.brandPrimaryColor || pd.storePrimaryColor || null,
        logoUrl: pd.logoUrl || pd.brandLogoUrl || null,
        memberSince: createdAt,
      },
    };
    if (eligible) {
      response.stats = {
        ordersTotal,
        productsSold,
        verified,
        memberMonths,
      };
    }
    setCached(cacheK, response);
    return res.json(response);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[public-store-stats] unexpected:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};
