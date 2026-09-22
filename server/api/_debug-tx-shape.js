// XOLOLO F3 · TEMPORAL: debug endpoint para inspeccionar el shape
// real de tx en producción. Útil para diagnosticar el bug de
// productsSold=0 en public-store-stats.
//
// Gated por env DEBUG_TX_SHAPE_TOKEN. Borrar cuando termine debug.
//
// Contrato:
//   GET /api/_debug/tx-shape?token=<X>&slug=kike-pruebas
//   200 → {
//     totalTxs, byState: {state: n},
//     lineItemCodes: {code: n},
//     samples: [ { state, lineItemsRaw }, ... ]  (primeras 3)
//   }
//   401 → sin token o inválido.

const { getIntegrationSdk } = require('../api-util/integrationSdk');

const findSellerBySlug = async (isdk, slug) => {
  const resp = await isdk.users.query({ 'pub_slug': slug, perPage: 5 });
  const users = resp.data.data || [];
  return users.find(
    u => String(u.attributes?.profile?.publicData?.slug || '').toLowerCase() === String(slug).toLowerCase()
  );
};

module.exports = async (req, res) => {
  const token = req.query.token;
  const expected = process.env.DEBUG_TX_SHAPE_TOKEN;
  if (!expected || token !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const slug = String(req.query.slug || '').trim();
  const sellerIdParam = String(req.query.sellerId || '').trim();
  if (!slug && !sellerIdParam) {
    return res.status(400).json({ error: 'slug o sellerId requerido' });
  }

  try {
    const isdk = getIntegrationSdk();
    if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

    let sellerId = sellerIdParam;
    if (!sellerId) {
      const seller = await findSellerBySlug(isdk, slug);
      if (!seller) return res.status(404).json({ error: 'seller_not_found' });
      sellerId = seller.id.uuid;
    }

    // Trae hasta 100 tx del seller sin filtros.
    const resp = await isdk.transactions.query({
      providerId: sellerId,
      page: 1,
      perPage: 100,
      'fields.transaction': ['state', 'lastTransition', 'lineItems', 'payinTotal'],
    });

    const txs = resp.data.data || [];
    const byState = {};
    const lineItemCodes = {};
    const samples = [];

    for (const tx of txs) {
      const s = tx.attributes?.state || 'unknown';
      byState[s] = (byState[s] || 0) + 1;

      const lis = tx.attributes?.lineItems || [];
      for (const li of lis) {
        const code = li.code || 'no_code';
        lineItemCodes[code] = (lineItemCodes[code] || 0) + 1;
      }

      if (samples.length < 3) {
        samples.push({
          id: tx.id?.uuid,
          state: s,
          lastTransition: tx.attributes?.lastTransition,
          payin: tx.attributes?.payinTotal,
          lineItemsCount: lis.length,
          lineItemsRaw: lis, // objeto crudo — code, quantity, includeFor, unitPrice, etc.
        });
      }
    }

    return res.json({
      sellerId,
      totalTxs: txs.length,
      totalPages: resp.data.meta?.totalPages,
      byState,
      lineItemCodes,
      samples,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[_debug/tx-shape]', e?.message);
    return res.status(500).json({ error: 'internal', details: e?.message });
  }
};
