// XOLOLO 2026-11-18 — Service de comunidades (ADR-006, Fase 4 PR-2).
//
// Servidor del catálogo público + query de listings scopeado a una
// comunidad. Mantiene el mismo pattern que landingListingsService.js
// (cache en memoria 60s, Integration SDK, fail-open).
//
// LOCKED (ver docs/MODEL_COMMUNITIES_V1.md):
//   1. El source of truth del catálogo es src/config/communities.js
//      (archivo en repo). Mutaciones = edit + redeploy. No hay CRUD
//      runtime en V1.
//   2. La membership del seller vive en profile.publicData.communities.
//      El espejo en listing.publicData.sellerCommunities habilita el
//      filter server-side `pub_sellerCommunities:has:opf`.
//   3. 404 cuando isPublished=false (pero la data sigue accesible a
//      OPS via el archivo + endpoint admin).
//   4. Shape de retorno {data, included, meta} para /listings es
//      contrato — los selectores del cliente lo asumen.

const { COMMUNITIES_SEED } = require('../../src/config/communities');
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

const invalidateCache = () => CACHE.clear();

// -------- catálogo (source of truth = archivo) --------

// Proyección pública (sin admins, sin createdBy, sin isPublished
// cuando es false).
const toPublic = c => ({
  id: c.id,
  type: c.type,
  slug: c.slug,
  name: c.name,
  tagline: c.tagline || '',
  description: c.description || '',
  bylaws: c.bylaws || '',
  branding: c.branding || {},
  membership: c.membership || 'open',
  requiresCertification: !!c.requiresCertification,
  primaryFacets: c.primaryFacets || {},
  sellerCount: c.sellerCount || 0,
  seoKeywords: c.seoKeywords || [],
  createdAt: c.createdAt,
});

// Catálogo completo (con los campos privados). Solo para admin/OPS.
const getAllRaw = () => COMMUNITIES_SEED;

// Listar comunidades publicadas (para el footer "Comunidades" o
// una página /comunidades).
const listPublic = () =>
  COMMUNITIES_SEED
    .filter(c => c.isPublished === true && !c.isDeleted)
    .map(toPublic);

// Buscar por slug (+ opcional type para desambiguar si en el futuro
// coinciden slugs entre types).
const getBySlug = (slug, type) => {
  if (!slug) return null;
  const candidates = COMMUNITIES_SEED.filter(c => c.slug === slug && !c.isDeleted);
  const match = type
    ? candidates.find(c => c.type === type)
    : candidates[0];
  if (!match) return null;
  return match;
};

// Para público: 404 si no publicado.
const getBySlugPublic = (slug, type) => {
  const c = getBySlug(slug, type);
  if (!c || !c.isPublished) return null;
  return toPublic(c);
};

// -------- listings scopeados a una comunidad --------
//
// Query a Sharetribe: pub_sellerCommunities:has:<id>. Esto filtra
// listings cuyo espejo incluye la comunidad. Esperamos que PR-3
// (join/leave) mantenga este espejo sincronizado — en PR-2 solo
// leemos, no escribimos.

const COMMON_FIELDS = {
  include: ['author', 'images'],
  'fields.image': ['variants.listing-card', 'variants.listing-card-2x'],
  'fields.user': [
    'profile.displayName',
    'profile.abbreviatedName',
    'profile.publicData.sellerMode',
  ],
  'imageVariant.listing-card': 'w:400;h:400;fit:crop',
  'imageVariant.listing-card-2x': 'w:800;h:800;fit:crop',
  sort: '-createdAt',
};

// Pagina y filtra siblings de variantes (coincidente con
// landingListingsService). Un listing sibling tiene variantGroupId
// pero no isVariantMaster — no debe mostrarse en una landing.
const isSibling = l => {
  const pd = l.attributes?.publicData || {};
  return !!pd.variantGroupId && pd.isVariantMaster !== true;
};

const fetchCommunityListings = async ({
  communityId,
  page = 1,
  perPage = 24,
  pubFilters = {},
}) => {
  const isdk = getIntegrationSdk();
  if (!isdk) throw new Error('integration_api_missing');

  const query = {
    ...COMMON_FIELDS,
    pub_sellerCommunities: `has:${communityId}`,
    ...pubFilters,
    page,
    perPage: Math.min(perPage, 100),
  };

  let resp;
  try {
    resp = await isdk.listings.query(query);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[communitiesService] listings.query failed', e?.message);
    // Fail-open: devolver landing vacía en vez de romper la página.
    return { data: [], included: [], meta: { totalItems: 0, totalPages: 0, page } };
  }

  const data = (resp.data?.data || []).filter(l => !isSibling(l));
  const included = resp.data?.included || [];
  const meta = resp.data?.meta || {};

  return { data, included, meta };
};

// -------- API de alto nivel para los endpoints --------

const getCommunityPayload = async (slug, type) => {
  const community = getBySlugPublic(slug, type);
  if (!community) return null;

  const cacheKey = `community:${community.id}:listings:page1`;
  let listings = getCached(cacheKey);
  if (!listings) {
    listings = await fetchCommunityListings({
      communityId: community.id,
      page: 1,
      perPage: 24,
    });
    setCached(cacheKey, listings);
  }

  return { community, listings };
};

const getCommunityListings = async ({ slug, type, page, perPage, pubFilters }) => {
  const community = getBySlugPublic(slug, type);
  if (!community) return null;

  // Solo cacheamos la primera página (la más consultada) y sin
  // filtros. Filtered queries pegan a Sharetribe directo sin cache
  // para no explotar la memoria.
  if (page === 1 && !pubFilters) {
    const cacheKey = `community:${community.id}:listings:page1`;
    let listings = getCached(cacheKey);
    if (!listings) {
      listings = await fetchCommunityListings({
        communityId: community.id,
        page,
        perPage,
      });
      setCached(cacheKey, listings);
    }
    return { community, listings };
  }

  const listings = await fetchCommunityListings({
    communityId: community.id,
    page,
    perPage,
    pubFilters: pubFilters || {},
  });
  return { community, listings };
};

module.exports = {
  listPublic,
  getBySlug,
  getBySlugPublic,
  getAllRaw,
  getCommunityPayload,
  getCommunityListings,
  invalidateCache,
  // exportado para tests
  toPublic,
};
