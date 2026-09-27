// XOLOLO Envíos v2: mirror server-side de src/util/xololoShippingMethods.js
// (mismo shape, misma lógica de deriveFromLegacy). Duplicado a
// propósito porque el server es CommonJS y el cliente ESM; mantener
// dos copias pequeñas es más simple que un dual-loadable bundle.
// Si cambias uno, cambia el otro — mismo comentario que xololoFees.js.

const METHOD_PICKUP = 'pickup';
const METHOD_LOCAL_DELIVERY = 'localDelivery';
const METHOD_SKYDROPX = 'skydropxCarrier';
const METHOD_FREIGHT = 'freight';

const ALL_METHODS = [
  METHOD_PICKUP,
  METHOD_LOCAL_DELIVERY,
  METHOD_SKYDROPX,
  METHOD_FREIGHT,
];

const emptyConfig = () => ({
  pickup: { enabled: false, instructions: '' },
  localDelivery: { enabled: false, priceSubunits: 0, zoneDescription: '' },
  skydropxCarrier: {
    enabled: false,
    sellerCoversShipping: false,
    weightGrams: null,
    dimensionLengthCm: null,
    dimensionWidthCm: null,
    dimensionHeightCm: null,
  },
  freight: { enabled: false },
});

const deriveFromLegacy = publicData => {
  const cfg = emptyConfig();
  if (!publicData) return cfg;
  const deliveryOptions = Array.isArray(publicData.deliveryOptions)
    ? publicData.deliveryOptions
    : [];
  if (deliveryOptions.includes('pickup')) {
    cfg.pickup.enabled = true;
  }
  const shippingEnabled = deliveryOptions.includes('shipping');
  const flatPrice = Number(publicData.shippingPriceInSubunitsOneItem) || 0;
  if (shippingEnabled && publicData.shippingPricingMode === 'flat' && flatPrice > 0) {
    cfg.localDelivery.enabled = true;
    cfg.localDelivery.priceSubunits = flatPrice;
    cfg.localDelivery.zoneDescription = '';
  }
  if (shippingEnabled && publicData.shippingPricingMode === 'carrier') {
    cfg.skydropxCarrier.enabled = true;
    cfg.skydropxCarrier.sellerCoversShipping = !!publicData.sellerCoversShipping;
    cfg.skydropxCarrier.weightGrams = publicData.weightGrams || null;
    cfg.skydropxCarrier.dimensionLengthCm = publicData.dimensionLengthCm || null;
    cfg.skydropxCarrier.dimensionWidthCm = publicData.dimensionWidthCm || null;
    cfg.skydropxCarrier.dimensionHeightCm = publicData.dimensionHeightCm || null;
  }
  return cfg;
};

const getShippingMethodsFromListing = listing => {
  const pd = listing?.attributes?.publicData || {};
  if (pd.xololoShippingMethods && typeof pd.xololoShippingMethods === 'object') {
    const stored = pd.xololoShippingMethods;
    const base = emptyConfig();
    return {
      pickup: { ...base.pickup, ...(stored.pickup || {}) },
      localDelivery: { ...base.localDelivery, ...(stored.localDelivery || {}) },
      skydropxCarrier: { ...base.skydropxCarrier, ...(stored.skydropxCarrier || {}) },
      freight: { ...base.freight, ...(stored.freight || {}) },
    };
  }
  return deriveFromLegacy(pd);
};

const enabledMethodsList = methods => {
  const out = [];
  if (methods?.pickup?.enabled) out.push({ key: METHOD_PICKUP, config: methods.pickup });
  if (methods?.localDelivery?.enabled)
    out.push({ key: METHOD_LOCAL_DELIVERY, config: methods.localDelivery });
  if (methods?.skydropxCarrier?.enabled)
    out.push({ key: METHOD_SKYDROPX, config: methods.skydropxCarrier });
  if (methods?.freight?.enabled)
    out.push({ key: METHOD_FREIGHT, config: methods.freight });
  return out;
};

module.exports = {
  METHOD_PICKUP,
  METHOD_LOCAL_DELIVERY,
  METHOD_SKYDROPX,
  METHOD_FREIGHT,
  ALL_METHODS,
  deriveFromLegacy,
  getShippingMethodsFromListing,
  enabledMethodsList,
};
