// XOLOLO Promote: lista de listings del seller autenticado para
// mostrarlos en Dashboard > Promote. Devuelve lo mínimo necesario
// para renderizar cards con acciones de promoción.
//
// Contrato:
//   GET /api/seller-promo-listings
//   200 → { listings: [{ id, title, slug, imageUrl, priceSubunits,
//                        priceCurrency, state, viewCount }],
//          sellerLogoUrl: string | null }
//   401 → { error: 'unauthorized' }
//   500 → { error: 'internal' }
//
// sellerLogoUrl: logo del seller para los diseños para imprimir
// (sub-commit 2). Prioridad: publicData.logoUrl > profileImage avatar
// > null. Nunca falla la respuesta: si no hay logo, el editor usa el
// fallback de marca "XOLOLO".
//
// viewCount = tx.metadata.listingViewedTotal si existe (pipeline de
// tracking F3 Sprint 2), 0 si no. Los stats por source se leerán
// después con endpoints ya existentes de analytics.

const { getSdk } = require('../api-util/sdk');

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

    // XOLOLO Promote sub-commit 2: logo del seller para los diseños
    // para imprimir. publicData.logoUrl lo configura el seller en
    // ManageStore; fallback a su profileImage (variant square-small2x).
    let sellerLogoUrl = null;
    try {
      const me = await sdk.currentUser.show({
        include: ['profileImage'],
        'fields.image': ['variants.square-small2x', 'variants.square-small'],
      });
      const u = me?.data?.data;
      sellerLogoUrl = u?.attributes?.profile?.publicData?.logoUrl || null;
      if (!sellerLogoUrl) {
        const imgRel = u?.relationships?.profileImage?.data;
        const includedUser = me?.data?.included || [];
        const avatar = imgRel
          ? includedUser.find(r => r.type === 'image' && r.id?.uuid === imgRel.id?.uuid)
          : null;
        sellerLogoUrl =
          avatar?.attributes?.variants?.['square-small2x']?.url ||
          avatar?.attributes?.variants?.['square-small']?.url ||
          null;
      }
    } catch (_e) {
      // No bloqueante: si falla, los diseños caen al fallback de marca
      // "XOLOLO" por default.
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
    return res.json({ listings: published, sellerLogoUrl });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('seller-promo-listings unexpected:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};
