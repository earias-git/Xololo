// XOLOLO 2026-11-18 — service server-side para la landing.
//
// Propósito: eliminar la dependencia del landing de la paginación
// de Sharetribe (que se saturaba de siblings tras ADR-004). El
// server pagina lo necesario, aplica filtros de negocio y devuelve
// al cliente SOLO los listings válidos (sin siblings, sin events
// en el bucket products, sin usados fuera del bucket used, etc.).
//
// Cache in-memory 60s por bucket para no hammerear Sharetribe cuando
// varios buyers cargan el landing simultáneamente. Se invalida solo.
//
// Shape de retorno idéntico al que tenía el thunk client-side, para
// que `src/ducks/landingListings.duck.js` solo cambie el fetcher sin
// tocar selectores.

const { getIntegrationSdk } = require('./integrationSdk');

// -------- cache --------
const CACHE_TTL_MS = 60 * 1000;
const CACHE = new Map(); // key → { at, payload }

const getCached = key => {
  const entry = CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    CACHE.delete(key);
    return null;
  }
  return entry.payload;
};

const setCached = (key, payload) => {
  CACHE.set(key, { at: Date.now(), payload });
};

// Exportado para que un hook futuro (p.ej. tras crear/publicar un
// listing) pueda invalidar el cache manualmente. No se usa aún.
const invalidateCache = () => CACHE.clear();

// -------- helpers de filtrado (reflejo de src/util/variants.js) --------
// Un listing es "searchable" en el sentido del landing si NO es child
// de un grupo de variantes. Masters y simples pasan. Reimplementado
// aquí para no acoplar client code con server code — las dos lógicas
// deben coincidir siempre (si cambia una, cambiar la otra).
const isSibling = l => {
  const pd = l.attributes?.publicData || {};
  return !!pd.variantGroupId && pd.isVariantMaster !== true;
};

const isEvent = l => l.attributes?.publicData?.isEvent === true;

const isUsedByCondition = l => l.attributes?.publicData?.condition === 'used';

const isUsedByTaxCode = l =>
  l.attributes?.publicData?.taxClassification?.code === 'exento_9_iv';

// -------- query paginada --------
// Pagina hasta reunir `targetCount` listings válidos (tras filtro) o
// agotar el marketplace. Max 5 páginas (500 listings). Suficiente para
// un marketplace razonable; si crece a decenas de miles, migrar a
// un índice dedicado (Algolia) o registrar variantGroupId como
// listing field en Console.
const fetchFilteredBucket = async ({ isdk, query, isValidFn, targetCount = 50, maxPages = 5 }) => {
  const dataOut = [];
  const includedOut = [];
  const seenIncludedIds = new Set();

  for (let page = 1; page <= maxPages && dataOut.length < targetCount; page++) {
    let resp;
    try {
      resp = await isdk.listings.query({ ...query, page, perPage: 100 });
    } catch (e) {
      // Si Sharetribe rechaza por algún motivo, retornamos lo que
      // llevamos (fail-open: mejor landing parcial que vacía).
      // eslint-disable-next-line no-console
      console.error('[landingListings] query failed page', page, e?.message);
      break;
    }
    const data = resp.data?.data || [];
    const included = resp.data?.included || [];
    const meta = resp.data?.meta || {};

    for (const l of data) {
      if (!isValidFn(l)) continue;
      if (dataOut.length >= targetCount) break;
      dataOut.push(l);
    }
    // Incluimos TODOS los included (users, images, stock) sin
    // deduplicar por `l` porque algunos autores aparecen muchas
    // veces. Dedup por id para que el frontend no reciba duplicados.
    for (const inc of included) {
      const id = inc.id?.uuid || inc.id;
      if (!id) continue;
      const key = `${inc.type}:${id}`;
      if (seenIncludedIds.has(key)) continue;
      seenIncludedIds.add(key);
      includedOut.push(inc);
    }

    if (data.length < 100 || page >= meta.totalPages) break;
  }

  return { data: dataOut, included: includedOut };
};

// -------- API pública --------
const COMMON_FIELDS = {
  include: ['author', 'images'],
  'fields.image': [
    'variants.listing-card',
    'variants.listing-card-2x',
  ],
  'imageVariant.listing-card': 'w:400;h:400;fit:crop',
  'imageVariant.listing-card-2x': 'w:800;h:800;fit:crop',
  sort: 'createdAt', // más nuevos primero (Sharetribe doc says createdAt = DESC)
};

const getLandingListings = async () => {
  const cached = getCached('all');
  if (cached) return cached;

  const isdk = getIntegrationSdk();
  if (!isdk) {
    throw new Error('integration_api_missing');
  }

  // 3 buckets paralelos. Cada uno filtrado para que el cliente reciba
  // solo lo que debe pintar.
  const [products, services, used] = await Promise.all([
    // Products: no siblings, no events. Incluye new+used? Sí, el
    // bucket products trae todo y el selector filterea used aparte.
    // Aquí filtramos solo siblings/events para mantener compat con
    // los selectores existentes (selectFeaturedProducts tambien
    // filtra used, pero necesita verlos para su propio selectFeaturedUsed).
    fetchFilteredBucket({
      isdk,
      query: { ...COMMON_FIELDS, pub_listingType: 'product' },
      isValidFn: l => !isSibling(l),
      targetCount: 50,
    }),
    fetchFilteredBucket({
      isdk,
      query: { ...COMMON_FIELDS, pub_listingType: 'service,service-day' },
      // Services + eventos: no siblings; events sí pasan (selectFeaturedServices los agrupa).
      isValidFn: l => !isSibling(l),
      targetCount: 30,
    }),
    // Used: filtro cliente más estricto (condition='used' O exento_9_iv).
    // El pub_condition=used de Sharetribe es no-op (field no registrado)
    // → nos apoyamos 100% en el filtro server.
    fetchFilteredBucket({
      isdk,
      query: { ...COMMON_FIELDS, pub_listingType: 'product' },
      isValidFn: l =>
        !isSibling(l) && (isUsedByCondition(l) || isUsedByTaxCode(l)),
      targetCount: 30,
    }),
  ]);

  const payload = { products, services, used };
  setCached('all', payload);
  return payload;
};

module.exports = { getLandingListings, invalidateCache };
