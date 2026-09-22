// XOLOLO: helpers para leer cantidades y montos de line-items sin
// asumir un shape específico.
//
// Sharetribe SDK devuelve line-items con dos representaciones posibles
// según cómo se serialice la respuesta:
//
//   { quantity: 3 }
//   { quantity: '3' }
//   { quantity: { _sdkType: 'BigDecimal', value: '3' } }   ← integration API
//   { quantity: BigDecimal-instance-with-toString }
//
// Antes usábamos `Number(li.quantity) || 0`, que devuelve NaN para
// los objetos BigDecimal → cuenta 0. Bug descubierto 2026-09-22:
// public-store-stats reportaba productsSold: 0 con ordersTotal: 12
// porque las cantidades siempre venían como BigDecimal object desde
// Integration SDK. Mismo bug afectaba a: seller-catalog-insights,
// seller-analytics-export, monthly-report y — más grave —
// generate-shipping-guide (calculaba parcel siempre asumiendo qty=1).

// Lee la cantidad de un line-item (o de un valor de quantity ya
// extraído). Devuelve un number seguro; 0 si no se puede parsear.
const readLineItemQty = liOrValue => {
  if (liOrValue == null) return 0;
  const q =
    typeof liOrValue === 'object' && 'quantity' in liOrValue
      ? liOrValue.quantity
      : liOrValue;
  if (q == null) return 0;
  if (typeof q === 'number') return Number.isFinite(q) ? q : 0;
  if (typeof q === 'string') {
    const n = Number(q);
    return Number.isFinite(n) ? n : 0;
  }
  // BigDecimal serializado como {_sdkType, value} o con toString().
  if (typeof q === 'object') {
    if (typeof q.value === 'string') {
      const n = Number(q.value);
      return Number.isFinite(n) ? n : 0;
    }
    if (typeof q.toString === 'function') {
      const s = q.toString();
      const n = Number(s);
      return Number.isFinite(n) ? n : 0;
    }
  }
  return 0;
};

// Lee un amount monetario (subunits) de un {amount, currency} o
// directamente de un number. Devuelve 0 si no se puede parsear.
const readMoneyAmount = m => {
  if (m == null) return 0;
  if (typeof m === 'number') return Number.isFinite(m) ? m : 0;
  if (typeof m === 'object' && typeof m.amount !== 'undefined') {
    return readMoneyAmount(m.amount);
  }
  if (typeof m === 'string') {
    const n = Number(m);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

module.exports = { readLineItemQty, readMoneyAmount };
