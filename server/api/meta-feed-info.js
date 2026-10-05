// XOLOLO Promote: devuelve al seller autenticado la URL de su feed
// público de Meta Commerce, más conteo de listings publicados para
// que el dashboard muestre un hint ("Se publicarán N productos").
//
// Contrato:
//   GET /api/meta-feed-info
//   200 → { feedUrl, listingCount, sellerId }
//   401 → { error: 'unauthorized' }
//   500 → { error: 'internal' }
//
// El feedUrl apunta a /api/meta-feed/:sellerId.csv (ver meta-feed.js),
// armado con el ROOT URL público del marketplace.

const { getSdk } = require('../api-util/sdk');
const { getRootURL } = require('../api-util/rootURL');

module.exports = async (req, res) => {
  try {
    const sdk = getSdk(req, res);
    let me;
    try {
      me = await sdk.currentUser.show();
    } catch (e) {
      if (e.status === 401) return res.status(401).json({ error: 'unauthorized' });
      throw e;
    }
    const sellerId = me.data.data.id?.uuid;
    if (!sellerId) return res.status(401).json({ error: 'unauthorized' });

    // Conteo rápido de listings publicados del seller.
    let listingCount = 0;
    try {
      const listingsResp = await sdk.ownListings.query({
        'fields.listing': ['state'],
        perPage: 100,
      });
      const data = listingsResp.data.data || [];
      listingCount = data.filter(l => l.attributes?.state === 'published').length;
    } catch (_e) {
      // No bloqueante: la UI puede mostrar el feedUrl sin el conteo.
    }

    const origin = getRootURL();
    const feedUrl = `${origin}/api/meta-feed/${sellerId}.csv`;

    return res.status(200).json({ feedUrl, listingCount, sellerId });
  } catch (e) {
    console.error('[meta-feed-info] error', e?.message, e);
    return res.status(500).json({ error: 'internal' });
  }
};
