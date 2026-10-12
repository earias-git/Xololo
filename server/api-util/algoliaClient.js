// XOLOLO Fase 2 — F2-12 (motor de búsqueda).
// Cliente centralizado de Algolia para indexar y buscar listings.
//
// Env vars requeridas:
//   ALGOLIA_APP_ID         — Application ID (público, también en frontend)
//   ALGOLIA_ADMIN_API_KEY  — Write key (NUNCA se envía al browser)
//
// Para búsqueda desde el frontend, el search endpoint corre server-side con
// esta misma admin key, así ocultamos el search-only key del catálogo
// hasta que decidamos exponerlo (ej. con InstantSearch widgets).

const INDEX_NAME = process.env.ALGOLIA_INDEX_NAME || 'xololo_listings';

let cachedClient = null;
let cachedConfig = { indexName: INDEX_NAME };

const getClient = () => {
  if (cachedClient !== null) return cachedClient;
  const appId = process.env.ALGOLIA_APP_ID;
  const adminKey = process.env.ALGOLIA_ADMIN_API_KEY;
  if (!appId || !adminKey) {
    cachedClient = false;
    return null;
  }
  // eslint-disable-next-line global-require
  const { algoliasearch } = require('algoliasearch');
  cachedClient = algoliasearch(appId, adminKey);
  return cachedClient;
};

const isConfigured = () => !!getClient();

const getIndexName = () => cachedConfig.indexName;

// Reset interno para tests.
const __resetForTests = () => {
  cachedClient = null;
};

const __setClientForTests = client => {
  cachedClient = client;
};

/**
 * Indexa (o actualiza) un documento. Algolia upsertea por objectID.
 */
const saveDocument = async doc => {
  const client = getClient();
  if (!client) throw new Error('algolia_not_configured');
  if (!doc?.objectID) throw new Error('objectID_required');
  return client.saveObject({ indexName: getIndexName(), body: doc });
};

/**
 * Indexa un batch de documentos. Más eficiente para backfill.
 */
const saveDocumentsBatch = async docs => {
  const client = getClient();
  if (!client) throw new Error('algolia_not_configured');
  if (!Array.isArray(docs) || docs.length === 0) return { nbHits: 0 };
  return client.saveObjects({ indexName: getIndexName(), objects: docs });
};

/**
 * Elimina un documento por su objectID (uuid del listing).
 */
const deleteDocument = async objectID => {
  const client = getClient();
  if (!client) throw new Error('algolia_not_configured');
  if (!objectID) throw new Error('objectID_required');
  return client.deleteObject({ indexName: getIndexName(), objectID });
};

/**
 * Realiza una búsqueda server-side. Devuelve el payload crudo de Algolia
 * (hits, nbHits, processingTimeMS, facets, etc).
 *
 * @param {Object} params
 * @param {string} params.query - texto a buscar (puede ser vacío para "todo")
 * @param {Object} [params.filters] - filtros estructurados (ej. {category:'hogar'})
 * @param {Array<string>} [params.rawFilters] - filtros raw de Algolia (ej. ['moderation:safe'])
 * @param {number} [params.hitsPerPage]
 * @param {number} [params.page]
 */
const search = async ({
  query = '',
  rawFilters = [],
  hitsPerPage = 20,
  page = 0,
  facets,
  attributesToRetrieve,
} = {}) => {
  const client = getClient();
  if (!client) throw new Error('algolia_not_configured');
  const searchParams = { query, hitsPerPage, page };
  if (rawFilters.length) searchParams.filters = rawFilters.join(' AND ');
  if (facets) searchParams.facets = facets;
  if (attributesToRetrieve) searchParams.attributesToRetrieve = attributesToRetrieve;
  const result = await client.searchSingleIndex({
    indexName: getIndexName(),
    searchParams,
  });
  return result;
};

/**
 * Define/actualiza la configuración del índice. Se corre al inicializar
 * (primer backfill) y después de cada deploy que cambie los settings.
 *
 * - searchableAttributes: orden de prioridad para full-text match.
 * - attributesForFaceting: campos que se pueden usar como filtros.
 * - customRanking: desempate secundario después del tf-idf.
 */
const configureIndex = async () => {
  const client = getClient();
  if (!client) throw new Error('algolia_not_configured');
  return client.setSettings({
    indexName: getIndexName(),
    indexSettings: {
      // Orden de importancia (primero > segundo > ...).
      searchableAttributes: [
        'title',
        'description',
        'aiTags.objects',
        'aiTags.keywords',
        'aiTags.materials',
        'aiTags.colors',
        'authorName',
      ],
      attributesForFaceting: [
        'filterOnly(listingType)',
        'filterOnly(category)',
        'filterOnly(moderation)',
        'filterOnly(authorId)',
        'filterOnly(state)',
        'filterOnly(hasAiAnalysis)',
      ],
      // Después de la relevancia, prioriza listings más nuevos y con IA.
      customRanking: ['desc(hasAiAnalysis)', 'desc(createdAtTs)'],
      // Query tolerante a typos para palabras ≥4 letras.
      minWordSizefor1Typo: 4,
      minWordSizefor2Typos: 8,
      // Lenguaje para stop-words y stemming.
      queryLanguages: ['es'],
      indexLanguages: ['es'],
      // Si no se dan filtros, nunca mostrar listings cerrados o bloqueados.
      ignorePlurals: ['es'],
    },
  });
};

module.exports = {
  isConfigured,
  getIndexName,
  saveDocument,
  saveDocumentsBatch,
  deleteDocument,
  search,
  configureIndex,
  __resetForTests,
  __setClientForTests,
};
