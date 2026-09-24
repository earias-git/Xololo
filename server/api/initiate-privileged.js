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

// XOLOLO Cart.5: extrae y valida additionalCartItems de orderData.
// Devuelve [{listingId, quantity}] limpio; ignora entradas inválidas.
// El listingId primario NO puede repetirse aquí (se filtra).
const sanitizeAdditionalCartItems = (orderData, primaryListingId) => {
  const raw = Array.isArray(orderData?.additionalCartItems) ? orderData.additionalCartItems : [];
  const seen = new Set([primaryListingId]);
  const cleaned = [];
  for (const it of raw) {
    const id = it?.listingId;
    const qty = Number(it?.quantity);
    if (!id || !Number.isInteger(qty) || qty <= 0) continue;
    if (seen.has(id)) continue; // dedupe + evita duplicar primario
    seen.add(id);
    cleaned.push({ listingId: id, quantity: qty });
  }
  return cleaned;
};

module.exports = (req, res) => {
  const { isSpeculative, orderData, bodyParams, queryParams } = req.body || {};
  const transitionName = bodyParams.transition;
  const sdk = getSdk(req, res);
  let lineItems = null;
  let metadataMaybe = {};
  let xololoShipping = null;
  let xololoCart = null;

  const primaryListingId = bodyParams?.params?.listingId;
  const additionalCartRaw = sanitizeAdditionalCartItems(orderData, primaryListingId);

  Promise.all([
    listingPromise(sdk, primaryListingId),
    ...additionalCartRaw.map(x => listingPromise(sdk, x.listingId)),
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

      // XOLOLO Cart.5: validar que todos los items adicionales sean del
      // mismo seller que el primario. Multi-seller cart NO se soporta
      // en v1 (ver docs/LOGISTICS_V1.md §1).
      const primaryAuthorId = listing.relationships?.author?.data?.id?.uuid;
      const additionalCartItems = additionalListings.map((l, i) => {
        const authorId = l.relationships?.author?.data?.id?.uuid;
        if (!primaryAuthorId || authorId !== primaryAuthorId) {
          const err = new Error('cart_cross_seller');
          err.status = 400;
          err.statusText = 'Additional cart items must belong to the same seller as the primary listing';
          err.data = { primaryListingId, offendingListingId: l.id?.uuid };
          throw err;
        }
        return { listing: l, quantity: additionalCartRaw[i].quantity };
      });

      const currency = listing.attributes.price?.currency || orderData.currency;
      const { providerCommission, customerCommission } =
        commissionAsset?.type === 'jsonAsset' ? commissionAsset.attributes.data : {};

      const fullOrderData = {
        ...getFullOrderData(orderData, bodyParams, currency),
        additionalCartItems,
      };

      lineItems = transactionLineItems(
        listing,
        fullOrderData,
        providerCommission,
        customerCommission
      );
      metadataMaybe = getMetadata(orderData, transitionName);
      // XOLOLO: construimos el snapshot de shipping desde publicData del
      // listing + rate elegida por el buyer. Se persiste en protectedData
      // para que Fase D (fulfillment) tenga la info completa sin re-leer
      // el listing (que puede cambiar entre initiate y capture).
      xololoShipping = buildXololoShipping(listing, orderData, { isSpeculative });

      // XOLOLO Cart.5: snapshot del carrito en protectedData. Guardamos
      // solo la info mínima para que fulfillment sepa qué extras se
      // vendieron sin re-consultar los listings (que pueden mutar).
      // Cart.6 usará esta info para agregar peso/dimensiones al cotizar
      // la guía Skydropx real y para decrementar stock de cada extra.
      xololoCart =
        additionalCartItems.length > 0
          ? {
              items: additionalCartItems.map(({ listing: l, quantity: q }) => {
                const pd = l.attributes.publicData || {};
                return {
                  listingId: l.id.uuid,
                  title: l.attributes.title,
                  quantity: q,
                  priceInSubunits: l.attributes.price.amount,
                  currency: l.attributes.price.currency,
                  // XOLOLO Cart.6: peso/dims del listing snapshoteados aquí
                  // para que generate-shipping-guide agregue parcels sin
                  // re-consultar los listings (que pueden haberse despublicado
                  // o cambiado de dimensiones entre initiate y fulfillment).
                  weightGrams: pd.weightGrams || null,
                  dimensionLengthCm: pd.dimensionLengthCm || null,
                  dimensionWidthCm: pd.dimensionWidthCm || null,
                  dimensionHeightCm: pd.dimensionHeightCm || null,
                };
              }),
            }
          : null;

      return getTrustedSdk(req);
    })
    .then(trustedSdk => {
      const { params } = bodyParams;
      // Merge xololoShipping y xololoCart en el protectedData existente.
      // El buyer puede haber mandado sus propios campos ahí (ej.
      // shippingDetails recipient info) — los preservamos, solo
      // agregamos/pisamos las keys de Xololo.
      const mergedProtectedData = {
        ...(params?.protectedData || {}),
        xololoShipping,
        ...(xololoCart ? { xololoCart } : {}),
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
      // XOLOLO DEBUG TEMPORAL (borrar tras resolver bug del multi-item checkout):
      // eslint-disable-next-line no-console
      console.error('[initiate-privileged][DEBUG]', {
        isSpeculative,
        transitionName,
        primaryListingId,
        additionalCartCount: additionalCartRaw?.length || 0,
        additionalIds: additionalCartRaw?.map(x => x.listingId) || [],
        errStatus: e?.status,
        errStatusText: e?.statusText,
        errMessage: e?.message,
        errData: JSON.stringify(e?.data || null).slice(0, 800),
      });
      handleError(res, e);
    });
};
