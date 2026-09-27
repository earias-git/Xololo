// XOLOLO Envíos v2: 3 métodos configurables por listing.
//
// Método      | Costo checkout   | Notas
// ------------|------------------|-----------------------------------------
// pickup      | $0 fijo          | Recolección en el domicilio del seller.
// localDelivery| $XX fijo         | Envío por el seller en una zona local
//                                   definida (texto libre "CDMX Sur", etc.)
// freight     | $0 en checkout   | Buyer paga sólo productos. Se marca
//                                   `shippingQuotePending` en la tx. En Fase
//                                   2 el seller cotiza y el buyer aprueba.
//
// Shape en listing.attributes.publicData.xololoShippingMethods:
//   {
//     pickup:       { enabled: true, instructions?: "…" },
//     localDelivery: { enabled: true, priceSubunits: 5000, zoneDescription: "…" },
//     freight:      { enabled: true },
//   }
//
// Coexistencia con el modelo legacy (deliveryOptions/shippingPricingMode/
// shippingPriceInSubunitsOneItem/sellerCoversShipping/pickupPrice):
//   - Si el listing tiene xololoShippingMethods → se usa este modelo.
//   - Si NO lo tiene → deriveFromLegacy() reconstruye el nuevo shape a
//     partir de los campos viejos (mismo comportamiento visible al buyer).
// Así los listings publicados antes del refactor siguen funcionando hasta
// que el seller los edite y guarde el nuevo shape.

export const METHOD_PICKUP = 'pickup';
export const METHOD_LOCAL_DELIVERY = 'localDelivery';
export const METHOD_FREIGHT = 'freight';

export const ALL_METHODS = [METHOD_PICKUP, METHOD_LOCAL_DELIVERY, METHOD_FREIGHT];

const emptyConfig = () => ({
  pickup: { enabled: false, instructions: '' },
  localDelivery: { enabled: false, priceSubunits: 0, zoneDescription: '' },
  freight: { enabled: false },
});

/**
 * Deriva el nuevo modelo a partir del legacy (deliveryOptions/
 * shippingPricingMode/etc). Sólo se usa cuando el listing NO tiene
 * xololoShippingMethods todavía.
 */
export const deriveFromLegacy = publicData => {
  const cfg = emptyConfig();
  if (!publicData) return cfg;

  const deliveryOptions = Array.isArray(publicData.deliveryOptions)
    ? publicData.deliveryOptions
    : [];

  // Pickup viejo → pickup nuevo (el pickupPrice legacy se ignora — en el
  // modelo nuevo pickup siempre es gratis; si el seller cobraba antes, lo
  // vuelve a configurar como localDelivery con costo).
  if (deliveryOptions.includes('pickup')) {
    cfg.pickup.enabled = true;
  }

  // Shipping viejo con precio flat → localDelivery con ese precio.
  const shippingEnabled = deliveryOptions.includes('shipping');
  const flatPrice = Number(publicData.shippingPriceInSubunitsOneItem) || 0;
  if (shippingEnabled && publicData.shippingPricingMode === 'flat' && flatPrice > 0) {
    cfg.localDelivery.enabled = true;
    cfg.localDelivery.priceSubunits = flatPrice;
    cfg.localDelivery.zoneDescription = '';
  }

  // Shipping viejo con carrier → NO lo mapeamos a freight automáticamente
  // porque la promesa era "cotiza en checkout con Skydropx" (respuesta
  // inmediata), no "cotiza después" (que es lo que hace freight). El
  // seller lo re-configura manualmente cuando edite. Mientras tanto, si
  // el listing tenía sólo carrier habilitado, cae en "sin métodos" y no
  // se puede comprar — es intencional para forzar la migración.
  return cfg;
};

/**
 * Lee el shape efectivo del listing. Prefiere xololoShippingMethods;
 * cae al legacy sólo si no existe. Siempre retorna todos los slots
 * (con enabled:false los que no aplican) para simplificar el consumer.
 */
export const getShippingMethodsFromListing = listing => {
  const pd = listing?.attributes?.publicData || {};
  if (pd.xololoShippingMethods && typeof pd.xololoShippingMethods === 'object') {
    // Merge sobre el default por si el shape guardado tiene keys faltantes.
    const stored = pd.xololoShippingMethods;
    const base = emptyConfig();
    return {
      pickup: { ...base.pickup, ...(stored.pickup || {}) },
      localDelivery: { ...base.localDelivery, ...(stored.localDelivery || {}) },
      freight: { ...base.freight, ...(stored.freight || {}) },
    };
  }
  return deriveFromLegacy(pd);
};

/**
 * Retorna sólo los métodos habilitados como array [{ key, config }],
 * en orden de preferencia (pickup, local, freight).
 */
export const enabledMethodsList = methods => {
  const out = [];
  if (methods?.pickup?.enabled) out.push({ key: METHOD_PICKUP, config: methods.pickup });
  if (methods?.localDelivery?.enabled)
    out.push({ key: METHOD_LOCAL_DELIVERY, config: methods.localDelivery });
  if (methods?.freight?.enabled)
    out.push({ key: METHOD_FREIGHT, config: methods.freight });
  return out;
};

/**
 * Label legible para el buyer (usable en checkout y confirmación).
 */
export const methodLabel = key => {
  switch (key) {
    case METHOD_PICKUP:
      return 'Recolección en domicilio del vendedor';
    case METHOD_LOCAL_DELIVERY:
      return 'Envío local (zona)';
    case METHOD_FREIGHT:
      return 'Envío por flete (cotizado después)';
    default:
      return key;
  }
};
