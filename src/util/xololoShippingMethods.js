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
export const METHOD_SKYDROPX = 'skydropxCarrier';

export const ALL_METHODS = [
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

  // Pickup viejo → pickup nuevo. Aceptamos legacy vía deliveryOptions
  // O vía el flag pickupEnabled directo (algunos listings guardaron
  // uno pero no el otro).
  const pickupLegacy =
    deliveryOptions.includes('pickup') || publicData.pickupEnabled === true;
  if (pickupLegacy) {
    cfg.pickup.enabled = true;
  }

  // Shipping viejo. Igual — aceptamos deliveryOptions.includes('shipping')
  // O el flag shippingEnabled=true. Con cualquiera basta para activar
  // la derivación (algunas versiones anteriores del panel guardaban
  // sólo uno de los dos).
  const shippingEnabled =
    deliveryOptions.includes('shipping') || publicData.shippingEnabled === true;
  const flatPrice = Number(publicData.shippingPriceInSubunitsOneItem) || 0;
  if (shippingEnabled && publicData.shippingPricingMode === 'flat' && flatPrice > 0) {
    cfg.localDelivery.enabled = true;
    cfg.localDelivery.priceSubunits = flatPrice;
    cfg.localDelivery.zoneDescription = '';
  }

  // Shipping viejo con carrier → skydropxCarrier v2 (mismo comportamiento).
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
    const merged = {
      pickup: { ...base.pickup, ...(stored.pickup || {}) },
      localDelivery: { ...base.localDelivery, ...(stored.localDelivery || {}) },
      skydropxCarrier: { ...base.skydropxCarrier, ...(stored.skydropxCarrier || {}) },
      freight: { ...base.freight, ...(stored.freight || {}) },
    };
    // XOLOLO: fallback defensivo — si el shape v2 existe pero TODOS los
    // métodos están apagados (ej. seller guardó sin marcar nada, o
    // shape se corrompió), Y hay config legacy → derivamos del legacy
    // y OR-mergeamos con el shape v2. Esto arregla listings donde el
    // seller olvidó marcar checkboxes v2 pero tenía legacy carrier/flat.
    const anyEnabled =
      merged.pickup.enabled ||
      merged.localDelivery.enabled ||
      merged.skydropxCarrier.enabled ||
      merged.freight.enabled;
    if (!anyEnabled) {
      const derived = deriveFromLegacy(pd);
      const hasLegacy =
        derived.pickup.enabled ||
        derived.localDelivery.enabled ||
        derived.skydropxCarrier.enabled ||
        derived.freight.enabled;
      if (hasLegacy) return derived;
    }
    return merged;
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
  if (methods?.skydropxCarrier?.enabled)
    out.push({ key: METHOD_SKYDROPX, config: methods.skydropxCarrier });
  if (methods?.freight?.enabled)
    out.push({ key: METHOD_FREIGHT, config: methods.freight });
  return out;
};

/**
 * XOLOLO Carrito multi-producto (Option D): intersección de métodos
 * entre N listings. Retorna un shape con `enabled=true` sólo para los
 * métodos que TODOS los listings soportan. La config de cada método
 * (priceSubunits, zoneDescription, weight, dims) se toma del PRIMER
 * listing — es la convención "primary controla el precio" del v1.
 *
 * @param {Array<Object>} listings - array de listings de Sharetribe
 * @returns {{ methods, intersectionKeys }} — methods es el shape agregado,
 *   intersectionKeys es el array de keys (['pickup', ...]) con enabled=true.
 *   Si intersectionKeys.length === 0, no hay método compartido.
 */
export const intersectShippingMethods = listings => {
  if (!Array.isArray(listings) || listings.length === 0) {
    return { methods: null, intersectionKeys: [] };
  }
  const perListing = listings.map(l => getShippingMethodsFromListing(l));
  const allKeys = [METHOD_PICKUP, METHOD_LOCAL_DELIVERY, METHOD_SKYDROPX, METHOD_FREIGHT];
  const cfgKey = { pickup: 'pickup', localDelivery: 'localDelivery', skydropxCarrier: 'skydropxCarrier', freight: 'freight' };

  const intersectionKeys = allKeys.filter(key => {
    const k = cfgKey[key];
    return perListing.every(m => m?.[k]?.enabled === true);
  });

  const primary = perListing[0];
  // Base con todo apagado; encendemos sólo lo que está en la intersección.
  // La config (precio, zona, peso, dims) viene del primary.
  const base = {
    pickup: { enabled: false, instructions: primary?.pickup?.instructions || '' },
    localDelivery: {
      enabled: false,
      priceSubunits: primary?.localDelivery?.priceSubunits || 0,
      zoneDescription: primary?.localDelivery?.zoneDescription || '',
    },
    skydropxCarrier: {
      enabled: false,
      sellerCoversShipping: !!primary?.skydropxCarrier?.sellerCoversShipping,
      weightGrams: primary?.skydropxCarrier?.weightGrams || null,
      dimensionLengthCm: primary?.skydropxCarrier?.dimensionLengthCm || null,
      dimensionWidthCm: primary?.skydropxCarrier?.dimensionWidthCm || null,
      dimensionHeightCm: primary?.skydropxCarrier?.dimensionHeightCm || null,
    },
    freight: { enabled: false },
  };
  intersectionKeys.forEach(key => {
    base[key].enabled = true;
  });

  return { methods: base, intersectionKeys };
};

/**
 * XOLOLO Carrito multi-producto (Option D "comprar por grupos"):
 * agrupa listings por compatibilidad de métodos. Dos listings son
 * compatibles si comparten al menos un método habilitado. Los grupos
 * resultantes se pueden pagar por separado (cada uno tiene su propio
 * checkout con la intersección de métodos de ese grupo).
 *
 * Algoritmo greedy: para cada listing, intenta agregarlo al primer
 * grupo existente donde sea compatible; si no lo es en ninguno, crea
 * uno nuevo. Funciona correctamente para casos típicos (2-3 productos);
 * en escenarios patológicos con muchos productos y compatibilidades
 * cruzadas complejas puede no dar el mínimo número de grupos — pero es
 * predecible y suficiente para v1.
 *
 * @param {Array<Object>} listings
 * @returns {Array<{ listings: Array, methods, intersectionKeys }>}
 *   — array de grupos, cada uno con sus listings y la intersección de
 *   métodos del grupo (útil para el selector y el checkout).
 */
export const groupListingsByCompatibility = listings => {
  if (!Array.isArray(listings) || listings.length === 0) return [];
  const groups = []; // [{ listings: [...] }]
  for (const l of listings) {
    let placed = false;
    for (const g of groups) {
      const test = intersectShippingMethods([...g.listings, l]);
      if (test.intersectionKeys.length > 0) {
        g.listings.push(l);
        placed = true;
        break;
      }
    }
    if (!placed) {
      groups.push({ listings: [l] });
    }
  }
  // Enriquecer cada grupo con su intersección definitiva.
  return groups.map(g => {
    const { methods, intersectionKeys } = intersectShippingMethods(g.listings);
    return { listings: g.listings, methods, intersectionKeys };
  });
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
    case METHOD_SKYDROPX:
      return 'Cotizar con paquetería (Skydropx)';
    case METHOD_FREIGHT:
      return 'Envío por flete (cotizado después)';
    default:
      return key;
  }
};
