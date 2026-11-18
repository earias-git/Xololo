// XOLOLO LOCKED — ADR-005: Hidratación del landing vía endpoint
// server-side. Ver docs/decisions/ADR-005-landing-hydration.md.
//
// Reglas duras (no cambiar sin ADR update):
//   1. Las 3 señales de "usado" (condition, taxCode, casual_reseller)
//      viven aquí en isUsedListing() y deben coincidir con las de
//      SearchPage.duck.js (filtro condition=used del /s).
//   2. Shape de retorno {products, services, used} con data+included
//      es contrato — los selectores del cliente lo asumen.
//   3. El predicado isValidFn recibe (listing, authorsById) para que
//      pueda filtrar por señales que dependen del author.
//   4. Endpoint es PÚBLICO sin auth; NO exponer expand=true ni
//      datos sensibles.
//
// Smoke tests obligatorios: server/smoke/landingListings.smoke.test.js

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

// XOLOLO: un listing es "usado" por 3 señales (OR), coincidentes
// con las de src/ducks/landingListings.duck.js#isUsedListing:
//   a) publicData.condition === 'used'
//   b) publicData.taxClassification.code === 'exento_9_iv'
//   c) author.profile.publicData.sellerMode === 'casual_reseller'
// La señal (c) necesita el author (viene en included cuando la
// query incluye `author`). Si no llegó el author, cae en (a)+(b)
// (fallback defensivo).
const isUsedListing = (l, authorsById) => {
  const pd = l.attributes?.publicData || {};
  if (pd.condition === 'used') return true;
  if (pd.taxClassification?.code === 'exento_9_iv') return true;
  if (authorsById) {
    const authorId = l.relationships?.author?.data?.id?.uuid;
    const author = authorId ? authorsById.get(authorId) : null;
    const sellerMode = author?.attributes?.profile?.publicData?.sellerMode;
    if (sellerMode === 'casual_reseller') return true;
  }
  return false;
};

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
  // Mapa autor por id, se va alimentando con cada página. Lo
  // pasamos al predicado para que pueda consultar
  // `author.profile.publicData.sellerMode` (señal (c) de usado).
  const authorsById = new Map();

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

    // Alimenta el índice de autores ANTES del filter para que
    // isValidFn tenga disponible profile.publicData.sellerMode.
    for (const inc of included) {
      if (inc.type === 'user') {
        const uid = inc.id?.uuid || inc.id;
        if (uid) authorsById.set(uid, inc);
      }
    }

    for (const l of data) {
      if (!isValidFn(l, authorsById)) continue;
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
  // XOLOLO: pedir sellerMode del author para la señal (c) de usado.
  // Si no se pide, el casual_reseller no se detecta y sus listings
  // sin condition='used' quedan fuera del bucket used.
  'fields.user': [
    'profile.displayName',
    'profile.abbreviatedName',
    'profile.publicData.sellerMode',
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

  // 3 buckets paralelos. Cada predicado recibe (listing, authorsById)
  // para que pueda consultar `author.profile.publicData.sellerMode`
  // si lo necesita (señal (c) de usado).
  const [products, services, used] = await Promise.all([
    // Products: no siblings, no events. El selector del cliente
    // (selectFeaturedProducts) seguirá filtrando los usados para
    // su propio riel; aquí solo quitamos siblings y events (los
    // events van al bucket services).
    fetchFilteredBucket({
      isdk,
      query: { ...COMMON_FIELDS, pub_listingType: 'product' },
      isValidFn: l => !isSibling(l) && !isEvent(l),
      targetCount: 50,
    }),
    fetchFilteredBucket({
      isdk,
      query: { ...COMMON_FIELDS, pub_listingType: 'service,service-day' },
      // Services + eventos: no siblings; events sí pasan (selectFeaturedServices los agrupa).
      isValidFn: l => !isSibling(l),
      targetCount: 30,
    }),
    // Used: 3 señales (condition, taxCode, casual_reseller). Mismas
    // que el landing original aplicaba client-side.
    fetchFilteredBucket({
      isdk,
      query: { ...COMMON_FIELDS, pub_listingType: 'product' },
      isValidFn: (l, authorsById) => !isSibling(l) && isUsedListing(l, authorsById),
      targetCount: 30,
    }),
  ]);

  const payload = { products, services, used };
  setCached('all', payload);
  return payload;
};

module.exports = { getLandingListings, invalidateCache };
