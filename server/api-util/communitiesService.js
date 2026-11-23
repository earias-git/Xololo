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
// XOLOLO 2026-11-18 — PR-4: overlay in-memory del admin para togglear
// isPublished sin redeploy. Se aplica ANTES de las funciones públicas
// de lectura para que un cambio del admin se refleje al instante.
const adminOverlay = require('./communitiesAdminOverlay');

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
  // XOLOLO 2026-11-18 — chips de filtro propios de la comunidad.
  // La landing los usa en vez de derivar de categoryLevel1 genérico.
  filterGroups: Array.isArray(c.filterGroups) ? c.filterGroups : null,
  // XOLOLO 2026-11-19 — modo de inclusión por listing
  // (opt-in vs opt-out). Lo necesita la UI del wizard para decidir
  // si el checkbox parte tildado o destildado.
  listingDefaultInclusion: c.listingDefaultInclusion || null,
  sellerCount: c.sellerCount || 0,
  seoKeywords: c.seoKeywords || [],
  createdAt: c.createdAt,
});

// Catálogo completo (con los campos privados). Solo para admin/OPS.
// Aplica el overlay para reflejar cambios en vivo.
const getAllRaw = () => COMMUNITIES_SEED.map(c => adminOverlay.apply(c));

// Listar comunidades publicadas (para el footer "Comunidades" o
// una página /comunidades).
const listPublic = () =>
  COMMUNITIES_SEED
    .map(c => adminOverlay.apply(c))
    .filter(c => c.isPublished === true && !c.isDeleted)
    .map(toPublic);

// Buscar por slug (+ opcional type para desambiguar si en el futuro
// coinciden slugs entre types).
const getBySlug = (slug, type) => {
  if (!slug) return null;
  const candidates = COMMUNITIES_SEED
    .map(c => adminOverlay.apply(c))
    .filter(c => c.slug === slug && !c.isDeleted);
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

// XOLOLO 2026-11-23 — hotfix del overfetch para esquivar el filtro
// contaminado `pub_sellerCommunities:has:<id>` de Sharetribe. En
// producción OPF observamos que Sharetribe devuelve ~55 listings para
// has:opf, de los cuales 51 tienen `sellerCommunities=[]` o `undefined`
// (falsos positivos del índice stale). La landing muestra solo 2 de 4
// masters reales porque los otros 2 caen en page 2/3. Hasta que
// Sharetribe reindexe (o corramos backfill del mirror), iteramos pages
// acumulando los que pasan `inCommunity`.
const OVERFETCH_MAX_PAGES = 5; // 500 candidates máx
const OVERFETCH_PER_PAGE = 100; // top permitido por Sharetribe
const OVERFETCH_TARGET_FACTOR = 2; // junta 2× el perPage pedido

const fetchCommunityListings = async ({
  communityId,
  page = 1,
  perPage = 24,
  pubFilters = {},
}) => {
  const isdk = getIntegrationSdk();
  if (!isdk) throw new Error('integration_api_missing');

  const inCommunity = l => {
    const sc = l.attributes?.publicData?.sellerCommunities;
    return Array.isArray(sc) && sc.includes(communityId);
  };

  // Objetivo de items reales (pasados ambos filtros) a juntar.
  const target = Math.max(perPage * OVERFETCH_TARGET_FACTOR, perPage);

  const acc = [];
  const includedSeen = new Map(); // id → inc (dedup por id)
  let lastMeta = { totalItems: 0, totalPages: 0, page: 1 };
  let pagesScanned = 0;

  for (let p = page; p < page + OVERFETCH_MAX_PAGES; p++) {
    const query = {
      ...COMMON_FIELDS,
      pub_sellerCommunities: `has:${communityId}`,
      ...pubFilters,
      page: p,
      perPage: OVERFETCH_PER_PAGE,
    };

    let resp;
    try {
      // eslint-disable-next-line no-await-in-loop
      resp = await isdk.listings.query(query);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[communitiesService] listings.query failed', e?.message);
      // Si truena a mitad de overfetch, devolvemos lo juntado hasta ahí.
      if (acc.length) break;
      return { data: [], included: [], meta: { totalItems: 0, totalPages: 0, page } };
    }

    pagesScanned += 1;
    lastMeta = resp.data?.meta || lastMeta;
    const pageItems = (resp.data?.data || []).filter(l => !isSibling(l)).filter(inCommunity);
    acc.push(...pageItems);

    (resp.data?.included || []).forEach(inc => {
      const key = `${inc.type}:${inc.id?.uuid}`;
      if (!includedSeen.has(key)) includedSeen.set(key, inc);
    });

    // Paro temprano: llegamos al target o exhaustimos las pages reales.
    if (acc.length >= target) break;
    const totalPages = lastMeta.totalPages || 1;
    if (p >= totalPages) break;
  }

  const data = acc.slice(0, target);

  // eslint-disable-next-line no-console
  console.log(
    `[communitiesService:${communityId}] overfetch ${pagesScanned}p × ${OVERFETCH_PER_PAGE} = ${data.length} real items (of ${lastMeta.totalItems || '?'} raw)`
  );

  return { data, included: Array.from(includedSeen.values()), meta: lastMeta };
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
