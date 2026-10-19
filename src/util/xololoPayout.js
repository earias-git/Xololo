// XOLOLO: cálculo del payout del seller con desglose fiscal completo.
// Esta es la fórmula canónica que soporta 3 modos de IVA (16%, 0%, exento),
// retenciones de plataforma ISR + IVA (placeholder hasta Facturapi), y
// paquetería pass-through (opcional).
//
// Reemplaza al cálculo simple de freightFees.js para los flujos de pricing
// de productos y servicios. freightFees.js sigue vigente para la venta
// pública de guías de paquetería (donde IVA siempre viene incluido en el
// flete y no se desglosa).
//
// Modelo:
//   priceSubunits: lo que el seller teclea como precio TOTAL del producto.
//                  Si ivaMode='16%' se asume que incluye IVA; se descompone
//                  en subtotal + IVA. Si '0%' o 'exento', el precio es el
//                  subtotal (no hay IVA a descomponer).
//
//   Fees Xololo (sobre el precio total):
//     - Motor de cobro: 3.6% + IVA del 16% sobre ese 3.6%  = 4.176% efectivo
//     - Serv administrativos: $14.00 + IVA = $16.24 fijo por transacción
//
//   Retenciones (sobre el subtotal sin IVA):
//     - ISR plataforma: 1.0% fija (LISR 113-A — enajenación de bienes y
//       servicios en general). Transporte/entrega sería 2.1%, hospedaje
//       4% — no aplica a casi ningún seller Xololo hoy.
//     - IVA plataforma: 8% (= 50% del IVA causado del 16%), sólo si GRAVADO
//   Las retenciones se aplican SÓLO cuando `applyWithholdings=true` Y el
//   seller es persona física. Hoy el default es false hasta que Xololo se
//   registre como plataforma tecnológica ante SAT.
//
//   Paquetería (shippingSubunits): pass-through al transportista. NO afecta
//   el cálculo del seller — se cobra al cliente y se paga a Skydropx. Se
//   muestra separado para que el seller entienda qué paga realmente el
//   cliente ($producto + $envío = cliente paga total).
//
// Todos los montos en subunits (centavos MXN).

const PCT_IVA = 0.16;
const PCT_MOTOR = 0.036;

// XOLOLO: comisión de servicios administrativos de Xololo. Se calcula
// POR PRODUCTO (no por seller) con una tabla por tramos según el precio
// del listing. Un mismo seller puede tener listings en distintos tramos
// — cada venta se cobra con la tasa que corresponda a su precio.
//
// Rationale del escalonado: una tasa plana lastima al ticket bajo (una
// venta de $300 con 10% quema la operación del seller casual) o
// subsidia al ticket alto. La curva baja al subir el ticket para que
// Xololo capture valor en ventas chicas sin volverse prohibitivo arriba.
//
// Tramos:
//   - $1 - $50,000       (<= 5000000 subunits):  9%
//   - $50,001 - $100,000 (<= 10000000 subunits): 6%
//   - Más de $100,000:                            3%
//
// Al cargo porcentual se le suma IVA 16% (Xololo factura su comisión y
// causa IVA aunque el bien vendido esté exento por Art. 9 IV LIVA).
export const COMMISSION_TIERS = [
  { upToSubunits: 5000000, pct: 0.09, label: '$1 - $50,000' },
  { upToSubunits: 10000000, pct: 0.06, label: '$50,001 - $100,000' },
  { upToSubunits: Infinity, pct: 0.03, label: 'Más de $100,000' },
];

export const resolveCommissionTier = priceSubunits => {
  const p = Number(priceSubunits) || 0;
  return COMMISSION_TIERS.find(t => p <= t.upToSubunits) || null;
};

export const resolveCommissionPct = priceSubunits => {
  const tier = resolveCommissionTier(priceSubunits);
  return tier ? tier.pct : 0;
};

// Retención ISR por plataforma a personas físicas, LISR Art. 113-A.
// La tasa depende del tipo de actividad fiscal del listing:
//   - Enajenación de bienes y servicios en general: 1.0%  ← default Xololo
//   - Transporte terrestre y entrega de bienes (Rappi, Uber Eats): 2.1%
//   - Hospedaje (Airbnb, Booking, hoteles): 4%
//   - Sin RFC: 20% fijo (gate antifraude #39 fuerza RFC al publicar)
// Reforma LIF 2026: personas morales 4% uniforme (pendiente de modelar
// cuando entre en vigor; hoy PM no tiene retención por plataforma).
export const TAX_ACTIVITIES = {
  ENAJENACION_SERVICIOS: 'enajenacion',
  TRANSPORTE_ENTREGA: 'transporte',
  HOSPEDAJE: 'hospedaje',
};

const RET_ISR_PCT_BY_ACTIVITY = {
  [TAX_ACTIVITIES.ENAJENACION_SERVICIOS]: 0.01,
  [TAX_ACTIVITIES.TRANSPORTE_ENTREGA]: 0.021,
  [TAX_ACTIVITIES.HOSPEDAJE]: 0.04,
};

const PCT_RET_ISR_NO_RFC = 0.20;

// Tipo de persona del seller. Define si aplican retenciones por plataforma:
//   - INDIVIDUAL (particular ocasional): NO contribuyente LISR 113-A, no se
//     le retiene ISR. Si vende producto gravado 16% sí se le retiene IVA.
//   - PHYSICAL_BUSINESS (PF con actividad empresarial): aplica tabla LISR
//     113-A según actividad; sin RFC = 20% + IVA 16% (100% del causado).
//   - MORAL (persona moral): LISR 113-A y LIVA 18-J NO le aplican hoy.
//     Reforma LIF 2026 agregará ISR 4% + IVA 8% retenidos cuando entre.
export const PERSON_TYPES = {
  INDIVIDUAL: 'individual',
  PHYSICAL_BUSINESS: 'physical_business',
  MORAL: 'moral',
};

// Retención IVA por plataforma a personas físicas inscritas, LIVA 18-J.
// 8% = 50% del IVA causado del 16%. Sólo aplica si el producto es gravado
// Y el seller es PF (particular o empresarial inscrito). Para PM no aplica
// hoy (reforma LIF 2026 lo cambiará). Sin RFC = 16% (100% del causado).
const PCT_RET_IVA = 0.08;
const PCT_RET_IVA_NO_RFC = 0.16;

const round = n => Math.round(n);

// Valores canónicos para el campo `ivaMode`. Expuesto como constantes para
// que los callers no se equivoquen de string.
export const IVA_MODES = {
  GRAVADO: '16%',
  TASA_CERO: '0%',
  EXENTO: 'exento',
};

const asSubunits = raw => {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

// Formato legible del porcentaje de retención ISR según actividad.
// Mantiene decimales sólo cuando aportan información (1.0% y 2.1%; 4%
// se muestra como entero).
const formatPct = pct => {
  const asPercent = pct * 100;
  const rounded = Math.round(asPercent * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
};

/**
 * Calcula el desglose completo del payout del seller.
 *
 * @param {Object} params
 * @param {number} params.priceSubunits - Precio total del producto en centavos.
 * @param {string} [params.ivaMode='16%'] - IVA_MODES.GRAVADO / TASA_CERO / EXENTO
 * @param {string} [params.taxActivity='enajenacion'] - TAX_ACTIVITIES.*
 *   determina la tasa de retención ISR (1% / 2.1% / 4%).
 * @param {string} [params.personType='physical_business'] - PERSON_TYPES.*
 *   Particular ocasional / PF empresarial / Persona moral. Define si aplican
 *   retenciones LISR 113-A y LIVA 18-J (particular y PM = no aplican).
 * @param {boolean} [params.hasRfc=true] - Si el seller está inscrito al RFC.
 *   Solo relevante para PF empresarial. Sin RFC = ISR 20% + IVA 16%.
 * @param {number} [params.shippingSubunits=0] - Paquetería pass-through.
 * @param {boolean} [params.applyWithholdings=false] - Si retiene ISR/IVA.
 *   Default false hasta que Xololo se registre como plataforma tecnológica.
 */
export const computePayoutBreakdown = ({
  priceSubunits,
  ivaMode = IVA_MODES.GRAVADO,
  taxActivity = TAX_ACTIVITIES.ENAJENACION_SERVICIOS,
  personType = PERSON_TYPES.PHYSICAL_BUSINESS,
  hasRfc = true,
  shippingSubunits = 0,
  applyWithholdings = false,
} = {}) => {
  const price = asSubunits(priceSubunits);
  const shipping = asSubunits(shippingSubunits);

  // Descomposición subtotal + IVA según el modo.
  let subtotal;
  let iva;
  if (ivaMode === IVA_MODES.GRAVADO) {
    subtotal = round(price / (1 + PCT_IVA));
    iva = price - subtotal;
  } else {
    subtotal = price;
    iva = 0;
  }

  const clientPays = price + shipping;

  // Fees Xololo sobre el precio total (con IVA incluido si aplica).
  const motorCobroBase = round(price * PCT_MOTOR);
  const ivaMotor = round(motorCobroBase * PCT_IVA);
  const motorCobroTotal = motorCobroBase + ivaMotor;

  // XOLOLO: comisión de servicios administrativos — tabla por tramos
  // según el PRECIO del listing (no según el seller). El mismo seller
  // puede tener distintos listings cayendo en distintos tramos.
  //   $1 - $50,000: 9% · $50,001 - $100,000: 6% · $100,001+: 3%
  // Al cargo se le suma IVA 16% (Xololo es contribuyente del IVA).
  const commissionTier = resolveCommissionTier(price);
  const commissionPct = commissionTier ? commissionTier.pct : 0;
  const xololoAdminBase = round(price * commissionPct);
  const ivaXololoAdmin = round(xololoAdminBase * PCT_IVA);
  const xololoAdminTotal = xololoAdminBase + ivaXololoAdmin;

  // Retenciones de plataforma. Lógica legal estricta:
  //   - Particular (ocasional, no empresa): no es contribuyente LISR 113-A.
  //     Sin retención ISR. Sí retención IVA si el producto es gravado.
  //   - Persona moral: ni LISR 113-A ni LIVA 18-J aplican hoy. Reforma
  //     LIF 2026 agregará ISR 4% + IVA 8%; pendiente modelar.
  //   - PF empresarial inscrita al RFC: ISR según actividad + IVA 8%.
  //   - PF empresarial sin RFC: ISR 20% + IVA 16% (100% del causado).
  //
  // `applyWithholdings` sigue siendo el master-switch global (hoy false
  // hasta que Xololo quede inscrita como plataforma tecnológica ante SAT).
  const canRetain = applyWithholdings && price > 0;
  const isMoral = personType === PERSON_TYPES.MORAL;
  const isIndividual = personType === PERSON_TYPES.INDIVIDUAL;

  // ISR: 0 para particular y PM; variable para PF empresarial.
  let retIsrPct = 0;
  if (canRetain && !isMoral && !isIndividual) {
    retIsrPct = hasRfc
      ? RET_ISR_PCT_BY_ACTIVITY[taxActivity] ??
        RET_ISR_PCT_BY_ACTIVITY[TAX_ACTIVITIES.ENAJENACION_SERVICIOS]
      : PCT_RET_ISR_NO_RFC;
  }
  const retIsr = round(subtotal * retIsrPct);

  // IVA retenido: 0 para PM; para PF (particular o empresarial) aplica si
  // el producto es gravado 16%.
  let retIvaPct = 0;
  if (canRetain && !isMoral && ivaMode === IVA_MODES.GRAVADO) {
    retIvaPct = hasRfc ? PCT_RET_IVA : PCT_RET_IVA_NO_RFC;
  }
  const retIva = round(subtotal * retIvaPct);

  const sellerReceives = price - motorCobroTotal - xololoAdminTotal - retIsr - retIva;

  return {
    // Entrada
    priceSubunits: price,
    ivaMode,
    taxActivity,
    personType,
    hasRfc,
    shippingSubunits: shipping,

    // Descomposición
    subtotalSubunits: subtotal,
    ivaSubunits: iva,
    clientPaysSubunits: clientPays,

    // Fees Xololo
    motorCobroSubunits: motorCobroTotal,
    xololoAdminSubunits: xololoAdminTotal,

    // Retenciones
    retIsrSubunits: retIsr,
    retIsrPct,
    retIvaSubunits: retIva,
    retIvaPct,
    appliedWithholdings: canRetain,

    // Resultado
    sellerReceivesSubunits: sellerReceives,

    // Labels para la UI (porcentajes legibles).
    labels: {
      iva: ivaMode === IVA_MODES.GRAVADO ? '16%' : ivaMode === IVA_MODES.TASA_CERO ? '0%' : 'Exento',
      motorCobro: `${(PCT_MOTOR * 100).toFixed(1)}% + IVA`,
      xololoAdmin: `${(commissionPct * 100).toFixed(0)}% + IVA · ${commissionTier?.label || ''}`,
      retIsr: formatPct(retIsrPct),
      retIva: formatPct(retIvaPct),
    },
  };
};
