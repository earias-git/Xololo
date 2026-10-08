// XOLOLO Fase 2 — F2-12/F2-11: motor de análisis IA para listings.
//
// Lo que hace:
//   1. Dado un listingId, trae el listing (Integration SDK) con sus imágenes.
//   2. Para cada imagen NO analizada aún (cache por imageId en el listing),
//      llama a Claude Haiku Vision con el prompt IMAGE_ANALYSIS_V1.
//   3. Agrega los resultados por imagen en una vista "aggregated":
//      - tags unificados (union de objetos/colores/materiales/keywords)
//      - moderation agregada (peor caso: cualquier block → block del listing)
//      - autoDescription de la primera foto
//   4. Guarda en publicData.aiAnalysis vía Integration SDK (merge shallow,
//      no reemplaza publicData existente).
//   5. Aplica política de moderación:
//      - block → cerrar listing (closeListing) + registrar en flag queue
//      - warn → solo registrar en flag queue (listing sigue publicado)
//      - safe → nada
//
// Política decidida (2026-10-08):
//   - Timing: moderación sync al upload es ideal pero requiere cambiar el
//     flujo de upload. En MVP, analizamos post-publish/post-update
//     (sub-commit 2) y, cuando ya tengamos uploads interceptados en una
//     fase posterior, podemos mover a sync.
//   - block → acción automática (cerrar listing + notificar en /ops).
//   - warn → publica, flagea para operador revisar.
//
// Shape de publicData.aiAnalysis:
//   {
//     version: "image_analysis_v1",   // prompt version usada
//     analyzedAt: "2026-10-08T...",   // última corrida
//     aggregated: {
//       tags: { objects: [...], colors: [...], materials: [...],
//               style, setting, quality, keywords: [...] },
//       moderation: {
//         status: "safe" | "warn" | "block",
//         blockReasons: [...],
//         warnReasons: [...],
//         flaggedImages: [{imageId, status, reasons, notes}]
//       },
//       autoDescription: "...",
//     },
//     perImage: {
//       "<imageUuid>": { analyzedAt, tags, moderation, autoDescription, notes }
//     }
//   }

const { chatJson, vision, isConfigured } = require('./aiClient');
const { IMAGE_ANALYSIS_V1 } = require('./aiPrompts');
const { getIntegrationSdk } = require('./integrationSdk');

const PROMPT = IMAGE_ANALYSIS_V1;

// ============================================================
// Core: analiza UNA imagen
// ============================================================

/**
 * Analiza una imagen con Claude Haiku Vision.
 *
 * @param {Object} params
 * @param {string} params.imageUrl - URL pública de la imagen (R2/Sharetribe).
 * @param {string} [params.listingTitle]
 * @param {string} [params.listingType]
 * @param {string} [params.category]
 * @returns {Promise<Object>} shape IMAGE_ANALYSIS_V1 (tags, moderation, autoDescription, notes)
 */
const analyzeImage = async ({ imageUrl, listingTitle, listingType, category }) => {
  if (!imageUrl) throw new Error('image_url_required');
  const result = await vision({
    system: PROMPT.system,
    imageUrl,
    instruction: PROMPT.instruction({ listingTitle, listingType, category }),
    expectShape: PROMPT.expectShape,
    purpose: 'image-analysis',
    maxTokens: 1500,
  });
  // Normaliza campos opcionales ausentes del output del modelo.
  return {
    tags: result.tags || {},
    moderation: {
      status: result.moderation?.status || 'safe',
      reasons: Array.isArray(result.moderation?.reasons) ? result.moderation.reasons : [],
      confidence: typeof result.moderation?.confidence === 'number'
        ? result.moderation.confidence
        : 0,
      notes: result.moderation?.notes || '',
    },
    autoDescription: result.autoDescription || '',
    notes: result.notes || '',
  };
};

// ============================================================
// Aggregator: combina análisis de N imágenes en 1 vista del listing
// ============================================================

const dedupLower = arr => {
  const seen = new Set();
  const out = [];
  for (const v of arr || []) {
    const s = String(v || '').trim().toLowerCase();
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
};

/**
 * Agrega los análisis por imagen en una vista unificada del listing.
 * Reglas:
 *  - tags: union set de objects/colors/materials/keywords.
 *    style y setting y quality se toman del primer análisis (seña dominante).
 *  - moderation: peor caso. Si cualquier imagen es block → listing es block.
 *    Si no hay block pero hay warn → warn. Si todas safe → safe.
 *  - autoDescription: la del primer análisis (la "foto hero").
 *  - flaggedImages: lista de las imágenes con warn/block.
 */
const aggregatePerImage = perImage => {
  const entries = Object.entries(perImage || {});
  if (entries.length === 0) {
    return {
      tags: {},
      moderation: { status: 'safe', blockReasons: [], warnReasons: [], flaggedImages: [] },
      autoDescription: '',
    };
  }

  const allObjects = [];
  const allColors = [];
  const allMaterials = [];
  const allKeywords = [];
  const flaggedImages = [];
  const blockReasons = [];
  const warnReasons = [];
  let hasBlock = false;
  let hasWarn = false;

  for (const [imageId, data] of entries) {
    const t = data.tags || {};
    if (Array.isArray(t.objects)) allObjects.push(...t.objects);
    if (Array.isArray(t.colors)) allColors.push(...t.colors);
    if (Array.isArray(t.materials)) allMaterials.push(...t.materials);
    if (Array.isArray(t.keywords)) allKeywords.push(...t.keywords);

    const mod = data.moderation || {};
    if (mod.status === 'block') {
      hasBlock = true;
      blockReasons.push(...(mod.reasons || []));
      flaggedImages.push({
        imageId,
        status: 'block',
        reasons: mod.reasons || [],
        notes: mod.notes || '',
      });
    } else if (mod.status === 'warn') {
      hasWarn = true;
      warnReasons.push(...(mod.reasons || []));
      flaggedImages.push({
        imageId,
        status: 'warn',
        reasons: mod.reasons || [],
        notes: mod.notes || '',
      });
    }
  }

  const first = entries[0][1];
  return {
    tags: {
      objects: dedupLower(allObjects),
      colors: dedupLower(allColors),
      materials: dedupLower(allMaterials),
      keywords: dedupLower(allKeywords),
      style: first.tags?.style || 'desconocido',
      setting: first.tags?.setting || '',
      quality: first.tags?.quality || '',
    },
    moderation: {
      status: hasBlock ? 'block' : hasWarn ? 'warn' : 'safe',
      blockReasons: dedupLower(blockReasons),
      warnReasons: dedupLower(warnReasons),
      flaggedImages,
    },
    autoDescription: first.autoDescription || '',
  };
};

// ============================================================
// Listing-level orchestrator
// ============================================================

/**
 * Decide qué imágenes del listing hay que (re)analizar.
 * Reglas:
 *  - Imagen nueva (no está en existingPerImage) → analizar.
 *  - Si force=true, re-analizar todas.
 */
const pickImagesToAnalyze = ({ listingImages, existingPerImage, force }) => {
  if (force) return listingImages;
  const already = new Set(Object.keys(existingPerImage || {}));
  return listingImages.filter(img => !already.has(img.id.uuid));
};

const extractImageUrl = image => {
  const variants = image?.attributes?.variants;
  if (!variants) return null;
  // Preferimos la variant más grande disponible para que Haiku vea bien.
  return (
    variants['scaled-large']?.url ||
    variants['scaled-medium']?.url ||
    variants['listing-card-2x']?.url ||
    variants['listing-card']?.url ||
    variants['default']?.url ||
    null
  );
};

/**
 * Analiza TODAS las imágenes nuevas de un listing y guarda el resultado.
 *
 * @param {Object} params
 * @param {string} params.listingId - uuid del listing.
 * @param {boolean} [params.force] - re-analizar aunque ya exista análisis.
 * @returns {Promise<Object>} { aggregated, perImage, newlyAnalyzedCount, moderationAction }
 * @throws {Error} 'listing_not_found' | 'ai_not_configured' | 'integration_sdk_missing'
 */
const analyzeListing = async ({ listingId, force = false } = {}) => {
  if (!listingId) throw new Error('listing_id_required');
  if (!isConfigured()) throw new Error('ai_not_configured');

  const sdk = getIntegrationSdk();
  if (!sdk) throw new Error('integration_sdk_missing');

  // 1. Fetch del listing con imágenes.
  const resp = await sdk.listings.show({
    id: listingId,
    include: ['images'],
    'fields.image': [
      'variants.scaled-large',
      'variants.scaled-medium',
      'variants.listing-card',
      'variants.listing-card-2x',
    ],
  });
  const listing = resp?.data?.data;
  if (!listing) throw new Error('listing_not_found');

  const included = resp.data.included || [];
  const imageRefs = listing.relationships?.images?.data || [];
  const images = imageRefs
    .map(ref => included.find(i => i.type === 'image' && i.id.uuid === ref.id.uuid))
    .filter(Boolean);

  const title = listing.attributes.title || '';
  const pd = listing.attributes.publicData || {};
  const listingType = pd.listingType;
  const category = pd.categoryLevel1 || pd.category || null;

  const existing = pd.aiAnalysis || {};
  const existingPerImage = existing.perImage || {};

  // 2. Decidir qué imágenes analizar.
  const imagesToAnalyze = pickImagesToAnalyze({
    listingImages: images,
    existingPerImage,
    force,
  });

  // 3. Analizar en paralelo (max 3 concurrentes para no saturar).
  const perImageUpdates = {};
  const analyzedAt = new Date().toISOString();
  const CONCURRENCY = 3;
  const batches = [];
  for (let i = 0; i < imagesToAnalyze.length; i += CONCURRENCY) {
    batches.push(imagesToAnalyze.slice(i, i + CONCURRENCY));
  }

  for (const batch of batches) {
    const results = await Promise.allSettled(
      batch.map(img =>
        analyzeImage({
          imageUrl: extractImageUrl(img),
          listingTitle: title,
          listingType,
          category,
        }).then(data => ({ imageId: img.id.uuid, data }))
      )
    );
    for (const r of results) {
      if (r.status === 'fulfilled') {
        perImageUpdates[r.value.imageId] = {
          analyzedAt,
          ...r.value.data,
        };
      } else {
        // eslint-disable-next-line no-console
        console.error('[listingAiAnalysis] image failed:', r.reason?.message);
      }
    }
  }

  // 4. Merge con lo que ya existía.
  const mergedPerImage = force
    ? perImageUpdates
    : { ...existingPerImage, ...perImageUpdates };

  // 5. Agregar.
  const aggregated = aggregatePerImage(mergedPerImage);

  // 6. Guardar en publicData (merge shallow preserva otros campos).
  const aiAnalysis = {
    version: PROMPT.version,
    analyzedAt,
    aggregated,
    perImage: mergedPerImage,
  };

  await sdk.listings.update({
    id: listingId,
    publicData: { aiAnalysis },
  });

  // 7. Aplicar política de moderación.
  let moderationAction = 'none';
  if (aggregated.moderation.status === 'block') {
    try {
      await sdk.listings.close({ id: listingId });
      moderationAction = 'closed';
      // eslint-disable-next-line no-console
      console.warn(
        `[listingAiAnalysis] listing ${listingId} CLOSED by moderation. Reasons:`,
        aggregated.moderation.blockReasons.join(', ')
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[listingAiAnalysis] closeListing failed:', err?.message);
      moderationAction = 'close_failed';
    }
  } else if (aggregated.moderation.status === 'warn') {
    moderationAction = 'flagged';
  }

  return {
    aggregated,
    perImage: mergedPerImage,
    newlyAnalyzedCount: Object.keys(perImageUpdates).length,
    totalImageCount: images.length,
    moderationAction,
  };
};

module.exports = {
  analyzeImage,
  aggregatePerImage,
  pickImagesToAnalyze,
  extractImageUrl,
  analyzeListing,
  PROMPT_VERSION: PROMPT.version,
};
