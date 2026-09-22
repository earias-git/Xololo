// XOLOLO: helper para construir el `context` estándar que consume el
// dispatcher (sendEventNotifications). Cuatro entry points lo usan:
//
//   - server/api/generate-shipping-guide.js  → order.label_generated
//   - server/api/webhooks/skydropx.js        → order.picked_up/in_transit/…
//   - server/api/order-survey.js             → order.dispute_opened
//   - server/jobs/tacit-acceptance.js        → order.tacit_acceptance
//
// El context tiene el shape que los templates de notifications esperan:
//   { buyer, seller, listing, order, carrier?, tracking?, ...extras }
//
// - buyer: {name, email, whatsapp}
// - seller: {name, email, whatsapp, logoUrl, primaryColor, secondaryColor, slug}
//    (los últimos 5 son para dual-brand en emails al buyer)
// - listing: {title}
// - order: {url}  → apunta a /order/:txId por default
// - carrier / tracking: opcionales, del snapshot xololoShippingGuide si existe
// - overrides: cualquier cosa que el caller pase se hace deep-merge encima

const buildOrderUrl = txId => {
  const root = (process.env.REACT_APP_MARKETPLACE_ROOT_URL || 'https://xololo.mx').replace(
    /\/$/,
    ''
  );
  return `${root}/order/${txId}`;
};

const buildSaleUrl = txId => {
  const root = (process.env.REACT_APP_MARKETPLACE_ROOT_URL || 'https://xololo.mx').replace(
    /\/$/,
    ''
  );
  return `${root}/sale/${txId}/details`;
};

// Construye el context desde una transaction. Necesita el Integration
// SDK para poder resolver buyer/seller/listing (los includes de la tx
// pueden no estar cargados). Si falla algún lookup, devuelve el context
// con lo que tenga y sigue — las notificaciones nunca deben romper el
// flow principal.
//
// @param {Object} isdk        Integration SDK ya inicializado
// @param {Object} tx          Transaction data (con relationships)
// @param {Object} [overrides] Overrides parciales, deep-mergeados al final
// @returns {Object} context listo para sendEventNotifications
const buildTxContext = async (isdk, tx, overrides = {}) => {
  const txId = tx?.id?.uuid;
  const customerId = tx?.relationships?.customer?.data?.id?.uuid;
  const providerId = tx?.relationships?.provider?.data?.id?.uuid;
  const listingId = tx?.relationships?.listing?.data?.id?.uuid;
  const meta = tx?.attributes?.metadata || {};
  const guide = meta.xololoShippingGuide || {};

  // Lookups paralelos, tolerantes a errores individuales.
  const results = await Promise.allSettled([
    customerId ? isdk.users.show({ id: customerId }) : Promise.resolve(null),
    providerId ? isdk.users.show({ id: providerId }) : Promise.resolve(null),
    listingId ? isdk.listings.show({ id: listingId }) : Promise.resolve(null),
  ]);

  const buyerResp = results[0].status === 'fulfilled' ? results[0].value : null;
  const sellerResp = results[1].status === 'fulfilled' ? results[1].value : null;
  const listingResp = results[2].status === 'fulfilled' ? results[2].value : null;

  const buyerData = buyerResp?.data?.data?.attributes || {};
  const buyerPd = buyerData?.profile?.publicData || {};
  const sellerData = sellerResp?.data?.data?.attributes || {};
  const sellerPd = sellerData?.profile?.publicData || {};
  const listingData = listingResp?.data?.data?.attributes || {};

  const baseContext = {
    buyer: {
      name: buyerData?.profile?.displayName || 'Comprador',
      email: buyerData?.email,
      whatsapp: buyerPd.whatsapp,
    },
    seller: {
      name: sellerData?.profile?.displayName || 'Vendedor',
      email: sellerData?.email,
      whatsapp: sellerPd.whatsapp,
      // Branding para dual-brand en emails al buyer.
      logoUrl: sellerPd.logoUrl || sellerPd.brandLogoUrl || null,
      primaryColor: sellerPd.brandPrimaryColor || sellerPd.storePrimaryColor || null,
      secondaryColor: sellerPd.brandSecondaryColor || null,
      slug: sellerPd.slug || null,
    },
    listing: {
      title: listingData?.title || 'tu pedido',
    },
    order: {
      url: buildOrderUrl(txId),
      saleUrl: buildSaleUrl(txId), // por si un template al seller lo quiere
      id: txId,
    },
    carrier: guide.carrierName
      ? {
          name: guide.carrierName,
          service: guide.serviceName || '',
        }
      : undefined,
    tracking: guide.trackingNumber
      ? {
          number: guide.trackingNumber,
          url: guide.trackingUrl || buildOrderUrl(txId),
        }
      : undefined,
  };

  // Deep-merge shallow-2: solo mezclamos primer nivel; el caller puede
  // pisar {buyer:{email:'…'}} sin borrar el resto del buyer.
  const merged = { ...baseContext };
  for (const [key, value] of Object.entries(overrides)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && merged[key]) {
      merged[key] = { ...merged[key], ...value };
    } else {
      merged[key] = value;
    }
  }
  return merged;
};

module.exports = { buildTxContext, buildOrderUrl, buildSaleUrl };
