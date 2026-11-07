// XOLOLO — Helpers para SKU/variantes (Plan C: cada variante es un
// listing real en Sharetribe, agrupados por publicData.variantGroupId).
//
// Modelo de datos en publicData de cada hermano:
//   {
//     variantGroupId: 'xxx-yyy',     // UUID compartido por todos los hermanos
//     isVariantMaster: true,          // solo en uno del grupo; es el que sale en búsqueda
//     variantAxes: ['talla', 'color'],// ejes del grupo (1 o 2). Los mismos en todos los hermanos.
//     variantValues: {                // valores de ESTE hermano
//       talla: 'M',
//       color: 'azul',
//     },
//   }
//
// Convención: si publicData.variantGroupId no existe, el listing es "simple"
// (no pertenece a ningún grupo) — flujo actual sin cambios.
//
// Stock se maneja listing-por-listing con el motor nativo de Sharetribe
// (listing.currentStock.attributes.quantity). Este módulo NO toca stock,
// solo lo lee para render de disponibilidad.
//
// Límite MVP: máximo 2 ejes. Más ejes requieren rediseño del selector
// en ListingPage, no de este módulo.

export const MAX_VARIANT_AXES = 2;

/**
 * Lee el stock actual de un listing Sharetribe.
 * @param {object} listing
 * @returns {number|null} quantity o null si no está cargado
 */
export const getListingStock = listing => {
  const q = listing?.currentStock?.attributes?.quantity;
  return typeof q === 'number' ? q : null;
};

/**
 * @returns {string|null} el variantGroupId del listing, o null si no es variante.
 */
export const getVariantGroupId = listing =>
  listing?.attributes?.publicData?.variantGroupId || null;

/**
 * @returns {boolean} true si el listing es el master de su grupo.
 */
export const isVariantMaster = listing =>
  listing?.attributes?.publicData?.isVariantMaster === true;

/**
 * @returns {boolean} true si el listing pertenece a un grupo y NO es master.
 */
export const isVariantChild = listing =>
  !!getVariantGroupId(listing) && !isVariantMaster(listing);

/**
 * @returns {boolean} true si el listing pertenece a un grupo (master o child).
 */
export const isVariantListing = listing => !!getVariantGroupId(listing);

/**
 * Ejes de variación declarados por el grupo (en orden).
 * @returns {string[]} e.g. ['talla', 'color']. Vacío si no es variante.
 */
export const getVariantAxes = listing => {
  const axes = listing?.attributes?.publicData?.variantAxes;
  return Array.isArray(axes) ? axes.slice(0, MAX_VARIANT_AXES) : [];
};

/**
 * Valores del listing para cada eje. Lee publicData.variantValues.
 * @returns {object} e.g. { talla: 'M', color: 'azul' }
 */
export const getVariantValues = listing =>
  listing?.attributes?.publicData?.variantValues || {};

/**
 * Filtra una lista de listings para quedarse solo con los que pertenecen
 * al grupo dado. Útil para procesar el resultado de una query SDK por
 * pub_variantGroupId=X.
 */
export const siblingsOfGroup = (listings, variantGroupId) =>
  (listings || []).filter(l => getVariantGroupId(l) === variantGroupId);

/**
 * Busca el master dentro de un grupo. Si por bug hay más de uno, devuelve
 * el primero. Si no hay ninguno, devuelve null.
 */
export const findMaster = siblings => {
  if (!Array.isArray(siblings)) return null;
  return siblings.find(isVariantMaster) || null;
};

/**
 * Para un eje dado, devuelve los valores únicos presentes en el grupo,
 * con stock agregado y conteo de hermanos.
 *
 * Útil para pintar el selector: cada valor sabe si está "agotado"
 * (stock agregado = 0) o disponible.
 *
 * @param {object[]} siblings
 * @param {string} axis — nombre del eje (e.g. 'talla')
 * @returns {Array<{value: string, stock: number, siblingCount: number}>}
 */
export const axisValuesWithStock = (siblings, axis) => {
  if (!Array.isArray(siblings) || !axis) return [];
  const byValue = new Map();
  for (const l of siblings) {
    const v = getVariantValues(l)[axis];
    if (v == null) continue;
    const prev = byValue.get(v) || { value: v, stock: 0, siblingCount: 0 };
    const q = getListingStock(l);
    prev.stock += typeof q === 'number' ? q : 0;
    prev.siblingCount += 1;
    byValue.set(v, prev);
  }
  return Array.from(byValue.values());
};

/**
 * Encuentra el hermano cuyo variantValues coincide EXACTAMENTE con la
 * selección parcial o completa provista.
 *
 * Match: para cada clave presente en `selection`, el hermano debe tener
 * ese mismo valor. Claves ausentes en selection se ignoran.
 *
 * @param {object[]} siblings
 * @param {object} selection — e.g. { talla: 'M', color: 'azul' }
 * @returns {object|null} el hermano coincidente, o null
 */
export const findSiblingBySelection = (siblings, selection) => {
  if (!Array.isArray(siblings) || !selection) return null;
  const keys = Object.keys(selection);
  if (keys.length === 0) return null;
  return (
    siblings.find(l => {
      const values = getVariantValues(l);
      return keys.every(k => values[k] === selection[k]);
    }) || null
  );
};

/**
 * ¿Algún hermano del grupo tiene stock > 0?
 * Devuelve `false` solo si TODOS tienen stock 0 (o no cargado).
 */
export const hasAnyStock = siblings => {
  if (!Array.isArray(siblings)) return false;
  return siblings.some(l => (getListingStock(l) || 0) > 0);
};

/**
 * Construye una matriz 2D para render tipo tabla (talla × color).
 *
 * Si hay 1 eje → devuelve matriz 1D en `rows` y `cols` vacío.
 * Si hay 2 ejes → rows = valores únicos del eje[0], cols = del eje[1],
 *                 cells[rowValue][colValue] = sibling listing o null.
 *
 * @param {object[]} siblings
 * @param {string[]} axes
 * @returns {{
 *   axes: string[],
 *   rows: string[],
 *   cols: string[],
 *   cell: (rowVal: string, colVal?: string) => (object|null)
 * }}
 */
export const buildMatrix = (siblings, axes) => {
  const safeAxes = Array.isArray(axes) ? axes.slice(0, MAX_VARIANT_AXES) : [];
  const empty = { axes: safeAxes, rows: [], cols: [], cell: () => null };
  if (!Array.isArray(siblings) || siblings.length === 0 || safeAxes.length === 0) {
    return empty;
  }
  const rowAxis = safeAxes[0];
  const colAxis = safeAxes[1] || null;

  const rowsSet = new Set();
  const colsSet = new Set();
  const index = new Map(); // key = `${rowVal}||${colVal}` → sibling

  for (const l of siblings) {
    const values = getVariantValues(l);
    const rowVal = values[rowAxis];
    if (rowVal == null) continue;
    rowsSet.add(rowVal);
    const colVal = colAxis ? values[colAxis] : null;
    if (colAxis && colVal != null) colsSet.add(colVal);
    index.set(`${rowVal}||${colVal == null ? '' : colVal}`, l);
  }

  return {
    axes: safeAxes,
    rows: Array.from(rowsSet),
    cols: colAxis ? Array.from(colsSet) : [],
    cell: (rowVal, colVal) => index.get(`${rowVal}||${colVal == null ? '' : colVal}`) || null,
  };
};
