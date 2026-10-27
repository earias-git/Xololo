// XOLOLO 2026-10-27: monitoreo de pérdidas por diferencia entre lo que
// cobramos al buyer y lo que Skydropx cobra realmente.
//
// Causas típicas de discrepancia:
//  - Zona extendida detectada al generar el shipment (no en la
//    cotización). Resuelto parcialmente en commit 57ab7f8db mandando
//    dirección completa, pero quedamos pendientes de confirmar con
//    Skydropx si /quotations ya aplica el ajuste.
//  - Dimensiones o peso reales distintos a lo cotizado (seller cometió
//    error en el listing).
//  - Cambios de tarifa de Skydropx entre cotización e initiate.
//  - Bug nuestro: rate.total mal propagado a lineItems.
//
// Umbral: 10% o $50 MXN (lo que sea mayor). Debajo de esto se asume
// variación normal (redondeo, cargos menores).

const DISCREPANCY_THRESHOLD_PCT = 0.1; // 10%
const DISCREPANCY_THRESHOLD_ABS_MXN = 50;

/**
 * Compara lo que esperábamos cobrar vs lo que Skydropx realmente cobra.
 * Devuelve el objeto discrepancia si supera el umbral, null si no.
 *
 * @param {Object} params
 * @param {number} params.expectedShippingFeePublic — lo que cobramos al
 *   buyer por envío (sin seguro).
 * @param {number} params.actualSkydropxCostMxn — costo real del shipment
 *   según Skydropx (sin margen Xololo). Puede ser null si Skydropx no lo
 *   expone en el response.
 * @param {Object} [params.context] — datos de contexto (txId, carrier,
 *   service) para enriquecer el log.
 *
 * @returns {null | {
 *   expected: number,     // lo que esperamos
 *   actual: number,       // lo que Skydropx cobra
 *   diff: number,         // actual - expected (positivo = pérdida)
 *   diffPct: number,      // diff / expected
 *   lossMxn: number,      // la pérdida real a Xololo (si diff > 0)
 *   detectedAt: string,   // ISO timestamp
 *   context: Object
 * }}
 */
const detectShippingLoss = ({
  expectedShippingFeePublic,
  actualSkydropxCostMxn,
  context = {},
}) => {
  // Guard: necesitamos ambos valores presentes y positivos para comparar.
  // Number(null) === 0 → no sirve; chequeamos no-null/no-undefined.
  if (expectedShippingFeePublic == null || actualSkydropxCostMxn == null) {
    return null;
  }
  const expected = Number(expectedShippingFeePublic);
  const actual = Number(actualSkydropxCostMxn);
  if (!Number.isFinite(expected) || !Number.isFinite(actual) || expected <= 0 || actual <= 0) {
    return null;
  }
  // Expected shipping fee ya incluye margen Xololo 12.5%. Lo que tendría
  // que haber cobrado Skydropx: expected / 1.125.
  const expectedSkydropxNet = expected / 1.125;
  const diff = actual - expectedSkydropxNet;
  const diffPct = Math.abs(diff) / expectedSkydropxNet;
  const diffAbs = Math.abs(diff);

  if (diffPct < DISCREPANCY_THRESHOLD_PCT && diffAbs < DISCREPANCY_THRESHOLD_ABS_MXN) {
    return null;
  }

  // Pérdida real: si actual > expected, Xololo lo absorbe (buyer ya
  // pagó, no vamos a cobrar más). Si actual < expected, ganancia inesperada
  // (poco probable con zona extendida).
  const lossMxn = diff > 0 ? Number(diff.toFixed(2)) : 0;

  return {
    expected: Number(expected.toFixed(2)),
    expectedSkydropxNet: Number(expectedSkydropxNet.toFixed(2)),
    actual: Number(actual.toFixed(2)),
    diff: Number(diff.toFixed(2)),
    diffPct: Number(diffPct.toFixed(4)),
    lossMxn,
    detectedAt: new Date().toISOString(),
    context,
  };
};

/**
 * Extrae el costo real del shipment de la respuesta de Skydropx. La API
 * usa distintos campos según versión; probamos varios y nos quedamos
 * con el primero que exista.
 */
const extractActualCost = shipAttrs => {
  if (!shipAttrs) return null;
  const candidates = [
    shipAttrs.master_rate_price,
    shipAttrs.rate_price,
    shipAttrs.price,
    shipAttrs.total_price,
    shipAttrs.total,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
};

module.exports = {
  detectShippingLoss,
  extractActualCost,
  DISCREPANCY_THRESHOLD_PCT,
  DISCREPANCY_THRESHOLD_ABS_MXN,
};
