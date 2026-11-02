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

// XOLOLO: cuota administrativa plana por venta — $14 MXN + IVA 16% por
// transacción. Aplica a TODOS los sellers (store y casual_reseller),
// cubre procesamiento, verificación, pago protegido y soporte.
// Se cobra siempre, sin importar el monto de la venta.
const FIXED_ADMIN_FEE_SUBUNITS = 1400; // $14.00 MXN

// Alias retrocompatible — algunos callers externos siguen importando el
// nombre viejo. No tocar sin un barrido primero.
const FIXED_XOLOLO_STORE_SUBUNITS = FIXED_ADMIN_FEE_SUBUNITS;

// XOLOLO: identificador del modo seller casual. Debe mantenerse en sync
// con SELLER_MODES.CASUAL_RESELLER de xololoSellerMode (literal string
// para evitar ciclo de imports).
const SELLER_MODE_CASUAL = 'casual_reseller';

// XOLOLO: COMISIÓN POR VENTA de Xololo para el seller casual
// (segunda mano particular, sin suscripción). Es ADICIONAL al cargo
// administrativo plano de $14 + IVA (que todos pagan). Se calcula con
// tramos MARGINALES sobre el precio del listing — cada porción del
// precio dentro de un tramo se cobra con la tasa de ese tramo (como ISR).
//
// IMPORTANTE: esta tabla aplica SOLO al modo casual_reseller. Para
// sellers con tienda (Starter y Empresarial) la comisión por venta es
// 0% — ya está incluida en la suscripción mensual. Ambos tipos de
// seller siguen pagando el cargo administrativo plano de $14 + IVA.
//
// Rationale del escalonado marginal: el casual NO paga suscripción,
// entonces la comisión por venta es su único canal de contribución a
// Xololo. La curva baja al subir el ticket para no quemar al particular
// que vende un bien de valor alto ocasional. Marginal (vs. plana por
// tramos) evita saltos absurdos en los bordes.
//
// Tramos marginales (ajustados Nov 2026 — bajamos de 9/6/3 a 6/4/2):
//   - Hasta  $50,000     (primeros 5000000 subunits):  6% sobre esa porción
//   - Entre  $50,001-$100,000 (siguientes 5000000):    4% sobre esa porción
//   - Más de $100,000:                                 2% sobre lo que exceda
//
// Al cargo total se le suma IVA 16% (Xololo es contribuyente del IVA
// aunque el bien vendido esté exento por Art. 9 IV LIVA).
//
// Ejemplos:
//   $75,000  → 50000*6% + 25000*4% = 3000 + 1000 = 4000   (efectivo ~5.33%)
//   $150,000 → 50000*6% + 50000*4% + 50000*2% = 6000       (efectivo 4.0%)
export const COMMISSION_TIERS = [
  { upToSubunits: 5000000, pct: 0.06, label: 'Primeros $50,000' },
  { upToSubunits: 10000000, pct: 0.04, label: '$50,001 - $100,000' },
  { upToSubunits: Infinity, pct: 0.02, label: 'Más de $100,000' },
];

/**
 * Comisión Xololo (sin IVA) para un precio dado, usando tramos
 * marginales. Solo aplica a seller casual. Devuelve subunits enteros,
 * con desglose por tramo.
 */
export const computeMarginalCommission = priceSubunits => {
  const p = Math.max(0, Number(priceSubunits) || 0);
  let remaining = p;
  let lastCap = 0;
  let baseFloat = 0;
  const breakdown = [];
  for (const tier of COMMISSION_TIERS) {
    if (remaining <= 0) break;
    const span =
      tier.upToSubunits === Infinity ? remaining : Math.max(0, tier.upToSubunits - lastCap);
    const applied = Math.min(remaining, span);
    const fee = applied * tier.pct;
    baseFloat += fee;
    breakdown.push({ pct: tier.pct, portion: applied, feeSubunits: Math.round(fee) });
    remaining -= applied;
    lastCap = tier.upToSubunits;
  }
  const base = Math.round(baseFloat);
  const effectivePct = p > 0 ? base / p : 0;
  return { baseSubunits: base, breakdown, effectivePct };
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

const PCT_RET_ISR_NO_RFC = 0.2;

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
 * @param {string} [params.sellerMode='store'] - 'store' | 'casual_reseller'.
 *   Determina cómo se cobra la comisión Xololo: 'store' paga $14 fijo
 *   + IVA (seller con suscripción, incluye Starter y Empresarial);
 *   'casual_reseller' paga la tabla marginal 6/4/2% + IVA (sin suscripción).
 */
export const computePayoutBreakdown = ({
  priceSubunits,
  ivaMode = IVA_MODES.GRAVADO,
  taxActivity = TAX_ACTIVITIES.ENAJENACION_SERVICIOS,
  personType = PERSON_TYPES.PHYSICAL_BUSINESS,
  hasRfc = true,
  shippingSubunits = 0,
  applyWithholdings = false,
  sellerMode = 'store',
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

  // XOLOLO: dos conceptos separados.
  //
  //   1) CARGO ADMINISTRATIVO PLANO ($14 + IVA): todos los sellers lo
  //      pagan por venta, independientemente del plan o del monto.
  //      Cubre procesamiento, verificación, pago protegido y soporte.
  //
  //   2) COMISIÓN POR VENTA (% sobre el monto): varía por sellerMode:
  //        - store (Starter/Empresarial): 0% — incluida en suscripción.
  //        - casual_reseller: tabla marginal 6/4/2% — es la contribución
  //          del casual, que no paga suscripción.
  //
  //   Ambos se descuentan del payout del seller y cada uno causa su
  //   propio IVA 16% (Xololo es contribuyente de IVA aun cuando el bien
  //   vendido esté exento por Art. 9 IV LIVA).
  const isCasualMode = sellerMode === SELLER_MODE_CASUAL;

  // (1) Admin plano
  const adminFlatBase = FIXED_ADMIN_FEE_SUBUNITS;
  const ivaAdminFlat = round(adminFlatBase * PCT_IVA);
  const adminFlatTotal = adminFlatBase + ivaAdminFlat;

  // (2) Comisión por venta
  const commission = isCasualMode
    ? computeMarginalCommission(price)
    : { baseSubunits: 0, breakdown: [], effectivePct: 0 };
  const commissionBase = commission.baseSubunits;
  const ivaCommission = round(commissionBase * PCT_IVA);
  const commissionTotal = commissionBase + ivaCommission;

  // Total combinado — expuesto como xololoAdminSubunits para
  // retrocompatibilidad con los componentes que ya lo consumen.
  const xololoAdminTotal = adminFlatTotal + commissionTotal;

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
    // Suma total (admin plano + comisión por venta) — mantiene
    // compatibilidad con componentes que ya leían este campo.
    xololoAdminSubunits: xololoAdminTotal,
    xololoAdminBreakdown: commission.breakdown,
    xololoAdminEffectivePct: commission.effectivePct,
    // Desglose nuevo: separa el cargo administrativo plano (siempre
    // $14 + IVA) de la comisión por venta (6/4/2 marginal para casual,
    // 0 para store).
    adminFlatSubunits: adminFlatTotal,
    commissionSubunits: commissionTotal,
    commissionBreakdown: commission.breakdown,
    commissionEffectivePct: commission.effectivePct,

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
      iva:
        ivaMode === IVA_MODES.GRAVADO ? '16%' : ivaMode === IVA_MODES.TASA_CERO ? '0%' : 'Exento',
      motorCobro: `${(PCT_MOTOR * 100).toFixed(1)}% + IVA`,
      xololoAdmin: isCasualMode
        ? `$${(FIXED_ADMIN_FEE_SUBUNITS / 100).toFixed(2)} + IVA (admin) + ${(
            commission.effectivePct * 100
          ).toFixed(1)}% + IVA (comisión 6/4/2 marginal)`
        : `$${(FIXED_ADMIN_FEE_SUBUNITS / 100).toFixed(
            2
          )} + IVA · comisión 0% (incluida en suscripción)`,
      adminFlat: `$${(FIXED_ADMIN_FEE_SUBUNITS / 100).toFixed(2)} + IVA`,
      commission: isCasualMode
        ? `${(commission.effectivePct * 100).toFixed(1)}% efectivo + IVA · tramos 6/4/2`
        : '0% (incluida en suscripción)',
      retIsr: formatPct(retIsrPct),
      retIva: formatPct(retIvaPct),
    },
  };
};
