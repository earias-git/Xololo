// XOLOLO · E9 fase 3 — inbox "como admin".
//
// Devuelve las transactions donde el `adminId` resuelto por
// requireSellerContext es provider (tab=sales) o customer (tab=orders).
// La UI de InboxPage.duck.js la consume cuando detecta un workspace
// activo; en modo propio sigue usando sdk.transactions.query directo.
//
// Body JSON acepta todos los queryParams del SDK (page, perPage, include,
// fields.*, sort). Además:
//   - role: 'provider' | 'customer' — determina si filtramos por
//     providerId (sales) o customerId (orders). Default: 'provider'.
//
// El shape de respuesta imita al del SDK (data, included, meta).

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { sendTransit } = require('../api-util/transitResponse');

module.exports = async (req, res) => {
  try {
    const adminId = req.actingAs.adminId;
    const isdk = getIntegrationSdk();
    if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

    const { role, ...queryParams } = req.body || {};
    // El filtro clave: providerId para ventas, customerId para compras.
    const roleFilter =
      role === 'customer' ? { customerId: adminId } : { providerId: adminId };

    const resp = await isdk.transactions.query({
      ...queryParams,
      ...roleFilter,
    });

    // Transit preserva Money/UUID — res.json() los pierde.
    return sendTransit(res, {
      data: resp.data.data,
      included: resp.data.included || [],
      meta: resp.data.meta || {},
    });
  } catch (e) {
    const status = e?.status || 500;
    // eslint-disable-next-line no-console
    console.error('[inbox-transactions] error:', e?.message);
    return res
      .status(status)
      .json({ error: status === 403 ? 'permission_denied' : 'internal' });
  }
};
