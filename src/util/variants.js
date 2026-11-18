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
 * Genera un UUID v4 para usar como variantGroupId.
 * Usa crypto.randomUUID donde esté disponible (navegador moderno + Node 18+),
 * con fallback a Math.random (OK para un identificador de agrupación no-seguro).
 * @returns {string}
 */
export const generateVariantGroupId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback RFC4122-ish, no cripto-seguro — suficiente para agrupar.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

/**
 * Serializa variantValues en una etiqueta legible para títulos y sufijos.
 * Orden determinado por `axes`; omite valores vacíos.
 *
 * @example
 *   variantLabel({ talla: 'M', color: 'azul' }, ['talla', 'color'])
 *   => 'M · azul'
 *
 * @param {object} variantValues
 * @param {string[]} axes
 * @returns {string}
 */
export const variantLabel = (variantValues = {}, axes = []) => {
  return axes
    .map(a => variantValues[a])
    .filter(v => v != null && v !== '')
    .join(' · ');
};

/**
 * Construye el payload para crear un sibling listing a partir del master.
 *
 * Clona lo esencial del master (price, geolocation, publicData con
 * excepciones, images refs) y aplica el override de variante. El stock
 * se maneja aparte (sdk.stock.compareAndSet), NO va en este payload.
 *
 * Campos NO clonados desde el master:
 *   - publicData.variantsMatrix (solo el master la tiene — es staging)
 *   - publicData.isVariantMaster (false en el sibling)
 *
 * Campos sobrescritos:
 *   - title: `${masterTitle} · ${variantLabel}` (p.ej. "Playera X · M · azul")
 *   - publicData.variantGroupId: el mismo del master
 *   - publicData.variantAxes: el mismo del master
 *   - publicData.variantValues: el de este sibling
 *   - price: priceOverride si viene; si no, el del master
 *
 * @param {object} master — listing fuente (shape de Sharetribe SDK)
 * @param {object} opts
 * @param {object} opts.variantValues — e.g. { talla: 'M', color: 'azul' }
 * @param {object|null} [opts.priceOverride] — Money object; si null, hereda del master
 * @returns {object} payload apto para sdk.ownListings.createDraft({ ... })
 */
export const buildSiblingPayload = (master, { variantValues, priceOverride = null } = {}) => {
  if (!master || !master.attributes) {
    throw new Error('buildSiblingPayload: master listing is required');
  }
  const mAttrs = master.attributes;
  const mPublicData = mAttrs.publicData || {};

  const variantGroupId = mPublicData.variantGroupId;
  const axes = Array.isArray(mPublicData.variantAxes) ? mPublicData.variantAxes : [];
  if (!variantGroupId) {
    throw new Error('buildSiblingPayload: master must have publicData.variantGroupId');
  }
  if (axes.length === 0) {
    throw new Error('buildSiblingPayload: master must have publicData.variantAxes');
  }

  // Excluye claves específicas del master y staging de la matriz.
  const {
    variantsMatrix,
    isVariantMaster,
    variantValues: _mvv,
    ...publicDataClone
  } = mPublicData;

  const siblingPublicData = {
    ...publicDataClone,
    variantGroupId,
    isVariantMaster: false,
    variantAxes: axes,
    variantValues,
  };

  const suffix = variantLabel(variantValues, axes);
  const title = suffix ? `${mAttrs.title || ''} · ${suffix}`.trim() : mAttrs.title;

  const payload = {
    title,
    description: mAttrs.description || '',
    price: priceOverride || mAttrs.price,
    publicData: siblingPublicData,
  };

  // Clona geolocation si existe (listings con ubicación física).
  if (mAttrs.geolocation) {
    payload.geolocation = mAttrs.geolocation;
  }

  // Images: Sharetribe acepta array de UUIDs en createDraft.
  // El caller resuelve los UUIDs desde master.relationships.images si
  // los quiere compartir (recomendado para variantes).
  return payload;
};

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
 * XOLOLO 2026-11-14 — reparar regresión del selector de variantes.
 *
 * Problema: axisValuesWithStock sólo pinta valores que aparecen en los
 * siblings cargados. Si el master define una matrix de talla × color
 * en el wizard pero los siblings físicos aún no se crearon, el selector
 * mostraba un único pill (el valor del master) y se veía "sin variantes".
 *
 * Esta versión combina dos fuentes:
 *   1. `master.publicData.variantsMatrix` (definición completa de
 *      combinaciones) → catálogo autoritativo de valores por eje.
 *   2. siblings cargados → stock por valor y siblingCount.
 *
 * Si una matrix tiene un valor que no tiene sibling (p.ej. talla 30
 * definida pero sin listing creado), queda con stock=0 y siblingCount=0.
 * El selector lo pinta disabled, pero al menos el buyer lo VE.
 *
 * Si el master NO tiene matrix, cae al comportamiento viejo: deriva
 * valores sólo de siblings.
 *
 * @param {object} master — listing master con publicData.variantsMatrix
 * @param {object[]} siblings — listings del grupo (incluye master)
 * @param {string} axis — nombre del eje
 * @returns {Array<{value, stock, siblingCount}>}
 */
/**
 * XOLOLO 2026-11-17 — blindaje post-bug: filtro puro, aislado, testeado
 * para el query de siblings dentro de replicateMasterSharedFieldsThunk.
 *
 * Bug original (commit 0b100d554): el thunk hacía
 *   sdk.ownListings.query({ pub_variantGroupId: groupId })
 * y filtraba solo `l.id !== master.id`. Como Sharetribe ignora
 * pub_variantGroupId (el campo NO está registrado en el search schema
 * de Console), la query devolvía TODOS los listings del seller y el
 * patch de replicación pisaba listings fuera del grupo. 8 anuncios
 * del seller kikeagri quedaron con el título del master "Oxford
 * bostoniano...".
 *
 * Este helper garantiza, con tests de regresión, que un sibling solo
 * cuenta cuando su publicData.variantGroupId coincide EXACTAMENTE con
 * el grupo del master. Si alguien reintroduce el bug quitando la
 * condición, los tests revientan.
 *
 * @param {object[]} allListings — resultado raw de la query (puede
 *   contener listings ajenos al grupo).
 * @param {object} masterListingId — UUID instance o string del master.
 * @param {string} groupId — publicData.variantGroupId del master.
 * @returns {object[]} siblings del grupo, excluyendo al master.
 */
export const selectSiblingsForReplicate = (allListings, masterListingId, groupId) => {
  if (!Array.isArray(allListings) || !masterListingId || !groupId) return [];
  const masterIdUuid = masterListingId?.uuid || masterListingId;
  return allListings.filter(l => {
    const sibId = l?.id?.uuid;
    if (!sibId || sibId === masterIdUuid) return false;
    return l?.attributes?.publicData?.variantGroupId === groupId;
  });
};

export const axisValuesFromMatrixAndSiblings = (master, siblings, axis) => {
  const byValue = new Map();
  // 1) Catálogo autoritativo desde la matrix del master.
  const matrix = master?.attributes?.publicData?.variantsMatrix;
  if (Array.isArray(matrix)) {
    for (const row of matrix) {
      const v = row?.variantValues?.[axis];
      if (v == null) continue;
      if (!byValue.has(v)) {
        byValue.set(v, { value: v, stock: 0, siblingCount: 0 });
      }
    }
  }
  // 2) Acumular stock + siblingCount desde siblings cargados.
  if (Array.isArray(siblings)) {
    for (const l of siblings) {
      const v = getVariantValues(l)[axis];
      if (v == null) continue;
      if (!byValue.has(v)) {
        byValue.set(v, { value: v, stock: 0, siblingCount: 0 });
      }
      const entry = byValue.get(v);
      const q = getListingStock(l);
      entry.stock += typeof q === 'number' ? q : 0;
      entry.siblingCount += 1;
    }
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
 * ¿Debe aparecer este listing en search, landing y listados agregados?
 *
 * Reglas:
 *   - Listing simple (sin variantGroupId): SÍ.
 *   - Master del grupo (isVariantMaster=true): SÍ — representa al grupo.
 *   - Child del grupo: NO — está "oculto" dentro de la selección del master.
 *
 * Mantener SIEMPRE consistente entre backend (Algolia filter) y frontend
 * (fallback por si Algolia no reindexó aún).
 */
export const isSearchable = listing => {
  if (!listing) return false;
  const groupId = getVariantGroupId(listing);
  if (!groupId) return true;
  return isVariantMaster(listing);
};

/**
 * Filtra un array de listings dejando solo los searchables (ver isSearchable).
 */
export const filterSearchable = listings => {
  if (!Array.isArray(listings)) return [];
  return listings.filter(isSearchable);
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

// ============================================================================
// XOLOLO LOCKED — ADR-003: Foto por color en variantes de Moda
// ============================================================================
//
// Helpers puros para el feature "foto por color". Reglas duras (ver
// docs/decisions/ADR-003-variant-color-images.md y AGENTS.md → LOCKED):
//
//   1. `variantValueImages` se escribe SOLO en el master, nunca en siblings.
//   2. ListingPage del sibling hace lectura pull vía
//      `getColorImageIdForValue(master, value)`.
//   3. Este módulo NO toca `replicateMasterSharedFieldsThunk` ni los
//      `publicData` de los siblings.
//
// Shape del dato en master.publicData:
//   variantValueImages: { color: { "<slug>": "<sharetribe-image-id>" } }
//
// Modificar cualquier cosa aquí requiere actualizar el ADR y justificar.

const COLOR_AXIS = 'color';
const FASHION_CATEGORY = 'moda';

/**
 * Normaliza un valor de eje para usarlo como key en el mapa
 * variantValueImages. Minúsculas sin acentos, espacios → guion.
 * "Blanco Roto" → "blanco-roto". "Rojo vino" → "rojo-vino".
 */
export const slugifyAxisValue = value => {
  if (value == null) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

/**
 * True si el listing pertenece a la categoría Moda (cualquier
 * subcategoría). Gate principal del feature "foto por color".
 */
export const isFashionCategory = listing => {
  const cat = listing?.attributes?.publicData?.categoryLevel1;
  return cat === FASHION_CATEGORY;
};

/**
 * Valores del eje `color` definidos en el master. Devuelve array
 * vacío si el master no tiene eje color o publicData malformado.
 * Lee de publicData.variantsMatrix (fuente de verdad del wizard).
 */
export const getColorAxisValues = master => {
  const matrix = master?.attributes?.publicData?.variantsMatrix;
  if (!Array.isArray(matrix)) return [];
  const set = new Set();
  for (const row of matrix) {
    const v = row?.variantValues?.[COLOR_AXIS];
    if (v != null && v !== '') set.add(String(v));
  }
  return Array.from(set);
};

/**
 * Lookup del imageId del color en el master. Acepta tanto el valor
 * crudo del eje ("Rojo") como un slug ya normalizado ("rojo") —
 * siempre compara por slug.
 *
 * Retorna el imageId (string) o null. Nunca throwea.
 */
export const getColorImageIdForValue = (master, value) => {
  const map = master?.attributes?.publicData?.variantValueImages?.[COLOR_AXIS];
  if (!map || typeof map !== 'object') return null;
  const slug = slugifyAxisValue(value);
  if (!slug) return null;
  const id = map[slug];
  return typeof id === 'string' && id.length > 0 ? id : null;
};

/**
 * Actualización inmutable del mapa de fotos por color.
 * Retorna un NUEVO publicData (no muta el input).
 *
 * Si imageId es null/'', borra la entrada del mapa para ese valor.
 * Si value normaliza a '', retorna el publicData sin cambios.
 */
export const setColorImageId = (publicData, value, imageId) => {
  const slug = slugifyAxisValue(value);
  if (!slug) return publicData || {};
  const pd = publicData || {};
  const prev = pd.variantValueImages || {};
  const prevColor = prev[COLOR_AXIS] || {};
  const nextColor = { ...prevColor };
  if (imageId == null || imageId === '') {
    delete nextColor[slug];
  } else {
    nextColor[slug] = String(imageId);
  }
  // Si el mapa de color queda vacío, lo removemos para no dejar
  // ruido en publicData.
  const colorKeys = Object.keys(nextColor);
  const nextMap = { ...prev };
  if (colorKeys.length === 0) {
    delete nextMap[COLOR_AXIS];
  } else {
    nextMap[COLOR_AXIS] = nextColor;
  }
  // Si TODO variantValueImages queda vacío, lo removemos también.
  const mapKeys = Object.keys(nextMap);
  const next = { ...pd };
  if (mapKeys.length === 0) {
    delete next.variantValueImages;
  } else {
    next.variantValueImages = nextMap;
  }
  return next;
};

/**
 * Purga entradas del mapa de colores cuyo valor ya no está en el
 * eje color actual del master. Se llama al guardar el panel de
 * variantes para que un seller que quitó "amarillo" del eje no
 * deje la foto huérfana en publicData.
 *
 * currentColorValues es un array de valores crudos (ej. del
 * variantsMatrix o del state del wizard). Internamente se
 * normaliza a slugs para comparar.
 *
 * Retorna un NUEVO publicData (inmutable). Si no hay nada que
 * purgar, retorna la misma referencia del input para no forzar
 * re-renders innecesarios.
 */
export const pruneDanglingColorImages = (publicData, currentColorValues) => {
  const pd = publicData || {};
  const map = pd.variantValueImages?.[COLOR_AXIS];
  if (!map || typeof map !== 'object') return pd;
  const validSlugs = new Set(
    (Array.isArray(currentColorValues) ? currentColorValues : [])
      .map(slugifyAxisValue)
      .filter(Boolean)
  );
  const dangling = Object.keys(map).filter(slug => !validSlugs.has(slug));
  if (dangling.length === 0) return pd;
  // Reutilizamos setColorImageId para consistencia del shape.
  let next = pd;
  for (const slug of dangling) {
    next = setColorImageId(next, slug, null);
  }
  return next;
};
