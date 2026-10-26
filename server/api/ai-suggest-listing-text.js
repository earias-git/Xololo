// XOLOLO Fase 2 — endpoint para sugerir texto (título / descripción / SEO)
// a un seller mientras edita su listing. Reusa publicData.aiAnalysis.tags
// que el pipeline de imagen ya extrajo (ningún costo extra de visión).
//
// Contract:
//   POST /api/ai/suggest-listing-text
//   Body: { listingId, currentTitle?, currentDescription? }
//   Response: { titleSuggestions: [3], descriptionSuggestions: [3], seo: {...} }
//
// Auth:
//   - Sesión Sharetribe válida (getTrustedSdk valida JWT).
//   - El user actual debe ser el author del listing — evita que un seller
//     pida sugerencias para listings ajenos (costo + espionaje).
//
// Errores:
//   400 missing_listing_id
//   401 unauthenticated
//   403 not_your_listing
//   404 listing_not_found
//   409 needs_analysis_first    — el listing no tiene aiAnalysis todavía
//                                 (frontend debe primero publicar/analizar
//                                 fotos antes de pedir texto)
//   503 ai_not_configured | integration_sdk_missing

const { getTrustedSdk } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { chatJson, isConfigured } = require('../api-util/aiClient');
const { LISTING_TEXT_SUGGEST_V1 } = require('../api-util/aiPrompts');
const { recordAiCall } = require('../api-util/aiMetrics');

const PROMPT = LISTING_TEXT_SUGGEST_V1;

module.exports = async (req, res) => {
  try {
    const { listingId, currentTitle, currentDescription } = req.body || {};
    if (!listingId || typeof listingId !== 'string') {
      return res.status(400).json({ error: 'missing_listing_id' });
    }
    if (!isConfigured()) {
      return res.status(503).json({ error: 'ai_not_configured' });
    }

    // 1. Validar sesión y obtener user actual.
    let trustedSdk;
    try {
      trustedSdk = await getTrustedSdk(req);
    } catch (_) {
      return res.status(401).json({ error: 'unauthenticated' });
    }
    const meResp = await trustedSdk.currentUser.show();
    const currentUserId = meResp?.data?.data?.id?.uuid;
    if (!currentUserId) return res.status(401).json({ error: 'unauthenticated' });

    // 2. Fetch del listing (Integration SDK — necesitamos publicData completo).
    const isdk = getIntegrationSdk();
    if (!isdk) return res.status(503).json({ error: 'integration_sdk_missing' });

    const listingResp = await isdk.listings.show({ id: listingId, include: ['author'] });
    const listing = listingResp?.data?.data;
    if (!listing) return res.status(404).json({ error: 'listing_not_found' });

    const authorId = listing.relationships?.author?.data?.id?.uuid;
    if (authorId !== currentUserId) {
      return res.status(403).json({ error: 'not_your_listing' });
    }

    const pd = listing.attributes.publicData || {};
    const aiAnalysis = pd.aiAnalysis;
    // XOLOLO (PR 4): tras el reorden del wizard, el seller llega al step
    // Text con atributos + categoría ricos pero puede no haber
    // análisis-visión de fotos aún. Antes rechazábamos (409
    // needs_analysis_first); ahora degradamos: pasamos tags=null a la IA
    // y le avisamos. La IA genera basándose en atributos + categoría +
    // sub-categoría + condición, que es contexto suficiente ML-style.
    const aiAnalysisTags = aiAnalysis?.aggregated?.tags || null;

    const category = pd.categoryLevel1 || pd.category || null;
    const subcategory = pd.subcategory || null;
    const condition = pd.condition || null;
    const listingType = pd.listingType || null;
    const attributes = pd.attributes || {};
    // XOLOLO (evento): si publicData.isEvent, el prompt genera título
    // ML-style con fecha + lugar (ver aiPrompts.js eventBlock).
    const isEvent = pd.isEvent === true;
    const event = isEvent ? pd.event || {} : null;

    // XOLOLO (PR 4): el cliente envía attributesSchema (resuelto desde
    // src/config/listingAttributes.js) en el body. No lo re-resolvemos
    // en server porque src/ es ESM y server/ es CommonJS.
    // Shape esperado: { marca: {label: 'Marca'}, talla_mx: {label: 'Talla (MX)'}, ... }
    const attributesSchema = req.body?.attributesSchema || {};

    // 3. Llamar a Claude Haiku (solo texto, barato).
    const result = await chatJson({
      system: PROMPT.system,
      messages: [
        {
          role: 'user',
          content: PROMPT.instruction({
            listingType,
            category,
            subcategory,
            condition,
            currentTitle: currentTitle || listing.attributes.title || '',
            currentDescription:
              currentDescription || listing.attributes.description || '',
            aiAnalysisTags,
            attributes,
            attributesSchema,
            isEvent,
            event,
          }),
        },
      ],
      expectShape: PROMPT.expectShape,
      purpose: 'listing-text-suggest',
      // 3 títulos + 3 descripciones + bloque SEO con keywords suele dar
      // ~2500-3500 tokens de output. 4000 deja margen cómodo.
      // XOLOLO: subido de 4000 a 6000 porque v2 del prompt agrega el
      // eventBlock + attributesBlock + reglas largas, que hace el input
      // más grande y, con 3 títulos + 3 descripciones + bloque SEO,
      // el output pasa de 3500 tokens cómodo. Antes cortaba y daba
      // ai_invalid_json porque el modelo no cerraba el JSON.
      maxTokens: 6000,
      recordMetric: usage => recordAiCall({ purpose: 'textSuggest', usage }),
    });

    return res.status(200).json({
      ok: true,
      promptVersion: PROMPT.version,
      ...result,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ai-suggest-listing-text]', err?.message);
    return res.status(500).json({ error: err?.message || 'internal' });
  }
};
