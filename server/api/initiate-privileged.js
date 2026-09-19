const crypto = require('crypto');
const sharetribeSdk = require('sharetribe-flex-sdk');
const { transactionLineItems } = require('../api-util/lineItems');

// XOLOLO: código de recolección de 6 dígitos (§8 del LOGISTICS_V1.md).
// Se genera al momento del initiate REAL de una transacción con
// deliveryMethod='pickup'. NUNCA lo generamos en speculative (evita
// gasto y filtrar códigos a un buyer que aún no completa el checkout).
// crypto.randomInt es criptográficamente seguro; el rango 100000-999999
// da exactamente 6 dígitos.
const generatePickupCode = () => String(crypto.randomInt(100000, 1000000));
const { isIntentionToMakeOffer } = require('../api-util/negotiation');
const {
  getSdk,
  getTrustedSdk,
  handleError,
  serialize,
  fetchCommission,
} = require('../api-util/sdk');

const { Money } = sharetribeSdk.types;

const listingPromise = (sdk, id) => sdk.listings.show({ id });

const getFullOrderData = (orderData, bodyParams, currency) => {
  const { offerInSubunits } = orderData || {};
  const transitionName = bodyParams.transition;

  return isIntentionToMakeOffer(offerInSubunits, transitionName)
    ? {
        ...orderData,
        ...bodyParams.params,
        currency,
        offer: new Money(offerInSubunits, currency),
      }
    : { ...orderData, ...bodyParams.params };
};

const getMetadata = (orderData, transition) => {
  const { actor, offerInSubunits } = orderData || {};
  // NOTE: for now, the actor is always "provider".
  const hasActor = ['provider', 'customer'].includes(actor);
  const by = hasActor ? actor : null;

  return isIntentionToMakeOffer(offerInSubunits, transition)
    ? {
        metadata: {
          offers: [
            {
              offerInSubunits,
              by,
              transition,
            },
          ],
        },
      }
    : {};
};

// XOLOLO: construye el objeto xololoShipping que se persiste en
// transaction.protectedData. Server-side es la única fuente de verdad —
// leemos shippingPricingMode y sellerCoversShipping del listing (no del
// cliente) y guardamos solo lo necesario para Fase D (generación de
// guías, tracking, código de recolección).
//
// La estructura:
//   {
//     mode: 'carrier' | 'flat' | 'pickup' | 'none',
//     sellerCoversShipping: bool,
//     rate: {id, carrier, carrierCode, service, serviceCode, total,
//            currency, days} | null,   ← solo si carrier con selección
//     quotationId: string | null,
//   }
const buildXololoShipping = (listing, orderData, { isSpeculative } = {}) => {
  const publicData = listing?.attributes?.publicData || {};
  const deliveryMethod = orderData?.deliveryMethod;
  const shippingPricingMode = publicData.shippingPricingMode;
  const sellerCoversShipping = !!publicData.sellerCoversShipping;

  if (deliveryMethod === 'pickup') {
    // XOLOLO: en el initiate REAL generamos el código de 6 dígitos para
    // que el buyer lo vea al confirmar la orden. En speculative dejamos
    // pickupCode como null (no queremos generar códigos por cada
    // recálculo de breakdown; solo persiste el que va a la transacción
    // final). Ver docs/LOGISTICS_V1.md §8.
    const pickupCode = isSpeculative
      ? null
      : {
          code: generatePickupCode(),
          revealedAt: null, // se marca cuando seller hace "Iniciar entrega"
          verifiedAt: null, // se marca al validar código correcto
          attempts: 0,
          blockedAt: null, // después de 3 intentos fallidos
        };
    return {
      mode: 'pickup',
      sellerCoversShipping: false,
      rate: null,
      quotationId: null,
      pickupCode,
    };
  }
  if (deliveryMethod !== 'shipping') {
    return { mode: 'none', sellerCoversShipping: false, rate: null, quotationId: null };
  }
  if (shippingPricingMode === 'carrier') {
    const rate = orderData?.selectedShippingRate;
    const persistedRate = rate
      ? {
          id: rate.id,
          carrier: rate.carrier,
          carrierCode: rate.carrierCode,
          service: rate.service,
          serviceCode: rate.serviceCode,
          total: Number(rate.total),
          currency: rate.currency || 'MXN',
          days: rate.days ?? null,
        }
      : null;
    return {
      mode: 'carrier',
      sellerCoversShipping,
      rate: persistedRate,
      quotationId: orderData?.shippingQuotationId || null,
    };
  }
  return {
    mode: 'flat',
    sellerCoversShipping: false,
    rate: null,
    quotationId: null,
  };
};

module.exports = (req, res) => {
  const { isSpeculative, orderData, bodyParams, queryParams } = req.body || {};
  const transitionName = bodyParams.transition;
  const sdk = getSdk(req, res);
  let lineItems = null;
  let metadataMaybe = {};
  let xololoShipping = null;

  Promise.all([listingPromise(sdk, bodyParams?.params?.listingId), fetchCommission(sdk)])
    .then(([showListingResponse, fetchAssetsResponse]) => {
      const listing = showListingResponse.data.data;
      const commissionAsset = fetchAssetsResponse.data.data[0];

      const currency = listing.attributes.price?.currency || orderData.currency;
      const { providerCommission, customerCommission } =
        commissionAsset?.type === 'jsonAsset' ? commissionAsset.attributes.data : {};

      lineItems = transactionLineItems(
        listing,
        getFullOrderData(orderData, bodyParams, currency),
        providerCommission,
        customerCommission
      );
      metadataMaybe = getMetadata(orderData, transitionName);
      // XOLOLO: construimos el snapshot de shipping desde publicData del
      // listing + rate elegida por el buyer. Se persiste en protectedData
      // para que Fase D (fulfillment) tenga la info completa sin re-leer
      // el listing (que puede cambiar entre initiate y capture).
      xololoShipping = buildXololoShipping(listing, orderData, { isSpeculative });

      return getTrustedSdk(req);
    })
    .then(trustedSdk => {
      const { params } = bodyParams;
      // Merge xololoShipping en el protectedData existente. El buyer
      // puede haber mandado sus propios campos ahí (ej. shippingDetails
      // recipient info) — los preservamos, solo agregamos/pisamos la
      // key xololoShipping.
      const mergedProtectedData = {
        ...(params?.protectedData || {}),
        xololoShipping,
      };

      // Add lineItems to the body params
      const body = {
        ...bodyParams,
        params: {
          ...params,
          protectedData: mergedProtectedData,
          lineItems,
          ...metadataMaybe,
        },
      };

      if (isSpeculative) {
        return trustedSdk.transactions.initiateSpeculative(body, queryParams);
      }
      return trustedSdk.transactions.initiate(body, queryParams);
    })
    .then(apiResponse => {
      const { status, statusText, data } = apiResponse;
      res
        .status(status)
        .set('Content-Type', 'application/transit+json')
        .send(
          serialize({
            status,
            statusText,
            data,
          })
        )
        .end();
    })
    .catch(e => {
      handleError(res, e);
    });
};
