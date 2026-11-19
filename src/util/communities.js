/**
 * XOLOLO 2026-11-18 — Helpers de Comunidades (ADR-006, Fase 4 PR-1).
 *
 * Pure functions, zero side effects. Toda la lógica de membership,
 * routing, y mirror listing↔profile vive aquí para que backend y
 * frontend compartan la misma interpretación.
 *
 * LOCKED (ver docs/MODEL_COMMUNITIES_V1.md §7):
 *  - `profile.publicData.communities` es la FUENTE DE VERDAD.
 *  - `listing.publicData.sellerCommunities` es ESPEJO (array plano).
 *  - `id` y `type` son inmutables post-creación.
 *  - Los 3 tipos usan la misma entidad backend; el `type` decide
 *    el prefijo URL únicamente.
 */

// Tipos válidos de comunidad.
const COMMUNITY_TYPES = ['sectorial', 'modelo', 'geografica'];

// Mapeo type → prefijo de URL público.
const TYPE_TO_ROUTE_PREFIX = {
  sectorial: '/comunidad',
  modelo: '/programa',
  geografica: '/region',
};

// Inverso: dado un prefijo, recupera el type.
const ROUTE_PREFIX_TO_TYPE = Object.entries(TYPE_TO_ROUTE_PREFIX).reduce(
  (acc, [type, prefix]) => {
    acc[prefix] = type;
    return acc;
  },
  {}
);

// Regex de id válido. Solo lowercase, dígitos, guiones. 3-30 chars.
const COMMUNITY_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Valida un id de comunidad.
 * @param {string} id
 * @returns {boolean}
 */
const isValidCommunityId = id => {
  if (typeof id !== 'string') return false;
  if (id.length < 3 || id.length > 30) return false;
  return COMMUNITY_ID_RE.test(id);
};

/**
 * Valida un type de comunidad.
 * @param {string} type
 * @returns {boolean}
 */
const isValidCommunityType = type => COMMUNITY_TYPES.includes(type);

/**
 * Devuelve la ruta pública de una comunidad.
 * @param {{type: string, slug: string}} community
 * @returns {string|null}
 */
const getCommunityRoute = community => {
  if (!community || !community.type || !community.slug) return null;
  const prefix = TYPE_TO_ROUTE_PREFIX[community.type];
  if (!prefix) return null;
  return `${prefix}/${community.slug}`;
};

/**
 * Parsea una ruta tipo "/comunidad/opf" → {type, slug}.
 * Devuelve null si no corresponde a una ruta de comunidad.
 * @param {string} path
 * @returns {{type: string, slug: string}|null}
 */
const parseCommunityRoute = path => {
  if (typeof path !== 'string') return null;
  const match = path.match(/^(\/comunidad|\/programa|\/region)\/([a-z0-9-]+)\/?$/);
  if (!match) return null;
  const [, prefix, slug] = match;
  const type = ROUTE_PREFIX_TO_TYPE[prefix];
  if (!type || !isValidCommunityId(slug)) return null;
  return { type, slug };
};

/**
 * Devuelve el array de membresías del seller para un type.
 * Nunca lanza, nunca devuelve undefined.
 * @param {object} profile — profile de un user
 * @param {string} type — uno de COMMUNITY_TYPES
 * @returns {string[]}
 */
const getCommunitiesForType = (profile, type) => {
  if (!profile || !isValidCommunityType(type)) return [];
  const communities = profile?.publicData?.communities;
  if (!communities || typeof communities !== 'object') return [];
  const arr = communities[type];
  return Array.isArray(arr) ? arr.filter(Boolean) : [];
};

/**
 * ¿El seller pertenece a esta comunidad?
 * @param {object} profile
 * @param {{id: string, type: string}} community
 * @returns {boolean}
 */
const isSellerInCommunity = (profile, community) => {
  if (!profile || !community?.id || !community?.type) return false;
  const arr = getCommunitiesForType(profile, community.type);
  return arr.includes(community.id);
};

/**
 * Devuelve el espejo plano (array de ids) a escribir en
 * listing.publicData.sellerCommunities, derivado del profile del
 * seller.
 *
 * Mezcla los 3 arrays (sectorial + modelo + geografica) en uno
 * único para que Sharetribe pueda filtrar listings con `pub_...has`.
 * Dedupe por si acaso.
 *
 * @param {object} profile
 * @returns {string[]}
 */
const getListingCommunityMirror = profile => {
  if (!profile) return [];
  const ids = new Set();
  for (const type of COMMUNITY_TYPES) {
    for (const id of getCommunitiesForType(profile, type)) {
      if (isValidCommunityId(id)) ids.add(id);
    }
  }
  return Array.from(ids);
};

/**
 * XOLOLO 2026-11-18 — espejo POR LISTING que respeta el opt-out del seller.
 *
 * Caso de uso: un vivero pertenece a OPF y publica nochebuenas +
 * un escritorio usado. La nochebuena aplica a OPF, el escritorio no.
 * El seller marca el escritorio con `excludeFromCommunities: ['opf']`
 * y este helper devuelve el mirror correcto para cada listing.
 *
 * @param {object} profile — profile del seller (fuente de memberships)
 * @param {object} listingPublicData — publicData del listing concreto
 * @returns {string[]} — mirror filtrado
 */
const computeMirrorForListing = (profile, listingPublicData) => {
  const baseMirror = getListingCommunityMirror(profile);
  const exclude = listingPublicData?.excludeFromCommunities;
  if (!Array.isArray(exclude) || exclude.length === 0) return baseMirror;
  const excludeSet = new Set(exclude.filter(isValidCommunityId));
  return baseMirror.filter(id => !excludeSet.has(id));
};

/**
 * Inmutablemente agrega al seller a una comunidad.
 * Devuelve el nuevo objeto `communities` (NO el profile completo).
 *
 * @param {object} profilePublicData
 * @param {{id: string, type: string}} community
 * @returns {object} — nuevo objeto communities
 */
const addCommunityMembership = (profilePublicData, community) => {
  if (!community?.id || !isValidCommunityType(community.type)) {
    throw new Error('invalid_community');
  }
  const current =
    (profilePublicData && profilePublicData.communities) || {};
  const typeArr = Array.isArray(current[community.type]) ? current[community.type] : [];
  if (typeArr.includes(community.id)) return current; // idempotente
  return {
    ...current,
    [community.type]: [...typeArr, community.id],
  };
};

/**
 * Inmutablemente quita al seller de una comunidad.
 * @param {object} profilePublicData
 * @param {{id: string, type: string}} community
 * @returns {object}
 */
const removeCommunityMembership = (profilePublicData, community) => {
  if (!community?.id || !isValidCommunityType(community.type)) {
    throw new Error('invalid_community');
  }
  const current =
    (profilePublicData && profilePublicData.communities) || {};
  const typeArr = Array.isArray(current[community.type]) ? current[community.type] : [];
  const next = typeArr.filter(id => id !== community.id);
  return {
    ...current,
    [community.type]: next,
  };
};

/**
 * Devuelve TODAS las comunidades del seller en un formato aplanado
 * con metadata. Útil para UI que muestra chips/badges.
 *
 * @param {object} profile
 * @returns {Array<{id: string, type: string}>}
 */
const listAllMemberships = profile => {
  if (!profile) return [];
  const out = [];
  for (const type of COMMUNITY_TYPES) {
    for (const id of getCommunitiesForType(profile, type)) {
      out.push({ id, type });
    }
  }
  return out;
};

/**
 * Clave del documento de comunidad en metadata del marketplace.
 * Usado por backend (Integration SDK) para read/write.
 *
 * @param {string} id
 * @returns {string}
 */
const metadataKey = id => `community:${id}`;

module.exports = {
  // Constantes
  COMMUNITY_TYPES,
  TYPE_TO_ROUTE_PREFIX,
  ROUTE_PREFIX_TO_TYPE,
  // Validación
  isValidCommunityId,
  isValidCommunityType,
  // Routing
  getCommunityRoute,
  parseCommunityRoute,
  // Membership queries
  getCommunitiesForType,
  isSellerInCommunity,
  listAllMemberships,
  // Mutation helpers (inmutables)
  addCommunityMembership,
  removeCommunityMembership,
  // Mirror listing↔profile
  getListingCommunityMirror,
  computeMirrorForListing,
  // Backend helpers
  metadataKey,
};
