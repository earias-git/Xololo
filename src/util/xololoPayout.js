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
const FIXED_XOLOLO_SUBUNITS = 1400;

// Retención ISR por plataforma a personas físicas, LISR Art. 113-A.
// La tasa depende del tipo de actividad fiscal del listing:
//   - Enajenación de bienes y servicios en general: 1.0%  ← default Xololo
//   - Transporte terrestre y entrega de bienes (Rappi, Uber Eats): 2.1%
//   - Hospedaje (Airbnb, Booking, hoteles): 4%
//   - Sin RFC: 20% fijo (gate antifraude #39 fuerza RFC al publicar)
// Reforma LIF 2026: personas morales 4% uniforme (no modelado aquí porque
// hoy las retenciones están desactivadas hasta registro SAT).
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

// Retención IVA por plataforma a personas físicas inscritas, LIVA 18-J.
// 8% = 50% del IVA causado del 16%. Sólo aplica si el producto es gravado.
// La tasa de IVA retenido NO depende de la actividad fiscal, sólo del
// régimen IVA del listing (16%, 0%, exento).
const PCT_RET_IVA = 0.08;

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
 * @param {number} [params.shippingSubunits=0] - Paquetería pass-through.
 * @param {boolean} [params.applyWithholdings=false] - Si retiene ISR/IVA.
 *   Default false hasta que Xololo se registre como plataforma tecnológica.
 * @param {boolean} [params.sellerIsPhysicalPerson=true] - Las retenciones de
 *   plataforma sólo aplican a personas físicas (LISR 113-A, LIVA 18-J).
 */
export const computePayoutBreakdown = ({
  priceSubunits,
  ivaMode = IVA_MODES.GRAVADO,
  taxActivity = TAX_ACTIVITIES.ENAJENACION_SERVICIOS,
  shippingSubunits = 0,
  applyWithholdings = false,
  sellerIsPhysicalPerson = true,
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

  const xololoAdminBase = FIXED_XOLOLO_SUBUNITS;
  const ivaXololoAdmin = round(xololoAdminBase * PCT_IVA);
  const xololoAdminTotal = xololoAdminBase + ivaXololoAdmin;

  // Retenciones de plataforma. Placeholder hasta Facturapi + registro SAT.
  const retIsrPct =
    RET_ISR_PCT_BY_ACTIVITY[taxActivity] ??
    RET_ISR_PCT_BY_ACTIVITY[TAX_ACTIVITIES.ENAJENACION_SERVICIOS];
  const shouldWithhold = applyWithholdings && sellerIsPhysicalPerson && price > 0;
  const retIsr = shouldWithhold ? round(subtotal * retIsrPct) : 0;
  const retIva =
    shouldWithhold && ivaMode === IVA_MODES.GRAVADO ? round(subtotal * PCT_RET_IVA) : 0;

  const sellerReceives = price - motorCobroTotal - xololoAdminTotal - retIsr - retIva;

  return {
    // Entrada
    priceSubunits: price,
    ivaMode,
    taxActivity,
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
    appliedWithholdings: shouldWithhold,

    // Resultado
    sellerReceivesSubunits: sellerReceives,

    // Labels para la UI (porcentajes legibles).
    labels: {
      iva: ivaMode === IVA_MODES.GRAVADO ? '16%' : ivaMode === IVA_MODES.TASA_CERO ? '0%' : 'Exento',
      motorCobro: `${(PCT_MOTOR * 100).toFixed(1)}% + IVA`,
      xololoAdmin: `$${(FIXED_XOLOLO_SUBUNITS / 100).toFixed(2)} + IVA`,
      retIsr: formatPct(retIsrPct),
      retIva: `${(PCT_RET_IVA * 100).toFixed(0)}%`,
    },
  };
};
