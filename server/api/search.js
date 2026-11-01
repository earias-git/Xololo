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
const { recordAiCall } = require('../api-util/aiMetrics');
const { getSdk } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');

const AVAILABLE_CATEGORIES = [
  'artesanias',
  'hogar',
  'moda',
  'belleza',
  'alimentos',
  'tecnologia',
  'mascotas',
  'papeleria',
  'turismo',
  'servicios-pro',
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
  const words = q
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 3) return true;
  // Heurística: palabras naturales que sugieren intención.
  const intentWords = /\b(para|con|cerca|regalo|servicio|busco|quiero|necesito)\b/i;
  return intentWords.test(q);
};

// Palabras que casi todos los catálogos de ecommerce tienen en los
// títulos — si la query es una de estas, pocos hits son normales y no
// vale la pena gastar Haiku. Lista intencionalmente corta y conservadora.
const COMMON_SINGLE_WORDS = new Set([
  'planta',
  'café',
  'ropa',
  'servicio',
  'masaje',
  'pintura',
  'arte',
  'flor',
  'flores',
  'libro',
  'juguete',
  'comida',
  'bebida',
]);

/**
 * ¿La query es UNA sola palabra que no es común ni tiene match evidente?
 * Útil para activar Haiku cuando el buyer usa un sinónimo regional
 * (ej. "matera" por "maceta", "pollera" por "falda", "colectivo" por
 * "autobús") y Algolia no encontró lo esperado.
 */
const isUnusualSingleWord = q => {
  if (!q) return false;
  const trimmed = q.trim().toLowerCase();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length !== 1) return false;
  if (words[0].length < 4) return false; // "mesa", "caja" son demasiado comunes
  return !COMMON_SINGLE_WORDS.has(words[0]);
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
      recordMetric: usage => recordAiCall({ purpose: 'search', usage }),
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

// XOLOLO fix 2026-11-01: cover faltante en hits de Algolia (listings
// indexados antes de que las variants de imagen estuvieran listas).
// Enriquece con lookup directo a Sharetribe. Batched en paralelo —
// máximo MAX_ENRICH para no explotar latencia.
const MAX_ENRICH = 20;
const COVER_VARIANTS = ['listing-card-2x', 'listing-card', 'scaled-medium'];

const extractCoverFromSdkListing = (listing, included) => {
  const refs = listing?.relationships?.images?.data || [];
  if (refs.length === 0) return null;
  const img = included.find(i => i.type === 'image' && i.id?.uuid === refs[0].id?.uuid);
  const variants = img?.attributes?.variants || {};
  for (const v of COVER_VARIANTS) {
    if (variants[v]?.url) return variants[v].url;
  }
  return null;
};

const extractAuthorFromSdkListing = (listing, included) => {
  const ref = listing?.relationships?.author?.data;
  if (!ref) return null;
  const user = included.find(i => i.type === 'user' && i.id?.uuid === ref.id?.uuid);
  return user?.attributes?.profile?.displayName || null;
};

const enrichCoversFromSharetribe = async (sdk, serialized) => {
  if (!sdk) return serialized;
  const needsCover = serialized.filter(x => !x.cover).slice(0, MAX_ENRICH);
  if (needsCover.length === 0) return serialized;
  const lookups = await Promise.allSettled(
    needsCover.map(x =>
      sdk.listings
        .show({
          id: x.id,
          include: ['images'],
          'fields.image': COVER_VARIANTS.map(v => `variants.${v}`),
        })
        .catch(() => null)
    )
  );
  const coverById = new Map();
  lookups.forEach((r, i) => {
    if (r.status !== 'fulfilled' || !r.value) return;
    const data = r.value.data?.data;
    const included = r.value.data?.included || [];
    if (!data) return;
    const url = extractCoverFromSdkListing(data, included);
    if (url) coverById.set(needsCover[i].id, url);
  });
  return serialized.map(x => (x.cover || !coverById.has(x.id) ? x : { ...x, cover: coverById.get(x.id) }));
};

// XOLOLO fix 2026-11-01: Algolia a veces no indexa listings nuevos
// o moderation flag impide verlos. Si initialHits === 0 con una query
// textual directa, caemos a Sharetribe listings.query({ keywords })
// que busca en title + description nativamente.
const sharetribeKeywordFallback = async (sdk, { q, hitsPerPage, category, listingType }) => {
  if (!sdk || !q) return null;
  try {
    const params = {
      keywords: q,
      perPage: Math.min(hitsPerPage, 24),
      include: ['images', 'author'],
      'fields.listing': ['title', 'price', 'publicData', 'metadata', 'state'],
      'fields.image': COVER_VARIANTS.map(v => `variants.${v}`),
      'fields.user': ['profile.displayName'],
    };
    if (category) params.pub_categoryLevel1 = category;
    if (listingType) params.pub_listingType = listingType;
    const resp = await sdk.listings.query(params);
    const listings = (resp.data.data || []).filter(
      l => l.attributes?.state === 'published'
    );
    const included = resp.data.included || [];
    return listings.map(l => {
      const attrs = l.attributes || {};
      const pd = attrs.publicData || {};
      const price = attrs.price || null;
      return {
        id: l.id?.uuid,
        title: attrs.title || '',
        slug: pd.slug || toSlug(attrs.title),
        href: `/l/${pd.slug || toSlug(attrs.title)}/${l.id?.uuid}`,
        cover: extractCoverFromSdkListing(l, included),
        price: price?.amount != null ? price.amount / 100 : null,
        currency: price?.currency || 'MXN',
        category: pd.categoryLevel1 || pd.category || null,
        listingType: pd.listingType || pd.transactionProcessAlias || null,
        authorName: extractAuthorFromSdkListing(l, included),
        autoDescription: pd.autoDescription || '',
        hasAiAnalysis: !!(attrs.metadata?.xololoAiAnalysis || pd.aiAnalysis),
      };
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[search.fallback] sharetribe keywords search failed:', e?.message);
    return null;
  }
};

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

    // Filtros base: siempre published, nunca bloqueados por moderación.
    // Puede añadirse filtro explícito de UI (ej. CategoryRail del landing).
    const buildFilters = (category, listingType) => {
      const f = ['state:published', 'NOT moderation:block'];
      if (category) f.push(`category:${category}`);
      if (listingType) f.push(`listingType:${listingType}`);
      return f;
    };

    // SDK para enriquecer covers faltantes y fallback por keywords.
    // Usamos el SDK publico (sin auth): /api/search no requiere login.
    const sdkForEnrich = (() => {
      try {
        return getSdk(req, res);
      } catch (_e) {
        return null;
      }
    })();

    // 1. SIEMPRE intentamos Algolia primero con la query cruda. Barato
    // ($0) y rápido (5-50ms). La mayoría de queries directas se
    // resuelven aquí sin tocar Haiku.
    let result = await search({
      query: q,
      rawFilters: buildFilters(categoryParam || null, listingTypeParam || null),
      hitsPerPage,
      page,
    });

    let interp = null;
    const initialHits = result.nbHits || 0;
    const topHitHasExactMatch =
      result.hits?.[0] &&
      q &&
      (result.hits[0].title || '').toLowerCase().includes(q.trim().toLowerCase());

    // 2. Activamos Haiku si:
    //    (a) 0 hits y la query no es vacía — caso clásico, siempre.
    //    (b) <= 2 hits Y la query es compleja (frase con intención
    //        natural que Algolia no supo expandir).
    //    (c) query es palabra única "inusual" (probable regionalismo
    //        como "matera", "pollera", "colectivo") Y ningún top-hit
    //        contiene la palabra textual — sugiere que Algolia matcheó
    //        por typo-tolerance (ruido) o no matcheó bien.
    const shouldEscalate =
      q &&
      (initialHits === 0 ||
        (initialHits <= 2 && isComplexQuery(q)) ||
        (isUnusualSingleWord(q) && !topHitHasExactMatch));

    if (shouldEscalate) {
      interp = await interpretQuery(q);
      if (interp?.keywords?.length) {
        const effectiveCategory =
          categoryParam ||
          (interp.categories?.length === 1 && !interp.ambiguous ? interp.categories[0] : null);
        const effectiveListingType =
          listingTypeParam ||
          (interp.listingTypes?.length === 1 &&
          AVAILABLE_LISTING_TYPES.includes(interp.listingTypes[0])
            ? interp.listingTypes[0]
            : null);

        const expandedResult = await search({
          query: interp.keywords.slice(0, 10).join(' '),
          rawFilters: buildFilters(effectiveCategory, effectiveListingType),
          hitsPerPage,
          page,
          optionalWords: interp.keywords.slice(0, 20),
        });

        // Nos quedamos con lo expandido si viene con MÁS hits.
        // Si el intento inicial dio 0, cualquier mejora cuenta aun si
        // la IA se marcó "ambigua" — mostrar algo relevante vale más
        // que una pantalla vacía. Si ya había hits, exigimos no-ambiguous
        // para no empeorar lo que ya funcionaba.
        const expandedHits = expandedResult.nbHits || 0;
        const better = expandedHits > initialHits && (initialHits === 0 || !interp.ambiguous);
        if (better) {
          result = expandedResult;
        } else {
          interp = null;
        }
      }
    }

    const effectiveCategory =
      categoryParam ||
      (interp?.categories?.length === 1 && !interp.ambiguous ? interp.categories[0] : null);
    const effectiveListingType =
      listingTypeParam ||
      (interp?.listingTypes?.length === 1 &&
      AVAILABLE_LISTING_TYPES.includes(interp.listingTypes[0])
        ? interp.listingTypes[0]
        : null);

    // 3. Fallback a Sharetribe keywords search cuando Algolia + IA
    // dieron 0 hits. Cubre listings nuevos aún no indexados en Algolia
    // o errores del indexer que dejaron títulos fuera del índice.
    let listingsOut = (result.hits || []).map(serializeHit);
    let usedSharetribeFallback = false;
    if (listingsOut.length === 0 && q) {
      const fallback = await sharetribeKeywordFallback(sdkForEnrich, {
        q,
        hitsPerPage,
        category: effectiveCategory,
        listingType: effectiveListingType,
      });
      if (fallback && fallback.length > 0) {
        listingsOut = fallback;
        usedSharetribeFallback = true;
      }
    }

    // 4. Enriquecer covers faltantes con lookup directo (cubre listings
    // indexados antes de que sus variants de imagen quedaran listas).
    // Solo en resultados de Algolia — el fallback de Sharetribe ya trae
    // la cover resuelta.
    if (!usedSharetribeFallback && listingsOut.some(x => !x.cover)) {
      listingsOut = await enrichCoversFromSharetribe(sdkForEnrich, listingsOut);
    }

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
      usedSharetribeFallback,
      filters: {
        category: effectiveCategory,
        listingType: effectiveListingType,
      },
      listings: listingsOut,
      count: listingsOut.length,
      total: usedSharetribeFallback ? listingsOut.length : result.nbHits || 0,
      processingTimeMS: result.processingTimeMS,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[search]', err?.message);
    return res.status(500).json({ error: err?.message || 'internal' });
  }
};
