// XOLOLO · Pricing para VENTA PÚBLICA de guías de paquetería
// (feature #28: cualquier persona puede comprar guías a precio Xololo,
// no sólo sellers). Se diferencia de la política de envíos de productos
// de sellers (ver `applyPricingPolicy` en api-util/skydropx.js) en:
//
//   - Margen Xololo: 12.5% parejo (vs 14% + SOS obligatorio del flujo
//     seller→buyer de productos). Decisión de Enrique 2026-10-13.
//   - Seguro: OPCIONAL (en el flujo seller es obligatorio). El 12.5%
//     también aplica sobre el costo del seguro cuando el buyer lo elija.
//   - El breakdown interno se guarda para analytics y reporting pero
//     NUNCA se expone al buyer: la UI muestra sólo el precio público.
//
// Fórmula: precio_público = (rate_skydropx + seguro_opcional) × 1.125

const XOLOLO_PUBLIC_MARGIN_PCT = 0.125;

/**
 * Aplica el margen Xololo al precio bruto Skydropx (rate + seguro
 * opcional) y devuelve el desglose completo.
 *
 * El llamador recibe `publicTotal` para mostrar al buyer; el resto
 * (`skydropxRate`, `insurance`, `xololoMargin`) es para loguear/
 * persistir en el ledger interno y reporting en /ops.
 *
 * @param {number} skydropxRateMXN - Precio base del rate Skydropx (MXN).
 * @param {number} [insuranceMXN=0] - Costo del seguro opcional (MXN).
 * @returns {{
 *   skydropxRate: number,
 *   insurance: number,
 *   bruto: number,
 *   xololoMargin: number,
 *   publicTotal: number,
 *   marginPct: number,
 * }}
 */
const applyPublicMargin = (skydropxRateMXN, insuranceMXN = 0) => {
  const rate = Number(skydropxRateMXN) || 0;
  const ins = Number(insuranceMXN) || 0;
  const bruto = rate + ins;
  const margin = bruto * XOLOLO_PUBLIC_MARGIN_PCT;
  const publicTotal = bruto + margin;
  return {
    skydropxRate: Number(rate.toFixed(2)),
    insurance: Number(ins.toFixed(2)),
    bruto: Number(bruto.toFixed(2)),
    xololoMargin: Number(margin.toFixed(2)),
    publicTotal: Number(publicTotal.toFixed(2)),
    marginPct: XOLOLO_PUBLIC_MARGIN_PCT,
  };
};

/**
 * Devuelve SÓLO lo que es seguro mostrar al buyer público. Nunca
 * expone skydropxRate ni la composición del precio (requisito de
 * negocio: el buyer compara entre carriers por precio Xololo total).
 *
 * @param {Object} breakdown - Resultado de applyPublicMargin.
 * @returns {{ publicTotal: number, currency: string }}
 */
const toBuyerFacing = breakdown => ({
  publicTotal: breakdown.publicTotal,
  currency: 'MXN',
});

module.exports = {
  XOLOLO_PUBLIC_MARGIN_PCT,
  applyPublicMargin,
  toBuyerFacing,
};
