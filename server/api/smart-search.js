// XOLOLO Fase 2 — F2-12: smart search endpoint.
//
// Flujo:
//   1. Buyer escribe query natural (ej. "regalo para mi mamá", "algo
//      artesanal para la cocina", "velero en la paz").
//   2. Claude Haiku interpreta la query → filtros estructurados
//      (keywords, categories, listingTypes, giftContext, locationHints).
//   3. Server consulta Sharetribe con esos filtros (keywords=... +
//      pub_listingType + pub_categoryLevel1).
//   4. Re-rank client-side por match contra publicData.aiAnalysis.tags
//      del enrichment ya hecho (sub-commit 2).
//
// Contract:
//   GET /api/smart-search?q=<query>&perPage=<N>
//   Response: {
//     intent: string,              // qué entendió la IA
//     interpretation: {...},       // filtros aplicados (debugging)
//     listings: [{ id, title, slug, href, cover, price, matchReason }],
//     fallbackUsed: boolean        // true si Haiku falló y usamos query directo
//   }
//
// Si ANTHROPIC_API_KEY no está, hace fallback a search clásico con la
// query como keyword — nunca rompe el buscador.

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { chatJson, isConfigured } = require('../api-util/aiClient');
const { SEARCH_QUERY_UNDERSTAND_V1 } = require('../api-util/aiPrompts');

const PROMPT = SEARCH_QUERY_UNDERSTAND_V1;

// Catálogo de categorías Xololo (debe coincidir con src/config/categories.js).
// Lo hardcodeamos aquí para no acoplar el server a imports de src/.
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

const PROD_URL = () =>
  /localhost|127\.0\.0\.1/.test(process.env.REACT_APP_MARKETPLACE_ROOT_URL || '')
    ? 'http://localhost:3000'
    : 'https://xololo.mx';

/**
 * Rank score para un listing: cuenta cuántas keywords interpretadas
 * están en los aiAnalysis.tags del listing. Simple pero efectivo.
 */
const scoreListing = (listing, interpretedKeywords) => {
  if (!interpretedKeywords?.length) return 0;
  const pd = listing.attributes.publicData || {};
  const aiTags = pd.aiAnalysis?.aggregated?.tags || {};
  const bag = new Set();
  const push = arr => (arr || []).forEach(v => bag.add(String(v).toLowerCase()));
  push(aiTags.objects);
  push(aiTags.colors);
  push(aiTags.materials);
  push(aiTags.keywords);
  // También considera título + descripción textual, por si el listing
  // es muy nuevo y aún no fue analizado por IA.
  const title = (listing.attributes.title || '').toLowerCase();
  const desc = (listing.attributes.description || '').toLowerCase();
  let score = 0;
  for (const kw of interpretedKeywords) {
    const k = String(kw).toLowerCase();
    if (bag.has(k)) score += 2; // match en tags visuales pesa más
    else if (title.includes(k)) score += 1.5;
    else if (desc.includes(k)) score += 1;
  }
  return score;
};

/**
 * Interpreta la query con Claude. Fallback a keywords vacíos si falla.
 */
const interpretQuery = async query => {
  if (!isConfigured()) return null;
  try {
    const result = await chatJson({
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
      purpose: 'smart-search-interpret',
      // El prompt pide varios arrays (keywords, categories, listingTypes,
      // colorHints, locationHints). 1500 deja margen cómodo; outputs
      // típicos son ~500-900 tokens.
      maxTokens: 1500,
    });
    return result;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[smart-search] interpret failed:', err?.message);
    return null;
  }
};

const buildHrefFromListing = l => {
  const slug = (l.attributes.title || 'listing')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `/l/${slug}/${l.id.uuid}`;
};

const extractImage = (listing, included) => {
  const ref = listing.relationships?.images?.data?.[0];
  if (!ref) return null;
  const img = included.find(i => i.type === 'image' && i.id.uuid === ref.id.uuid);
  const v = img?.attributes?.variants;
  return v?.['listing-card-2x']?.url || v?.['listing-card']?.url || null;
};

module.exports = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const perPage = Math.min(parseInt(req.query.perPage, 10) || 12, 48);

    if (!q) {
      return res.status(400).json({ error: 'query_required' });
    }

    const sdk = getIntegrationSdk();
    if (!sdk) {
      return res.status(503).json({ error: 'integration_sdk_missing' });
    }

    // 1. Interpretar query con Haiku (fallback a keyword directo).
    const interp = await interpretQuery(q);
    const fallbackUsed = !interp;

    const keywords = interp?.keywords?.length ? interp.keywords : [q];
    const categories = interp?.categories || [];
    const listingTypes = interp?.listingTypes || [];

    // 2. Query a Sharetribe. keywords=X,Y,Z es full-text match (OR).
    // Si Haiku dio categorías específicas, filtramos; si no, dejamos abierto.
    const queryParams = {
      keywords: keywords.join(','),
      perPage: perPage * 2, // sobre-pedimos para re-rank
      states: ['published'],
      include: ['images', 'author'],
      'fields.listing': [
        'title',
        'description',
        'price',
        'publicData.listingType',
        'publicData.categoryLevel1',
        'publicData.aiAnalysis',
      ],
      'fields.image': ['variants.listing-card', 'variants.listing-card-2x'],
    };

    // Si Haiku detectó categorías específicas, filtramos. Si es un giftContext
    // o ambigua, dejamos sin filtro para no perder resultados.
    if (categories.length > 0 && categories.length <= 3 && !interp?.ambiguous) {
      queryParams.pub_categoryLevel1 = categories.join(',');
    }

    // Si Haiku restringió tipos (ej. solo "service" para "clases de yoga"),
    // aplicamos. Si incluye los 3 (default), no filtra nada.
    if (
      listingTypes.length > 0 &&
      listingTypes.length < AVAILABLE_LISTING_TYPES.length
    ) {
      queryParams.pub_listingType = listingTypes.join(',');
    }

    const sdkResp = await sdk.listings.query(queryParams);
    const rawListings = sdkResp.data.data || [];
    const included = sdkResp.data.included || [];

    // 3. Re-rank client-side por match contra aiAnalysis tags.
    const scored = rawListings.map(l => ({
      listing: l,
      score: scoreListing(l, keywords),
    }));
    scored.sort((a, b) => b.score - a.score);

    // 4. Serializar para el cliente.
    const listings = scored.slice(0, perPage).map(({ listing, score }) => ({
      id: listing.id.uuid,
      title: listing.attributes.title,
      href: buildHrefFromListing(listing),
      cover: extractImage(listing, included),
      price: listing.attributes.price?.amount
        ? listing.attributes.price.amount / 100
        : null,
      currency: listing.attributes.price?.currency,
      listingType: listing.attributes.publicData?.listingType,
      category: listing.attributes.publicData?.categoryLevel1,
      score,
      hasAiAnalysis: !!listing.attributes.publicData?.aiAnalysis,
    }));

    return res.status(200).json({
      ok: true,
      intent: interp?.intent || `búsqueda de "${q}"`,
      interpretation: interp
        ? {
            keywords,
            categories,
            listingTypes,
            giftContext: !!interp.giftContext,
            ambiguous: !!interp.ambiguous,
            reasoning: interp.reasoning,
          }
        : { keywords: [q], categories: [], listingTypes: [], raw: true },
      promptVersion: PROMPT.version,
      fallbackUsed,
      count: listings.length,
      listings,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[smart-search]', err?.message);
    return res.status(500).json({ error: err?.message || 'internal' });
  }
};
