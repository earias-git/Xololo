// XOLOLO Fase 2 — endpoint de búsqueda. Reemplaza al viejo /api/smart-search.
//
// Flujo:
//   1. Query simple (1-2 palabras): Algolia directo.
//   2. Query compleja (3+ palabras o frases con contexto): Haiku interpreta
//      → convierte intent en keywords/categorías/listingTypes → Algolia con
//      filtros derivados.
//   3. Si Haiku falla, fallback a Algolia con la query cruda.
//
// Contrato:
//   GET /api/search?q=<query>&hitsPerPage=<N>&page=<N>&category=<slug>&listingType=<type>
//   Response: {
//     ok: true,
//     query: '...',
//     intent?: string,                 // sólo si Haiku intervino
//     interpretation?: {...},          // debugging + chips UI
//     usedAi: boolean,
//     listings: [{ id, title, slug, href, cover, price, currency,
//                  category, listingType, authorName, score,
//                  hasAiAnalysis }],
//     count: number,
//     total: number,
//     processingTimeMS: number
//   }

const { search, isConfigured: algoliaReady } = require('../api-util/algoliaClient');
const { chatJson, isConfigured: aiReady } = require('../api-util/aiClient');
const { SEARCH_QUERY_UNDERSTAND_V1 } = require('../api-util/aiPrompts');

const AVAILABLE_CATEGORIES = [
  'artesanias', 'hogar', 'moda', 'belleza', 'alimentos',
  'tecnologia', 'mascotas', 'papeleria', 'turismo', 'servicios-pro',
];
const AVAILABLE_LISTING_TYPES = ['product', 'service', 'service-day'];

const PROMPT = SEARCH_QUERY_UNDERSTAND_V1;

const toSlug = title =>
  String(title || 'listing')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const isComplexQuery = q => {
  if (!q) return false;
  const words = q.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 3) return true;
  // Heurística: palabras naturales que sugieren intención.
  const intentWords = /\b(para|con|cerca|regalo|servicio|busco|quiero|necesito)\b/i;
  return intentWords.test(q);
};

const interpretQuery = async query => {
  if (!aiReady()) return null;
  try {
    return await chatJson({
      system: PROMPT.system,
      messages: [
        {
          role: 'user',
          content: PROMPT.instruction({
            query,
            availableCategories: AVAILABLE_CATEGORIES,
            availableListingTypes: AVAILABLE_LISTING_TYPES,
          }),
        },
      ],
      expectShape: PROMPT.expectShape,
      purpose: 'search-interpret',
      maxTokens: 1500,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[search] interpret failed:', err?.message);
    return null;
  }
};

const buildHref = hit => `/l/${hit.slug || toSlug(hit.title)}/${hit.objectID}`;

const serializeHit = hit => ({
  id: hit.objectID,
  title: hit.title,
  slug: hit.slug,
  href: buildHref(hit),
  cover: hit.coverUrl || null,
  price: hit.priceSubunits != null ? hit.priceSubunits / 100 : null,
  currency: hit.currency || 'MXN',
  category: hit.category || null,
  listingType: hit.listingType || null,
  authorName: hit.authorName || null,
  autoDescription: hit.autoDescription || '',
  hasAiAnalysis: !!hit.hasAiAnalysis,
});

module.exports = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const hitsPerPage = Math.min(parseInt(req.query.hitsPerPage, 10) || 20, 48);
    const page = Math.max(parseInt(req.query.page, 10) || 0, 0);
    const categoryParam = String(req.query.category || '').trim();
    const listingTypeParam = String(req.query.listingType || '').trim();

    if (!algoliaReady()) {
      return res.status(503).json({ error: 'search_not_configured' });
    }

    // 1. ¿Interpretamos con Haiku? Sólo para queries complejas.
    let interp = null;
    if (q && isComplexQuery(q)) {
      interp = await interpretQuery(q);
    }

    // 2. Build de params Algolia.
    //    - Si Haiku interpretó: query = keywords concatenadas +
    //      optionalWords y removeWordsIfNoResults=allOptional (ver client).
    //      Esto hace que Algolia encuentre listings con AL MENOS una de
    //      las keywords, ordenados por cuántas matchean + customRanking.
    //    - Si NO interpretó: query cruda, typo tolerance nativa de Algolia.
    const algoliaQuery = interp?.keywords?.length
      ? interp.keywords.slice(0, 10).join(' ')
      : q;
    const optionalWords = interp?.keywords?.length
      ? interp.keywords.slice(0, 20)
      : undefined;

    const rawFilters = ['state:published'];

    // Categoría explícita de UI (ej. del CategoryRail) o inferida por IA.
    const effectiveCategory =
      categoryParam ||
      (interp?.categories?.length === 1 && !interp.ambiguous
        ? interp.categories[0]
        : null);
    if (effectiveCategory) {
      rawFilters.push(`category:${effectiveCategory}`);
    }

    // ListingType explícito o inferido.
    const effectiveListingType =
      listingTypeParam ||
      (interp?.listingTypes?.length === 1 &&
      interp.listingTypes[0] !== 'product' + 'service' + 'service-day'
        ? interp.listingTypes[0]
        : null);
    if (effectiveListingType) {
      rawFilters.push(`listingType:${effectiveListingType}`);
    }

    // Nunca mostramos listings bloqueados por moderación.
    rawFilters.push('NOT moderation:block');

    const result = await search({
      query: algoliaQuery,
      rawFilters,
      hitsPerPage,
      page,
      optionalWords,
    });

    return res.status(200).json({
      ok: true,
      query: q,
      intent: interp?.intent || null,
      interpretation: interp
        ? {
            keywords: interp.keywords || [],
            categories: interp.categories || [],
            listingTypes: interp.listingTypes || [],
            giftContext: !!interp.giftContext,
            ambiguous: !!interp.ambiguous,
            reasoning: interp.reasoning || '',
          }
        : null,
      usedAi: !!interp,
      filters: {
        category: effectiveCategory,
        listingType: effectiveListingType,
      },
      listings: (result.hits || []).map(serializeHit),
      count: result.hits?.length || 0,
      total: result.nbHits || 0,
      processingTimeMS: result.processingTimeMS,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[search]', err?.message);
    return res.status(500).json({ error: err?.message || 'internal' });
  }
};
