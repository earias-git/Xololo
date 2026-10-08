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
    if (!aiAnalysis?.aggregated?.tags) {
      // El listing todavía no fue analizado. El frontend puede decidir si
      // dispara el análisis primero (POST /api/ai/analyze-listing) y
      // reintenta, o si pide al seller que suba fotos primero.
      return res.status(409).json({ error: 'needs_analysis_first' });
    }

    const category = pd.categoryLevel1 || pd.category || null;
    const listingType = pd.listingType || null;

    // 3. Llamar a Claude Haiku (solo texto, barato).
    const result = await chatJson({
      system: PROMPT.system,
      messages: [
        {
          role: 'user',
          content: PROMPT.instruction({
            listingType,
            category,
            currentTitle: currentTitle || listing.attributes.title || '',
            currentDescription:
              currentDescription || listing.attributes.description || '',
            aiAnalysisTags: aiAnalysis.aggregated.tags,
          }),
        },
      ],
      expectShape: PROMPT.expectShape,
      purpose: 'listing-text-suggest',
      // 3 títulos + 3 descripciones + bloque SEO con keywords suele dar
      // ~2500-3500 tokens de output. 4000 deja margen cómodo.
      maxTokens: 4000,
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
