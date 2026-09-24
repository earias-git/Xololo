const {
  calculateQuantityFromDates,
  calculateQuantityFromHours,
  calculateShippingFee,
  calculateTotalFromLineItems,
  getProviderCommissionMaybe,
} = require('./lineItemHelpers');
const {
  PROVIDER_COMMISSION_PERCENTAGE,
  FIXED_SERVICE_FEE_SUBUNITS,
  LINE_ITEM_XOLOLO_SERVICE_FEE,
} = require('./xololoFees');
const { types } = require('sharetribe-flex-sdk');
const { Money } = types;

/**
 * Get quantity and add extra line-items that are related to delivery method.
 *
 * XOLOLO: extendido para soportar los modos custom de envío del marketplace:
 *  - shipping + shippingPricingMode='carrier' → usa selectedShippingRate.total
 *    (viene de orderData; el buyer eligió una paquetería via Skydropx en el
 *    checkout). Si sellerCoversShipping=true, la línea se agrega en $0 con
 *    label especial "Envío gratis (cortesía del vendedor)".
 *  - shipping + shippingPricingMode='flat' (o sin mode) → comportamiento
 *    default de Sharetribe (precio fijo del listing).
 *  - pickup + pickupPriceInSubunits > 0 → línea de "Recolección local" con
 *    ese costo. Si es 0 o falta, se mantiene el default (gratis, sin línea).
 *
 * @param {Object} orderData
 * @param {number} orderData.stockReservationQuantity
 * @param {string} orderData.deliveryMethod - 'shipping' | 'pickup'
 * @param {Object} [orderData.selectedShippingRate] - {id, carrier, service,
 *   total (number en unidades mayores, ej. 245.50), currency, days,
 *   isFreeShipping}
 * @param {Object} publicData - publicData del listing
 * @param {string} currency - código de moneda (ej. 'MXN')
 */
const getItemQuantityAndLineItems = (orderData, publicData, currency) => {
  const quantity = orderData ? orderData.stockReservationQuantity : null;
  const deliveryMethod = orderData && orderData.deliveryMethod;
  const isShipping = deliveryMethod === 'shipping';
  const isPickup = deliveryMethod === 'pickup';

  const {
    shippingPriceInSubunitsOneItem,
    shippingPriceInSubunitsAdditionalItems,
    // XOLOLO extended fields
    shippingPricingMode,
    sellerCoversShipping,
    pickupPriceInSubunits,
  } = publicData || {};

  const extraLineItems = [];

  if (isShipping) {
    if (shippingPricingMode === 'carrier') {
      // Modo cotización dinámica.
      //  - sellerCoversShipping=true → línea $0 SIEMPRE, ignorando lo que
      //    mande el cliente (el vendedor absorbe el costo).
      //  - caso normal → toma rate.total del orderData.selectedShippingRate
      //    (viene en unidades mayores, ej. 245.50; convertimos a centavos).
      //  - carrier sin sellerCubre y sin rate → no agregamos línea; Sharetribe
      //    fallará al procesar. Fase C.2 debe bloquear el submit hasta que
      //    el buyer elija una paquetería.
      const freeShipping = !!sellerCoversShipping;
      const rate = orderData?.selectedShippingRate;
      const rateTotal = freeShipping ? 0 : Number(rate?.total);

      const shouldAddLine = freeShipping || (rate && Number.isFinite(rateTotal) && rateTotal >= 0);

      if (shouldAddLine) {
        // Reusamos el code 'line-item/shipping-fee' incluso para $0 — así
        // el OrderBreakdown existente lo renderiza sin cambios de UI.
        const subunits = Math.round(rateTotal * 100);
        extraLineItems.push({
          code: 'line-item/shipping-fee',
          unitPrice: new Money(subunits, currency),
          quantity: 1,
          includeFor: ['customer', 'provider'],
        });
      }
    } else {
      // Modo flat (default Sharetribe): precio fijo del listing.
      //
      // XOLOLO Cart.5: con carrito multi-producto (mismo seller), el
      // shipping se calcula sobre el TOTAL de unidades (primary +
      // additionalCartItems), no sólo el quantity del primary — así
      // se aplica correctamente la lógica "primer item paga
      // oneItem, adicionales pagan additionalItems". Esto usa las
      // tarifas del listing PRIMARY (todos los items se envían
      // juntos desde ese seller, por eso su tarifa manda).
      const additionalCartItems = Array.isArray(orderData?.additionalCartItems)
        ? orderData.additionalCartItems
        : [];
      const additionalUnitsTotal = additionalCartItems.reduce(
        (sum, x) => sum + (Number.isInteger(x?.quantity) ? x.quantity : 0),
        0
      );
      const totalShippingUnits = (Number(quantity) || 0) + additionalUnitsTotal;

      const shippingFee = calculateShippingFee(
        shippingPriceInSubunitsOneItem,
        shippingPriceInSubunitsAdditionalItems,
        currency,
        totalShippingUnits
      );
      if (shippingFee) {
        extraLineItems.push({
          code: 'line-item/shipping-fee',
          unitPrice: shippingFee,
          quantity: 1,
          includeFor: ['customer', 'provider'],
        });
      }
    }
  }

  if (isPickup) {
    // Recolección local con costo opcional. 0 o null = gratis, no agregamos línea.
    const pickupAmount = Number.isInteger(pickupPriceInSubunits) ? pickupPriceInSubunits : 0;
    if (pickupAmount > 0) {
      extraLineItems.push({
        code: 'line-item/pickup-fee',
        unitPrice: new Money(pickupAmount, currency),
        quantity: 1,
        includeFor: ['customer', 'provider'],
      });
    }
  }

  return { quantity, extraLineItems };
};

const getOfferQuantityAndLineItems = orderData => {
  return { quantity: 1, extraLineItems: [] };
};

/**
 * Get quantity for fixed bookings with seats.
 * @param {Object} orderData
 * @param {number} [orderData.seats]
 */
const getFixedQuantityAndLineItems = orderData => {
  const { seats } = orderData || {};
  const hasSeats = !!seats;
  // If there are seats, the quantity is split to factors: units and seats.
  // E.g. 1 session x 2 seats (aka unit price is multiplied by 2)
  return hasSeats ? { units: 1, seats, extraLineItems: [] } : { quantity: 1, extraLineItems: [] };
};

/**
 * Get quantity for arbitrary units for time-based bookings.
 *
 * @param {Object} orderData
 * @param {string} orderData.bookingStart
 * @param {string} orderData.bookingEnd
 * @param {number} [orderData.seats]
 */
const getHourQuantityAndLineItems = orderData => {
  const { bookingStart, bookingEnd, seats } = orderData || {};
  const hasSeats = !!seats;
  const units =
    bookingStart && bookingEnd ? calculateQuantityFromHours(bookingStart, bookingEnd) : null;

  // If there are seats, the quantity is split to factors: units and seats.
  // E.g. 3 hours x 2 seats (aka unit price is multiplied by 6)
  return hasSeats ? { units, seats, extraLineItems: [] } : { quantity: units, extraLineItems: [] };
};

/**
 * Calculate quantity based on days or nights between given bookingDates.
 *
 * @param {Object} orderData
 * @param {string} orderData.bookingStart
 * @param {string} orderData.bookingEnd
 * @param {number} [orderData.seats]
 * @param {'line-item/day' | 'line-item/night'} code
 */
const getDateRangeQuantityAndLineItems = (orderData, code) => {
  const { bookingStart, bookingEnd, seats } = orderData;
  const hasSeats = !!seats;
  const units =
    bookingStart && bookingEnd ? calculateQuantityFromDates(bookingStart, bookingEnd, code) : null;

  // If there are seats, the quantity is split to factors: units and seats.
  // E.g. 3 nights x 4 seats (aka unit price is multiplied by 12)
  return hasSeats ? { units, seats, extraLineItems: [] } : { quantity: units, extraLineItems: [] };
};

/**
 * Returns collection of lineItems (max 50)
 *
 * All the line-items dedicated to _customer_ define the "payin total".
 * Similarly, the sum of all the line-items included for _provider_ create "payout total".
 * Platform gets the commission, which is the difference between payin and payout totals.
 *
 * Each line items has following fields:
 * - `code`: string, mandatory, indentifies line item type (e.g. \"line-item/cleaning-fee\"), maximum length 64 characters.
 * - `unitPrice`: money, mandatory
 * - `lineTotal`: money
 * - `quantity`: number
 * - `percentage`: number (e.g. 15.5 for 15.5%)
 * - `seats`: number
 * - `units`: number
 * - `includeFor`: array containing strings \"customer\" or \"provider\", default [\":customer\"  \":provider\" ]
 *
 * Line item must have either `quantity` or `percentage` or both `seats` and `units`.
 *
 * `includeFor` defines commissions. Customer commission is added by defining `includeFor` array `["customer"]` and provider commission by `["provider"]`.
 *
 * @param {Object} listing
 * @param {Object} orderData
 * @param {string} [orderData.priceVariantName] - The name of the price variant (potentially used with bookable unit types)
 * @param {Money} [orderData.offer] - The offer for the offer (if transition intent is "make-offer")
 * @param {Object} _providerCommissionUnused - ignorado, ver nota XOLOLO abajo
 * @param {Object} _customerCommissionUnused - ignorado, ver nota XOLOLO abajo
 * @returns {Array} lineItems
 */
// XOLOLO: los parámetros providerCommission/customerCommission que
// mandan los callers (fetchCommission → asset de Sharetribe Console)
// se ignoran a propósito. El modelo de negocio real de Xololo vive en
// server/api-util/xololoFees.js (hardcoded, auditable en código) — no
// depende de que Console esté configurado correctamente. Ver ese
// archivo para el detalle de a.1/a.2/a.3 del modelo de negocio.
exports.transactionLineItems = (listing, orderData, _providerCommissionUnused, _customerCommissionUnused) => {
  const publicData = listing.attributes.publicData;
  // Note: the unitType needs to be one of the following:
  // day, night, hour, fixed, or item (these are related to payment processes)
  const { unitType, priceVariants, priceVariationsEnabled } = publicData;

  const isBookable = ['day', 'night', 'hour', 'fixed'].includes(unitType);
  const isNegotiationUnitType = ['offer', 'request'].includes(unitType);
  const priceAttribute = listing.attributes.price;
  const currency = priceAttribute?.currency || orderData.currency;

  const { priceVariantName, offer } = orderData || {};
  const priceVariantConfig = priceVariants
    ? priceVariants.find(pv => pv.name === priceVariantName)
    : null;
  const { priceInSubunits } = priceVariantConfig || {};
  const isPriceInSubunitsValid = Number.isInteger(priceInSubunits) && priceInSubunits >= 0;

  const unitPrice =
    isBookable && priceVariationsEnabled && isPriceInSubunitsValid
      ? new Money(priceInSubunits, currency)
      : offer instanceof Money && isNegotiationUnitType
      ? offer
      : priceAttribute;

  /**
   * Pricing starts with order's base price:
   * Listing's price is related to a single unit. It needs to be multiplied by quantity
   *
   * Initial line-item needs therefore:
   * - code (based on unitType)
   * - unitPrice
   * - quantity
   * - includedFor
   */

  const code = `line-item/${unitType}`;

  // Here "extra line-items" means line-items that are tied to unit type
  // E.g. by default, "shipping-fee" is tied to 'item' aka buying products.
  const quantityAndExtraLineItems =
    unitType === 'item'
      ? getItemQuantityAndLineItems(orderData, publicData, currency)
      : unitType === 'fixed'
      ? getFixedQuantityAndLineItems(orderData)
      : unitType === 'hour'
      ? getHourQuantityAndLineItems(orderData)
      : ['day', 'night'].includes(unitType)
      ? getDateRangeQuantityAndLineItems(orderData, code)
      : isNegotiationUnitType
      ? getOfferQuantityAndLineItems(orderData)
      : {};

  const { quantity, units, seats, extraLineItems } = quantityAndExtraLineItems;

  // Throw error if there is no quantity information given
  if (!quantity && !(units && seats)) {
    const missingFields = [];

    if (!quantity) missingFields.push('quantity');
    if (!units) missingFields.push('units');
    if (!seats) missingFields.push('seats');

    const message = `Error: orderData is missing the following information: ${missingFields.join(
      ', '
    )}. Quantity or either units & seats is required.`;

    const error = new Error(message);
    error.status = 400;
    error.statusText = message;
    error.data = {};
    throw error;
  }

  /**
   * If you want to use pre-defined component and translations for printing the lineItems base price for order,
   * you should use one of the codes:
   * line-item/night, line-item/day, line-item/hour or line-item/item.
   *
   * Pre-definded commission components expects line item code to be one of the following:
   * 'line-item/provider-commission', 'line-item/customer-commission'
   *
   * By default OrderBreakdown prints line items inside LineItemUnknownItemsMaybe if the lineItem code is not recognized. */

  const quantityOrSeats = !!units && !!seats ? { units, seats } : { quantity };
  const order = {
    code,
    unitPrice,
    ...quantityOrSeats,
    includeFor: ['customer', 'provider'],
  };

  // XOLOLO Cart.5: items adicionales del carrito (mismo seller) se
  // agregan como líneas 'line-item/item' extras después del primary.
  // Requiere unitType='item'; para bookings/offers ignoramos.
  // orderData.additionalCartItems = [{ listing, quantity }] con los
  // listings YA fetched (el caller — initiate-privileged o
  // transaction-line-items — los resuelve antes de llamar aquí).
  const additionalCartItems =
    unitType === 'item' && Array.isArray(orderData?.additionalCartItems)
      ? orderData.additionalCartItems.filter(
          x => x && x.listing && x.listing.attributes?.price && x.quantity > 0
        )
      : [];

  const additionalOrderLineItems = additionalCartItems.map(({ listing: l, quantity: q }) => ({
    code: 'line-item/item',
    unitPrice: l.attributes.price,
    quantity: q,
    includeFor: ['customer', 'provider'],
  }));

  // Para calcular comisiones sobre el AGREGADO de todos los productos del
  // carrito (primary + extras), construimos un pseudo-order con el total
  // sumado. Sharetribe sólo admite UNA línea de provider-commission y UNA
  // de customer-commission por transacción, así que este es el patrón.
  const commissionOrder =
    additionalOrderLineItems.length > 0
      ? {
          code,
          unitPrice: calculateTotalFromLineItems([order, ...additionalOrderLineItems]),
          quantity: 1,
          includeFor: ['customer', 'provider'],
        }
      : order;

  // XOLOLO: cargo fijo de $14 + IVA por transacción (a.3), se
  // descuenta del payout del seller igual que la comisión — línea
  // propia con code custom porque el slot `line-item/provider-commission`
  // ya lo usa el 3.6%+IVA de abajo. quantity:-1 con unitPrice positivo
  // = mismo patrón que Sharetribe usa para "minimum commission" (línea
  // 388-395 de lineItemHelpers.js) para lograr un monto fijo negativo.
  const xololoServiceFeeLineItem = {
    code: LINE_ITEM_XOLOLO_SERVICE_FEE,
    unitPrice: new Money(FIXED_SERVICE_FEE_SUBUNITS, currency),
    quantity: -1,
    includeFor: ['provider'],
  };

  // Let's keep the base price (order) as first line item and provider and customer commissions as last.
  // Note: the order matters only if OrderBreakdown component doesn't recognize line-item.
  //
  // XOLOLO: providerCommission siempre {percentage: PROVIDER_COMMISSION_PERCENTAGE}
  // (3.6%+IVA, a.2) y customerCommission siempre ausente (sin comisión
  // por venta al comprador, a.1) — ver xololoFees.js.
  const lineItems = [
    order,
    ...additionalOrderLineItems,
    ...extraLineItems,
    ...getProviderCommissionMaybe(
      { percentage: PROVIDER_COMMISSION_PERCENTAGE },
      commissionOrder,
      currency
    ),
    xololoServiceFeeLineItem,
  ];

  return lineItems;
};
