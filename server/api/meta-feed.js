// XOLOLO Promote: feed CSV compatible con Meta Commerce Manager.
//
// Contrato:
//   GET /api/meta-feed/:sellerId.csv
//   200 → text/csv con header `id,title,description,...` y una fila
//         por listing publicado del seller.
//   404 → { error: 'not_found' } si el seller no existe o no tiene
//         listings publicados.
//   500 → { error: 'internal' }
//
// Columnas: subset mínimo exigido por Meta Commerce +
// descriptores opcionales útiles. Spec oficial:
// https://www.facebook.com/business/help/120325381656392
//
// Diseño:
//   - El endpoint es PÚBLICO: Meta Catalog lo fetches con su crawler,
//     no envía auth. La "privacidad" práctica depende de la entropía
//     del UUID del seller (uuid v4 — ~122 bits), suficientemente alta
//     para no ser enumerable.
//   - Usamos Integration SDK para consultar listings publicados por
//     authorId=sellerId sin requerir que el seller esté autenticado.
//   - Cache simple en memoria (5 min) para no re-consultar Sharetribe
//     en cada tick del crawler de Meta.
//
// Diferencia con /api/seller-promo-listings:
//   - Ese endpoint es per-user autenticado (listings propios).
//   - Éste es per-sellerId público, sin auth, sólo lectura.

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { getRootURL } = require('../api-util/rootURL');

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // sellerId -> { csv, expiresAt }

const CSV_HEADERS = [
  'id',
  'title',
  'description',
  'availability',
  'condition',
  'price',
  'link',
  'image_link',
  'brand',
];

const escapeCsv = v => {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
};

const slugify = s =>
  String(s || 'listing')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '') || 'listing';

const firstImageUrlFromIncluded = (listing, included) => {
  const imgRels = listing.relationships?.images?.data || [];
  if (imgRels.length === 0) return null;
  const first = included.find(
    r => r.type === 'image' && r.id?.uuid === imgRels[0].id?.uuid
  );
  // Preferimos variants grandes para Meta (ellos re-escalan).
  const variants = first?.attributes?.variants || {};
  return (
    variants['scaled-xlarge']?.url ||
    variants['scaled-large']?.url ||
    variants['scaled-medium']?.url ||
    variants['listing-card']?.url ||
    null
  );
};

const formatPrice = price => {
  if (!price || !price.amount) return '0.00 MXN';
  const amount = (price.amount / 100).toFixed(2);
  return `${amount} ${price.currency || 'MXN'}`;
};

const buildCsv = async (sellerId, origin) => {
  const isdk = getIntegrationSdk();
  if (!isdk) {
    const err = new Error('integration_sdk_missing');
    err.status = 500;
    throw err;
  }

  // Query listings publicados del seller via Integration API.
  const response = await isdk.listings.query({
    authorId: sellerId,
    states: ['published'],
    include: ['images', 'author'],
    'fields.listing': ['title', 'description', 'state', 'price', 'publicData'],
    'fields.image': [
      'variants.scaled-xlarge',
      'variants.scaled-large',
      'variants.scaled-medium',
      'variants.listing-card',
    ],
    'fields.user': ['profile.displayName'],
    perPage: 100,
  });

  const data = response.data.data || [];
  const included = response.data.included || [];
  if (data.length === 0) return null;

  // Nombre de marca: displayName del seller.
  const authorRel = data[0].relationships?.author?.data;
  const author = authorRel
    ? included.find(r => r.type === 'user' && r.id?.uuid === authorRel.id?.uuid)
    : null;
  const brand = author?.attributes?.profile?.displayName || 'Xololo';

  const rows = data
    .map(l => {
      const title = l.attributes?.title || 'Sin título';
      const description = (l.attributes?.description || title).slice(0, 5000);
      const price = formatPrice(l.attributes?.price);
      const slug = slugify(title);
      const link = `${origin}/l/${slug}/${l.id?.uuid}?utm_source=meta-commerce&utm_medium=xolo-promo&utm_campaign=feed`;
      const imageLink = firstImageUrlFromIncluded(l, included);
      if (!imageLink) return null; // Meta requiere image_link.
      return [
        l.id?.uuid,
        title,
        description,
        'in stock',
        l.attributes?.publicData?.condition || 'new',
        price,
        link,
        imageLink,
        brand,
      ].map(escapeCsv);
    })
    .filter(Boolean);

  if (rows.length === 0) return null;

  const csv = [CSV_HEADERS.join(','), ...rows.map(r => r.join(','))].join('\n');
  return csv;
};

module.exports = async (req, res) => {
  try {
    // El path incluye `.csv` como sufijo para que Meta identifique el
    // tipo. Express pasa el ":sellerId.csv" entero en req.params. Lo
    // separamos aquí.
    const raw = req.params.sellerId || '';
    const sellerId = raw.replace(/\.csv$/i, '');
    // Validación básica de UUID v4-ish.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sellerId)) {
      return res.status(400).json({ error: 'invalid_seller_id' });
    }

    const now = Date.now();
    const cached = cache.get(sellerId);
    if (cached && cached.expiresAt > now) {
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Cache-Control', 'public, max-age=300');
      return res.status(200).send(cached.csv);
    }

    const origin = getRootURL();
    const csv = await buildCsv(sellerId, origin);
    if (csv == null) {
      return res.status(404).json({ error: 'not_found' });
    }

    cache.set(sellerId, { csv, expiresAt: now + CACHE_TTL_MS });

    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=300');
    res.set(
      'Content-Disposition',
      `inline; filename="xololo-meta-feed-${sellerId}.csv"`
    );
    return res.status(200).send(csv);
  } catch (e) {
    const status = e?.status === 404 ? 404 : 500;
    const errorKey = e?.message || 'internal';
    console.error('[meta-feed] error', errorKey, e);
    return res.status(status).json({ error: errorKey });
  }
};
