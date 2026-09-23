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

module.exports = {
  PROVIDER_COMMISSION_PERCENTAGE,
  FIXED_SERVICE_FEE_SUBUNITS,
  LINE_ITEM_XOLOLO_SERVICE_FEE,
};
