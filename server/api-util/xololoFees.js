// XOLOLO: modelo de negocio real (feedback directo de earias tras
// navegar el sitio en vivo, 2026-09-24). Reemplaza el mecanismo
// estándar de comisión de Sharetribe (asset de Console vía
// fetchCommission) — control directo y auditable en código, sin
// depender de que Console esté configurado correctamente.
//
// a.1: SIN comisión por venta — Xololo no se queda con % del precio
//      del producto.
// a.2: 3.6% + IVA por "motor de pago" (procesamiento de tarjeta).
//      Xololo SIEMPRE cobra este % al seller, sin importar lo que
//      Stripe le cobre a Xololo por debajo — al inicio es igual a lo
//      que cobra Stripe, pero si Stripe baja su tarifa con el tiempo,
//      la diferencia se vuelve utilidad de Xololo (el seller sigue
//      viendo el mismo 3.6%+IVA siempre).
// a.3: cargo fijo de $14 + IVA por transacción — costos
//      administrativos y servicios digitales de terceros.
//
// Ambos se DESCUENTAN DEL PAYOUT DEL SELLER (confirmado con earias) —
// el comprador paga el precio del producto + envío tal cual, sin
// ningún cargo adicional en el checkout.

const IVA_RATE = 0.16;

const PAYMENT_PROCESSING_FEE_PERCENT = 3.6; // + IVA
const FIXED_SERVICE_FEE_MXN = 14; // + IVA

// Sharetribe sólo soporta UNA línea `line-item/provider-commission` por
// transacción, con UN solo `percentage` — por eso el 3.6% y su IVA se
// combinan en un solo porcentaje compuesto (3.6 * 1.16 = 4.176), en vez
// de 2 líneas separadas de "tarifa" + "IVA de la tarifa".
const PROVIDER_COMMISSION_PERCENTAGE = Number(
  (PAYMENT_PROCESSING_FEE_PERCENT * (1 + IVA_RATE)).toFixed(4)
); // 4.176

// El cargo fijo SÍ puede ir en una línea propia (no es el slot
// reservado de "comisión"), en centavos, IVA incluido.
const FIXED_SERVICE_FEE_SUBUNITS = Math.round(FIXED_SERVICE_FEE_MXN * (1 + IVA_RATE) * 100); // 1624 = $16.24 MXN

const LINE_ITEM_XOLOLO_SERVICE_FEE = 'line-item/xololo-service-fee';

// ============================================================
// XOLOLO: Comisión por venta para casual_reseller.
//
// Modelo (Nov 2026, decisión earias):
//   - Todos los sellers pagan el cargo administrativo plano
//     ($14 + IVA = FIXED_SERVICE_FEE_SUBUNITS) por transacción.
//   - Sellers con tienda (Starter/Empresarial) pagan 0% comisión por
//     venta — está incluida en su suscripción mensual.
//   - casual_reseller paga una comisión ESCALONADA MARGINAL sobre el
//     precio del listing, además del cargo plano. Esta tabla se cobra
//     como una línea aparte `line-item/xololo-casual-commission`.
//
// Tasa marginal por tramo:
//   - Hasta  $50,000  : 6%
//   - $50,001-$100,000: 4%
//   - Más de $100,000 : 2%
//
// Al cargo se le suma IVA 16% (Xololo es contribuyente del IVA).
//
// Mirror auditable de COMMISSION_TIERS en src/util/xololoPayout.js
// (que es la fuente canónica para el preview UI). Mantener en sync.
// ============================================================

const CASUAL_COMMISSION_TIERS = [
  { upToSubunits: 5000000, pct: 0.06 },   // $50,000
  { upToSubunits: 10000000, pct: 0.04 },  // $100,000
  { upToSubunits: Infinity, pct: 0.02 },
];

const LINE_ITEM_XOLOLO_CASUAL_COMMISSION = 'line-item/xololo-casual-commission';

const SELLER_MODE_CASUAL = 'casual_reseller';

/**
 * Calcula la comisión por venta del casual_reseller (base sin IVA)
 * aplicando tramos marginales. Devuelve subunits enteros.
 *
 * @param {number} priceSubunits - precio del listing en centavos
 * @returns {number} comisión base en subunits (sin IVA)
 */
const computeCasualCommissionSubunits = priceSubunits => {
  const p = Math.max(0, Number(priceSubunits) || 0);
  let remaining = p;
  let lastCap = 0;
  let feeFloat = 0;
  for (const tier of CASUAL_COMMISSION_TIERS) {
    if (remaining <= 0) break;
    const span =
      tier.upToSubunits === Infinity ? remaining : Math.max(0, tier.upToSubunits - lastCap);
    const applied = Math.min(remaining, span);
    feeFloat += applied * tier.pct;
    remaining -= applied;
    lastCap = tier.upToSubunits;
  }
  return Math.round(feeFloat);
};

/**
 * Comisión por venta del casual con IVA ya incluido, lista para una
 * line-item de Sharetribe. Devuelve 0 si el seller NO es casual_reseller.
 *
 * @param {number} priceSubunits
 * @param {string} sellerMode - 'store' | 'casual_reseller'
 * @returns {number} subunits totales (base + IVA 16%)
 */
const computeCasualCommissionWithIvaSubunits = (priceSubunits, sellerMode) => {
  if (sellerMode !== SELLER_MODE_CASUAL) return 0;
  const base = computeCasualCommissionSubunits(priceSubunits);
  const iva = Math.round(base * IVA_RATE);
  return base + iva;
};

// ============================================================
// XOLOLO Fase 1 (hoja Arquitectura técnica §2) — Catálogo nuevo
// de cargos del sistema de penalidades y disputas. Decisiones
// cerradas 2026-10-06 con earias (ver Google Sheets "Políticas
// de Refund" → hoja "Catálogo de cargos").
//
// IMPORTANTE: estas constantes son el ÚNICO lugar donde viven los
// montos exactos. Cualquier código que aplique penalidad, dispute
// fee o chargeback debe importar de aquí — nunca hardcodear el
// monto en el consumer.
// ============================================================

// Line-item codes (claves técnicas en Sharetribe).
const LINE_ITEM_PENALTY_LEVEL_1 = 'line-item/penalty-level-1';
const LINE_ITEM_PENALTY_LEVEL_2 = 'line-item/penalty-level-2';
const LINE_ITEM_PENALTY_LEVEL_3 = 'line-item/penalty-level-3';
const LINE_ITEM_XOLOLO_DISPUTE_FEE = 'line-item/xololo-dispute-fee';
const LINE_ITEM_STRIPE_CHARGEBACK_FEE = 'line-item/stripe-chargeback-fee';
const LINE_ITEM_SERVICE_CANCELLATION_RETENTION = 'line-item/service-cancellation-retention';

// Montos base en MXN (unidades enteras).
const PENALTY_LEVEL_1_MXN = 50;
const PENALTY_LEVEL_2_MXN = 250;
const PENALTY_LEVEL_3_MXN = 1000;
const XOLOLO_DISPUTE_FEE_MXN = 380;

// Subunidades con IVA ya aplicado (lo que efectivamente se cobra).
// Mantener consistencia con FIXED_SERVICE_FEE_SUBUNITS que ya hace esto.
const PENALTY_LEVEL_1_SUBUNITS = Math.round(PENALTY_LEVEL_1_MXN * (1 + IVA_RATE) * 100); //  5800
const PENALTY_LEVEL_2_SUBUNITS = Math.round(PENALTY_LEVEL_2_MXN * (1 + IVA_RATE) * 100); // 29000
const PENALTY_LEVEL_3_SUBUNITS = Math.round(PENALTY_LEVEL_3_MXN * (1 + IVA_RATE) * 100); // 116000
const XOLOLO_DISPUTE_FEE_SUBUNITS = Math.round(XOLOLO_DISPUTE_FEE_MXN * (1 + IVA_RATE) * 100); // 44080

// Reincidencia: ventana rolling en días para contar faltas previas
// y decidir escalera (N1 → N2 → N3). Aplicación es MANUAL por
// operator (decisión 2026-10-06), este valor solo guía la UI del
// panel contextual (/admin/users/{id} muestra faltas de esta ventana).
const REINCIDENCE_WINDOW_DAYS = 30;

// Chargeback bancario Stripe: el fee lo cobra Stripe al merchant.
// Mantengamos el monto como null porque es dinámico (TC del día) —
// se obtiene del webhook `charge.dispute.created` en metadata.
// Esta constante existe solo para claridad semántica.
const STRIPE_CHARGEBACK_FEE_USD_APPROX = 15; // Stripe default MX

module.exports = {
  PROVIDER_COMMISSION_PERCENTAGE,
  FIXED_SERVICE_FEE_SUBUNITS,
  LINE_ITEM_XOLOLO_SERVICE_FEE,

  // Comisión casual_reseller
  CASUAL_COMMISSION_TIERS,
  LINE_ITEM_XOLOLO_CASUAL_COMMISSION,
  SELLER_MODE_CASUAL,
  computeCasualCommissionSubunits,
  computeCasualCommissionWithIvaSubunits,

  // Fase 1 — nuevos
  LINE_ITEM_PENALTY_LEVEL_1,
  LINE_ITEM_PENALTY_LEVEL_2,
  LINE_ITEM_PENALTY_LEVEL_3,
  LINE_ITEM_XOLOLO_DISPUTE_FEE,
  LINE_ITEM_STRIPE_CHARGEBACK_FEE,
  LINE_ITEM_SERVICE_CANCELLATION_RETENTION,

  PENALTY_LEVEL_1_MXN,
  PENALTY_LEVEL_2_MXN,
  PENALTY_LEVEL_3_MXN,
  XOLOLO_DISPUTE_FEE_MXN,

  PENALTY_LEVEL_1_SUBUNITS,
  PENALTY_LEVEL_2_SUBUNITS,
  PENALTY_LEVEL_3_SUBUNITS,
  XOLOLO_DISPUTE_FEE_SUBUNITS,

  REINCIDENCE_WINDOW_DAYS,
  STRIPE_CHARGEBACK_FEE_USD_APPROX,
  IVA_RATE,
};
