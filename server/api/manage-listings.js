// XOLOLO · E9 (fase 2) — lista de anuncios "como admin".
//
// Devuelve los listings del `adminId` resuelto por requireSellerContext
// (self para el dueño, workspace activo para colaborador con listings.edit).
// La UI de ManageListingsPage.duck.js la consume cuando detecta un
// workspace activo; en modo propio sigue usando sdk.ownListings directo.
//
// El shape de respuesta imita al del SDK (data, included, meta) para
// que el duck no tenga que transformar.
//
// Body JSON: los queryParams que se pasarían a sdk.ownListings.query,
// p.ej. { page, perPage, include, 'fields.image', ... }.

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { sendTransit } = require('../api-util/transitResponse');

module.exports = async (req, res) => {
  try {
    const adminId = req.actingAs.adminId;
    const isdk = getIntegrationSdk();
    if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

    const queryParams = req.body || {};
    const resp = await isdk.listings.query({
      authorId: adminId,
      ...queryParams,
    });

    // XOLOLO: Integration SDK marca listings como type:'listing', pero
    // ManageListingsPage.duck.js guarda en la slice 'ownListing' y
    // getOwnListingsById busca por ese tipo. Reescribimos el type para
    // que el reducer y el selector encuentren los listings.
    const toOwn = r => (r && r.type === 'listing' ? { ...r, type: 'ownListing' } : r);
    const data = (resp.data.data || []).map(toOwn);
    const included = (resp.data.included || []).map(toOwn);

    // sendTransit preserva Money/UUID/LatLng/BigDecimal como instancias
    // del SDK (res.json() los pierde y crashea formatMoney en cliente).
    return sendTransit(res, {
      data,
      included,
      meta: resp.data.meta || {},
    });
  } catch (e) {
    const status = e?.status || 500;
    // eslint-disable-next-line no-console
    console.error('[manage-listings] error:', e?.message);
    return res
      .status(status)
      .json({ error: status === 403 ? 'permission_denied' : 'internal' });
  }
};
