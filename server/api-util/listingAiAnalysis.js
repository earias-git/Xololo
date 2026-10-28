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
const { recordAiCall } = require('./aiMetrics');
const {
  isConfigured: algoliaConfigured,
  saveDocument: algoliaSaveDocument,
  deleteDocument: algoliaDeleteDocument,
} = require('./algoliaClient');
const { listingToAlgoliaDoc } = require('./listingIndexer');

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
    recordMetric: usage => recordAiCall({ purpose: 'imageAnalysis', usage }),
  });
  // Normaliza campos opcionales ausentes del output del modelo.
  // XOLOLO: v2 agrega moderation.category (slug) + recommendations
  // {quality, composition, trust} para dar al seller sugerencias
  // accionables sobre la foto.
  return {
    tags: result.tags || {},
    moderation: {
      status: result.moderation?.status || 'safe',
      category: result.moderation?.category || null,
      reasons: Array.isArray(result.moderation?.reasons) ? result.moderation.reasons : [],
      confidence:
        typeof result.moderation?.confidence === 'number' ? result.moderation.confidence : 0,
      notes: result.moderation?.notes || '',
    },
    autoDescription: result.autoDescription || '',
    recommendations: {
      quality: Array.isArray(result.recommendations?.quality) ? result.recommendations.quality : [],
      composition: Array.isArray(result.recommendations?.composition)
        ? result.recommendations.composition
        : [],
      trust: Array.isArray(result.recommendations?.trust) ? result.recommendations.trust : [],
    },
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
    const s = String(v || '')
      .trim()
      .toLowerCase();
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

  // XOLOLO: también agregamos category del moderation (de la primera
  // imagen bloqueada, para que /ops sepa qué tipo de ilícito) +
  // recomendaciones de todas las imágenes para que el seller tenga
  // consejos accionables.
  const allRecQuality = [];
  const allRecComposition = [];
  const allRecTrust = [];
  let blockCategory = null;

  for (const [imageId, data] of entries) {
    const t = data.tags || {};
    if (Array.isArray(t.objects)) allObjects.push(...t.objects);
    if (Array.isArray(t.colors)) allColors.push(...t.colors);
    if (Array.isArray(t.materials)) allMaterials.push(...t.materials);
    if (Array.isArray(t.keywords)) allKeywords.push(...t.keywords);

    const r = data.recommendations || {};
    if (Array.isArray(r.quality)) allRecQuality.push(...r.quality);
    if (Array.isArray(r.composition)) allRecComposition.push(...r.composition);
    if (Array.isArray(r.trust)) allRecTrust.push(...r.trust);

    const mod = data.moderation || {};
    if (mod.status === 'block') {
      hasBlock = true;
      blockReasons.push(...(mod.reasons || []));
      if (!blockCategory && mod.category) blockCategory = mod.category;
      flaggedImages.push({
        imageId,
        status: 'block',
        category: mod.category || null,
        reasons: mod.reasons || [],
        notes: mod.notes || '',
      });
    } else if (mod.status === 'warn') {
      hasWarn = true;
      warnReasons.push(...(mod.reasons || []));
      flaggedImages.push({
        imageId,
        status: 'warn',
        category: mod.category || null,
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
      category: blockCategory,
      blockReasons: dedupLower(blockReasons),
      warnReasons: dedupLower(warnReasons),
      flaggedImages,
    },
    autoDescription: first.autoDescription || '',
    recommendations: {
      quality: dedupLower(allRecQuality),
      composition: dedupLower(allRecComposition),
      trust: dedupLower(allRecTrust),
    },
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
  const mergedPerImage = force ? perImageUpdates : { ...existingPerImage, ...perImageUpdates };

  // 5. Agregar.
  const aggregated = aggregatePerImage(mergedPerImage);

  // 6. Guardar en publicData (merge shallow preserva otros campos).
  const aiAnalysis = {
    version: PROMPT.version,
    analyzedAt,
    aggregated,
    perImage: mergedPerImage,
  };

  // XOLOLO: persistir TAMBIÉN publicData.xololoLegalModeration para que
  // los flags visuales aparezcan en /ops/legal-moderation (misma cola que
  // los flags de texto). Shape idéntico al de listingLegalityAi para
  // consistencia.
  const nowIso = new Date().toISOString();
  const modStatus = aggregated.moderation.status;
  const asLegalMod =
    modStatus === 'block' || modStatus === 'warn'
      ? {
          verdict: modStatus === 'block' ? 'illegal' : 'needs_review',
          category: aggregated.moderation.category || 'image_moderation',
          confidence: 75, // umbral mínimo para persistir block del prompt
          reasoning:
            modStatus === 'block'
              ? `Imagen con contenido prohibido: ${aggregated.moderation.blockReasons.join(', ')}`
              : `Imagen flagged para revisión: ${aggregated.moderation.warnReasons.join(', ')}`,
          evidence: (aggregated.moderation.flaggedImages || []).flatMap(f =>
            (f.reasons || []).slice(0, 3)
          ),
          source: 'image_analysis',
          moderatedAt: nowIso,
        }
      : null;

  const publicDataUpdate = { aiAnalysis };
  if (asLegalMod) publicDataUpdate.xololoLegalModeration = asLegalMod;

  await sdk.listings.update({
    id: listingId,
    publicData: publicDataUpdate,
  });

  // 7. Aplicar política de moderación.
  let moderationAction = 'none';
  if (modStatus === 'block') {
    try {
      await sdk.listings.close({ id: listingId });
      moderationAction = 'closed';
      // eslint-disable-next-line no-console
      console.warn(
        `[listingAiAnalysis] listing ${listingId} CLOSED by moderation. Reasons:`,
        aggregated.moderation.blockReasons.join(', ')
      );
      // XOLOLO: notificar al seller con el mismo evento que usa el flujo
      // de texto (listing.legality_blocked). Fire-and-forget — fallo no
      // bloquea el pipeline.
      try {
        // eslint-disable-next-line global-require
        const { sendEventNotifications } = require('./notifications');
        // eslint-disable-next-line global-require
        const { getIntegrationSdk } = require('./integrationSdk');
        const isdk = getIntegrationSdk();
        if (isdk) {
          const freshResp = await isdk.listings.show({
            id: listingId,
            include: ['author'],
          });
          const fresh = freshResp.data.data;
          const author = (freshResp.data.included || []).find(i => i.type === 'user');
          const baseUrl = process.env.ROOT_URL || 'https://xololo.mx';
          const slug = fresh?.attributes?.publicData?.slug || listingId;
          sendEventNotifications('listing.legality_blocked', {
            seller: {
              id: author?.id?.uuid,
              email: author?.attributes?.email,
              name:
                author?.attributes?.profile?.displayName ||
                author?.attributes?.profile?.firstName ||
                'vendedor',
            },
            listing: {
              id: listingId,
              title: fresh?.attributes?.title || '(sin título)',
              url: `${baseUrl}/l/${slug}/${listingId}`,
              editUrl: `${baseUrl}/l/${slug}/${listingId}/edit/photos`,
            },
            moderation: {
              category: asLegalMod.category,
              reasoning: asLegalMod.reasoning,
            },
          }).catch(e => {
            // eslint-disable-next-line no-console
            console.warn('[listingAiAnalysis] notify failed:', e?.message);
          });
        }
      } catch (notifErr) {
        // eslint-disable-next-line no-console
        console.warn('[listingAiAnalysis] notify build failed:', notifErr?.message);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[listingAiAnalysis] closeListing failed:', err?.message);
      moderationAction = 'close_failed';
    }
  } else if (modStatus === 'warn') {
    moderationAction = 'flagged';
  }

  // 8. Re-indexar en Algolia con los nuevos tags IA. Si Algolia no está
  // configurado, el listing simplemente no aparece en /api/search; no
  // bloquea el flujo. Si moderation=block, el listing fue cerrado →
  // también lo borramos del índice para que no aparezca en resultados.
  if (algoliaConfigured()) {
    try {
      if (aggregated.moderation.status === 'block' && moderationAction === 'closed') {
        await algoliaDeleteDocument(listingId);
      } else {
        // Re-fetch con autor para que el doc Algolia lleve authorName.
        const freshResp = await sdk.listings.show({
          id: listingId,
          include: ['author', 'images'],
          'fields.image': ['variants.listing-card', 'variants.listing-card-2x'],
        });
        const fresh = freshResp.data.data;
        const freshIncluded = freshResp.data.included || [];
        const doc = listingToAlgoliaDoc(fresh, freshIncluded);
        await algoliaSaveDocument(doc);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[listingAiAnalysis] algolia sync failed:', err?.message);
    }
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
