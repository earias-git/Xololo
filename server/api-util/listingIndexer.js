// XOLOLO Fase 2 — convierte un listing de Sharetribe en un documento
// plano que Algolia puede indexar + buscar + facetar.
//
// Mapeo:
//   objectID        → listing uuid (Algolia upsertea por este campo)
//   title           → listing.attributes.title
//   description     → listing.attributes.description
//   priceSubunits   → listing.attributes.price.amount (cents)
//   currency        → listing.attributes.price.currency
//   listingType     → publicData.listingType
//   category        → publicData.categoryLevel1
//   state           → listing.attributes.state ('published'|'closed'|...)
//   authorId        → relationships.author.data.id.uuid
//   authorName      → author?.attributes.profile.displayName
//   coverUrl        → primera imagen (variants.listing-card-2x)
//   createdAtTs     → unix timestamp (para custom ranking)
//   slug            → derivado del título para construir href
//   // Enrichment IA (del backfill-ai-analysis):
//   aiTags.objects/colors/materials/keywords  → flat arrays
//   aiTags.style/setting/quality               → strings
//   hasAiAnalysis   → true si tiene publicData.aiAnalysis
//   moderation      → 'safe' | 'warn' | 'block'
//   autoDescription → corta descripción generada por IA

const toSlug = title =>
  String(title || 'listing')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const extractCoverUrl = (listing, included = []) => {
  const ref = listing?.relationships?.images?.data?.[0];
  if (!ref) return null;
  const img = included.find(i => i.type === 'image' && i.id.uuid === ref.id.uuid);
  const v = img?.attributes?.variants;
  return (
    v?.['listing-card-2x']?.url ||
    v?.['listing-card']?.url ||
    v?.['scaled-medium']?.url ||
    null
  );
};

const extractAuthorName = (listing, included = []) => {
  const ref = listing?.relationships?.author?.data;
  if (!ref) return null;
  const user = included.find(i => i.type === 'user' && i.id.uuid === ref.id.uuid);
  return user?.attributes?.profile?.displayName || null;
};

/**
 * Convierte un listing (SDK response data item) en documento Algolia.
 *
 * @param {Object} listing - l.id.uuid, l.attributes, l.relationships
 * @param {Array}  included - response.data.included (para resolver imágenes/autor)
 * @returns {Object} doc listo para saveObject
 */
const listingToAlgoliaDoc = (listing, included = []) => {
  if (!listing?.id?.uuid) throw new Error('listing_missing_id');
  const attrs = listing.attributes || {};
  const pd = attrs.publicData || {};
  const ai = pd.aiAnalysis?.aggregated || null;
  const aiTags = ai?.tags || {};

  const price = attrs.price || null;
  const createdAt = attrs.createdAt ? new Date(attrs.createdAt) : null;

  return {
    objectID: listing.id.uuid,
    title: attrs.title || '',
    description: attrs.description || '',
    slug: toSlug(attrs.title),
    priceSubunits: price?.amount != null ? Number(price.amount) : null,
    currency: price?.currency || 'MXN',
    listingType: pd.listingType || null,
    category: pd.categoryLevel1 || pd.category || null,
    state: attrs.state || 'published',
    deleted: !!attrs.deleted,
    authorId: listing.relationships?.author?.data?.id?.uuid || null,
    authorName: extractAuthorName(listing, included),
    coverUrl: extractCoverUrl(listing, included),
    createdAtTs: createdAt ? Math.floor(createdAt.getTime() / 1000) : 0,

    hasAiAnalysis: !!ai,
    moderation: ai?.moderation?.status || 'safe',
    autoDescription: ai?.autoDescription || '',
    aiTags: {
      objects: Array.isArray(aiTags.objects) ? aiTags.objects : [],
      colors: Array.isArray(aiTags.colors) ? aiTags.colors : [],
      materials: Array.isArray(aiTags.materials) ? aiTags.materials : [],
      keywords: Array.isArray(aiTags.keywords) ? aiTags.keywords : [],
      style: aiTags.style || '',
      setting: aiTags.setting || '',
      quality: aiTags.quality || '',
    },
  };
};

module.exports = {
  listingToAlgoliaDoc,
  toSlug,
  extractCoverUrl,
  extractAuthorName,
};
