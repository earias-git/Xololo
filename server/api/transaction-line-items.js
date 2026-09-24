const { transactionLineItems } = require('../api-util/lineItems');
const { getSdk, handleError, serialize, fetchCommission } = require('../api-util/sdk');
const { constructValidLineItems } = require('../api-util/lineItemHelpers');

// XOLOLO Cart.5: sanitiza additionalCartItems para el breakdown
// speculative. Filtra entradas inválidas y evita duplicar el primary.
const sanitizeAdditionalCartItems = (orderData, primaryListingId) => {
  const raw = Array.isArray(orderData?.additionalCartItems) ? orderData.additionalCartItems : [];
  const seen = new Set([primaryListingId]);
  const cleaned = [];
  for (const it of raw) {
    const id = it?.listingId;
    const qty = Number(it?.quantity);
    if (!id || !Number.isInteger(qty) || qty <= 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    cleaned.push({ listingId: id, quantity: qty });
  }
  return cleaned;
};

module.exports = (req, res) => {
  const { isOwnListing, listingId, orderData } = req.body || {};

  const sdk = getSdk(req, res);

  // XOLOLO: include=author para que la validación same-seller de
  // multi-item cart no falle con undefined === undefined. Mismo bug
  // que se arregló en initiate-privileged.js.
  const listingPromise = id =>
    isOwnListing
      ? sdk.ownListings.show({ id, include: ['author'] })
      : sdk.listings.show({ id, include: ['author'] });

  const additionalCartRaw = sanitizeAdditionalCartItems(orderData, listingId);

  Promise.all([
    listingPromise(listingId),
    ...additionalCartRaw.map(x => sdk.listings.show({ id: x.listingId, include: ['author'] })),
    fetchCommission(sdk),
  ])
    .then(responses => {
      const nExtra = additionalCartRaw.length;
      const showListingResponse = responses[0];
      const additionalResponses = responses.slice(1, 1 + nExtra);
      const fetchAssetsResponse = responses[1 + nExtra];

      const listing = showListingResponse.data.data;
      const additionalListings = additionalResponses.map(r => r.data.data);
      const commissionAsset = fetchAssetsResponse.data.data[0];

      // Validación same-seller también en el breakdown (evita mostrar
      // un breakdown "falso" antes del checkout). Filtramos silenciosamente
      // los cross-seller aquí — el initiate-privileged es quien devuelve
      // 400 si el buyer intenta cerrar la orden.
      const primaryAuthorId = listing.relationships?.author?.data?.id?.uuid;
      const additionalCartItems = additionalListings
        .map((l, i) => ({ listing: l, quantity: additionalCartRaw[i].quantity }))
        .filter(x => x.listing.relationships?.author?.data?.id?.uuid === primaryAuthorId);

      const { providerCommission, customerCommission } =
        commissionAsset?.type === 'jsonAsset' ? commissionAsset.attributes.data : {};

      const lineItems = transactionLineItems(
        listing,
        { ...orderData, additionalCartItems },
        providerCommission,
        customerCommission
      );

      // Because we are using returned lineItems directly in this template we need to use the helper function
      // to add some attributes like lineTotal and reversal that Marketplace API also adds to the response.
      const validLineItems = constructValidLineItems(lineItems);

      res
        .status(200)
        .set('Content-Type', 'application/transit+json')
        .send(serialize({ data: validLineItems }))
        .end();
    })
    .catch(e => {
      handleError(res, e);
    });
};
