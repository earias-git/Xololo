// XOLOLO Cart.6: helpers para agregar peso/dimensiones de un carrito
// multi-item en un solo parcel Skydropx.
//
// Contexto: Skydropx /quotations acepta un parcel SINGULAR. Para carritos
// multi-item necesitamos combinar los items en una caja virtual antes de
// cotizar. Y el rate elegido en checkout se cobra sobre ese parcel, así
// que al generar la guía debemos usar exactamente el mismo cálculo.
//
// Modelo "stacking": asumimos que los items se apilan verticalmente
// en una caja donde:
//   length = max(length_i)   ← lado más largo de cualquier item
//   width  = max(width_i)    ← lado más ancho de cualquier item
//   height = sum(height_i * qty_i)   ← altura acumulada
//   weight = sum(weight_i * qty_i)   ← peso acumulado
//
// Es una aproximación conservadora: para artesanías tipo jarrones o
// figuras que caben "una sobre otra" es razonable. Para items muy
// irregulares el seller puede iterar en v2 (packages múltiples).
//
// Cada item de entrada:
//   { weightGrams, dimensionLengthCm, dimensionWidthCm, dimensionHeightCm, quantity }

const FALLBACK_WEIGHT_KG = 0.1;
const FALLBACK_DIM_CM = 1;

// Valida que un item tenga peso + 3 dimensiones válidas. Devuelve null
// si el item es cotizable, o un string con el motivo si no lo es.
const invalidReason = item => {
  if (!item) return 'item vacío';
  const { weightGrams, dimensionLengthCm, dimensionWidthCm, dimensionHeightCm } = item;
  if (!weightGrams || Number(weightGrams) <= 0) return 'peso faltante';
  if (!dimensionLengthCm || Number(dimensionLengthCm) <= 0) return 'largo faltante';
  if (!dimensionWidthCm || Number(dimensionWidthCm) <= 0) return 'ancho faltante';
  if (!dimensionHeightCm || Number(dimensionHeightCm) <= 0) return 'alto faltante';
  return null;
};

// Agrega N items → parcel único { length, width, height, weight (kg) }.
// Lanza Error si algún item no tiene peso/dimensiones.
const aggregateParcel = items => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('aggregateParcel: items array vacío');
  }

  let maxLen = 0;
  let maxWid = 0;
  let sumHei = 0;
  let sumWeightGrams = 0;

  for (const item of items) {
    const bad = invalidReason(item);
    if (bad) {
      const label = item?.title ? `"${item.title}"` : item?.listingId || 'item';
      throw new Error(`aggregateParcel: ${label} no cotizable (${bad})`);
    }
    const qty = Number(item.quantity) || 1;
    maxLen = Math.max(maxLen, Number(item.dimensionLengthCm));
    maxWid = Math.max(maxWid, Number(item.dimensionWidthCm));
    sumHei += Number(item.dimensionHeightCm) * qty;
    sumWeightGrams += Number(item.weightGrams) * qty;
  }

  return {
    length: Math.max(maxLen, FALLBACK_DIM_CM),
    width: Math.max(maxWid, FALLBACK_DIM_CM),
    height: Math.max(sumHei, FALLBACK_DIM_CM),
    weight: Math.max(sumWeightGrams / 1000, FALLBACK_WEIGHT_KG),
  };
};

// Extrae los campos de shipping de un publicData de listing en el shape
// que aggregateParcel espera. Devuelve null si el listing no es
// cotizable (falta peso o dimensiones).
const parcelDataFromListing = (listing, quantity = 1) => {
  const pd = listing?.attributes?.publicData || {};
  return {
    listingId: listing?.id?.uuid,
    title: listing?.attributes?.title,
    weightGrams: pd.weightGrams,
    dimensionLengthCm: pd.dimensionLengthCm,
    dimensionWidthCm: pd.dimensionWidthCm,
    dimensionHeightCm: pd.dimensionHeightCm,
    quantity,
  };
};

module.exports = {
  aggregateParcel,
  parcelDataFromListing,
};
