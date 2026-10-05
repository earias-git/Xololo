// XOLOLO Promote: lista de listings del seller autenticado para
// mostrarlos en Dashboard > Promote. Devuelve lo mínimo necesario
// para renderizar cards con acciones de promoción.
//
// Contrato:
//   GET /api/seller-promo-listings
//   200 → { listings: [{ id, title, slug, imageUrl, priceSubunits,
//                        priceCurrency, state, viewCount }],
//          sellerLogoDataUrl: string | null,
//          sellerName: string | null }
//   401 → { error: 'unauthorized' }
//   500 → { error: 'internal' }
//
// sellerLogoDataUrl: data: URL del logo del seller, ya fetcheado
//   server-side para evitar CORS del R2. Prioridad: publicData.logoUrl
//   > profileImage avatar > null. Cacheado en memoria 10 min por URL.
// sellerName: nombre de la tienda. Prioridad: publicData.storeName >
//   profile.displayName > "firstName lastName" > null. Fallback escrito
//   cuando no hay logo. Nunca falla la respuesta: si ambos son null,
//   el BrandMark queda vacío (sin placeholder "XOLOLO").
//
// viewCount = tx.metadata.listingViewedTotal si existe (pipeline de
// tracking F3 Sprint 2), 0 si no. Los stats por source se leerán
// después con endpoints ya existentes de analytics.

const { getSdk } = require('../api-util/sdk');
const { createTTLCache } = require('../api-util/cache');

// Cache in-memory 10 min para no re-fetchear el logo en cada hit del
// dashboard. Key: la URL del logo (así invalida solo cuando el seller
// sube uno nuevo). Valor: data URL base64 completo.
const logoCache = createTTLCache(600);

const fetchAsDataUrl = async url => {
  if (!url) return null;
  const cached = logoCache[url]?.data;
  if (cached) return cached;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // Limitar tamaño: 2 MB max al dibujar un logo en una etiqueta no
    // tiene sentido pasar de ahí. Si viene más grande, descartamos.
    if (buf.length > 2 * 1024 * 1024) return null;
    const type = res.headers.get('content-type') || 'image/png';
    const dataUrl = `data:${type};base64,${buf.toString('base64')}`;
    logoCache[url] = dataUrl;
    return dataUrl;
  } catch (_e) {
    return null;
  }
};

const firstImageUrl = listing => {
  const imgRels = listing.relationships?.images?.data || [];
  if (imgRels.length === 0) return null;
  const included = listing._includedImages || [];
  const first = included.find(r => r.type === 'image' && r.id?.uuid === imgRels[0].id?.uuid);
  return (
    first?.attributes?.variants?.['listing-card']?.url ||
    first?.attributes?.variants?.['scaled-small']?.url ||
    null
  );
};

module.exports = async (req, res) => {
  try {
    const sdk = getSdk(req, res);

    // XOLOLO Promote: logo del seller + nombre de tienda para los
    // diseños para imprimir.
    //   sellerLogoDataUrl: fetcheamos server-side y mandamos ya como
    //     data: URL. El cliente no puede fetchear el logo del R2
    //     directamente por CORS (R2 por default no manda headers CORS).
    //     Prioridad: publicData.logoUrl → profileImage avatar → null.
    //   sellerName: profile.publicData.storeName > displayName >
    //     "firstName lastName" > null. Fallback escrito cuando no hay
    //     logo utilizable.
    let sellerLogoDataUrl = null;
    let sellerName = null;
    try {
      const me = await sdk.currentUser.show({
        include: ['profileImage'],
        'fields.image': ['variants.square-small2x', 'variants.square-small'],
      });
      const u = me?.data?.data;
      const profile = u?.attributes?.profile || {};
      let rawLogoUrl = profile?.publicData?.logoUrl || null;
      if (!rawLogoUrl) {
        const imgRel = u?.relationships?.profileImage?.data;
        const includedUser = me?.data?.included || [];
        const avatar = imgRel
          ? includedUser.find(r => r.type === 'image' && r.id?.uuid === imgRel.id?.uuid)
          : null;
        rawLogoUrl =
          avatar?.attributes?.variants?.['square-small2x']?.url ||
          avatar?.attributes?.variants?.['square-small']?.url ||
          null;
      }
      if (rawLogoUrl) {
        sellerLogoDataUrl = await fetchAsDataUrl(rawLogoUrl);
      }
      sellerName =
        profile?.publicData?.storeName ||
        profile?.displayName ||
        [profile?.firstName, profile?.lastName].filter(Boolean).join(' ').trim() ||
        null;
    } catch (_e) {
      // No bloqueante: si falla, el BrandMark queda vacío (no se
      // muestra ningún texto placeholder tipo "XOLOLO").
    }

    let response;
    try {
      response = await sdk.ownListings.query({
        include: ['images'],
        'fields.listing': [
          'title',
          'state',
          'price',
          'publicData.listingType',
          'metadata',
        ],
        'fields.image': ['variants.listing-card', 'variants.scaled-small'],
        perPage: 100,
      });
    } catch (e) {
      if (e.status === 401) return res.status(401).json({ error: 'unauthorized' });
      throw e;
    }
    const data = response.data.data || [];
    const included = response.data.included || [];
    // Attach included images to each listing so firstImageUrl can find them.
    data.forEach(l => {
      l._includedImages = included;
    });
    const listings = data.map(l => {
      const price = l.attributes?.price;
      const meta = l.attributes?.metadata || {};
      const viewedTotals = meta.listingViewedTotal || meta.xoloListingViewed || null;
      const viewCount =
        (viewedTotals && (viewedTotals.count || viewedTotals.total)) ||
        (typeof viewedTotals === 'number' ? viewedTotals : 0);
      // Slug basado en título — Sharetribe suele usar el mismo patrón.
      const slug = String(l.attributes?.title || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'listing';
      return {
        id: l.id?.uuid,
        title: l.attributes?.title || 'Sin título',
        slug,
        imageUrl: firstImageUrl(l),
        priceSubunits: price?.amount || 0,
        priceCurrency: price?.currency || 'MXN',
        state: l.attributes?.state,
        viewCount,
      };
    });
    // Sólo mostrar published (no draft, no closed).
    const published = listings.filter(l => l.state === 'published');
    return res.json({ listings: published, sellerLogoDataUrl, sellerName });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('seller-promo-listings unexpected:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};
