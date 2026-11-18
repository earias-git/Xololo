// XOLOLO 2026-11-18 — OPS Notifications Mejora B: grupos.
//
// Define los grupos predefinidos a los que un operador puede enviar
// un email masivo desde el módulo Notificaciones de OPS.
//
// Diseño:
// - Grupos son config como código (NO CRUD desde UI). Para agregar
//   un grupo nuevo: push a GROUPS[] y deploy.
// - Cada grupo tiene un resolver async que devuelve
//   {id, email, displayName}[] (max 100 por grupo — guardarraíl
//   anti foot-gun).
// - Cache 5 minutos para que la UI pueda hacer preview sin re-pegar
//   al Integration SDK en cada click.
//
// Guardarraíles:
// - Max 100 destinatarios por grupo (RESEND rate limits + anti-fuga
//   de confianza si el operador se equivoca).
// - Un email aparece en cada grupo máximo UNA vez (dedup por id).
//
// Las señales reflejan las de otros módulos del codebase:
// - casual_reseller: profile.publicData.sellerMode (ADR-005 landing).
// - isVariantMaster: publicData.isVariantMaster (ADR-003/004).
// - condition=used: publicData.condition === 'used' (landing).
// - moda: publicData.categoryLevel1 === 'moda'.

const { getIntegrationSdk } = require('../integrationSdk');

const MAX_RECIPIENTS_PER_GROUP = 100;
const CACHE_TTL_MS = 5 * 60 * 1000;
const _cache = new Map();

const getCached = key => {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    _cache.delete(key);
    return null;
  }
  return entry.data;
};

const setCached = (key, data) => _cache.set(key, { at: Date.now(), data });

const invalidateCache = () => _cache.clear();

// -------- helpers --------
const toRecipient = user => ({
  id: user.id?.uuid,
  email: user.attributes?.email,
  displayName:
    user.attributes?.profile?.displayName ||
    user.attributes?.profile?.abbreviatedName ||
    (user.attributes?.email || '').split('@')[0] ||
    '',
});

// Pagina listings hasta reunir authors únicos que cumplen predicado.
// Devuelve un Set<authorId>.
const collectAuthorIdsByListing = async ({ isdk, listingQuery, predicate }) => {
  const authorIds = new Set();
  for (let page = 1; page <= 10 && authorIds.size < 500; page++) {
    let resp;
    try {
      resp = await isdk.listings.query({ ...listingQuery, page, perPage: 100 });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[opsGroups] listings.query failed p', page, e?.message);
      break;
    }
    const data = resp.data?.data || [];
    for (const l of data) {
      if (!predicate || predicate(l)) {
        const authorId = l.relationships?.author?.data?.id?.uuid;
        if (authorId) authorIds.add(authorId);
      }
    }
    if (data.length < 100) break;
  }
  return authorIds;
};

const resolveUsersByIds = async ({ isdk, authorIds }) => {
  // Batch: Integration SDK no tiene bulk-get, hacemos query y filtramos
  // en memoria (marketplace chico).
  const recipients = [];
  const seen = new Set();
  const wanted = authorIds;
  for (let page = 1; page <= 10 && recipients.length < MAX_RECIPIENTS_PER_GROUP; page++) {
    let resp;
    try {
      resp = await isdk.users.query({ perPage: 100, page });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[opsGroups] users.query failed p', page, e?.message);
      break;
    }
    const data = resp.data?.data || [];
    for (const u of data) {
      const uid = u.id?.uuid;
      if (!uid || seen.has(uid) || !wanted.has(uid)) continue;
      seen.add(uid);
      const r = toRecipient(u);
      if (r.email) recipients.push(r);
      if (recipients.length >= MAX_RECIPIENTS_PER_GROUP) break;
    }
    if (data.length < 100) break;
  }
  return recipients;
};

// -------- resolvers por grupo --------

const resolveSellersWithVariantsMasters = async isdk => {
  const authorIds = await collectAuthorIdsByListing({
    isdk,
    listingQuery: { pub_isVariantMaster: true },
    predicate: l => l.attributes?.publicData?.isVariantMaster === true,
  });
  return resolveUsersByIds({ isdk, authorIds });
};

const resolveModaSellersWithVariants = async isdk => {
  const authorIds = await collectAuthorIdsByListing({
    isdk,
    listingQuery: { pub_isVariantMaster: true, pub_categoryLevel1: 'moda' },
    predicate: l => {
      const pd = l.attributes?.publicData || {};
      return pd.isVariantMaster === true && pd.categoryLevel1 === 'moda';
    },
  });
  return resolveUsersByIds({ isdk, authorIds });
};

const resolveSellersWithUsedListings = async isdk => {
  const authorIds = await collectAuthorIdsByListing({
    isdk,
    listingQuery: { pub_condition: 'used' },
    predicate: l => l.attributes?.publicData?.condition === 'used',
  });
  return resolveUsersByIds({ isdk, authorIds });
};

const resolveCasualResellers = async isdk => {
  // Pull users y filtra por sellerMode. No hay query indexado por
  // profile.publicData en Integration SDK; filtramos en memoria.
  const recipients = [];
  const seen = new Set();
  for (let page = 1; page <= 10 && recipients.length < MAX_RECIPIENTS_PER_GROUP; page++) {
    let resp;
    try {
      resp = await isdk.users.query({ perPage: 100, page });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[opsGroups] users.query failed p', page, e?.message);
      break;
    }
    const data = resp.data?.data || [];
    for (const u of data) {
      const uid = u.id?.uuid;
      if (!uid || seen.has(uid)) continue;
      const mode = u.attributes?.profile?.publicData?.sellerMode;
      if (mode !== 'casual_reseller') continue;
      seen.add(uid);
      const r = toRecipient(u);
      if (r.email) recipients.push(r);
      if (recipients.length >= MAX_RECIPIENTS_PER_GROUP) break;
    }
    if (data.length < 100) break;
  }
  return recipients;
};

const resolveAllActiveSellers = async isdk => {
  // "Activo" = con al menos un listing published.
  const authorIds = await collectAuthorIdsByListing({
    isdk,
    listingQuery: {},
    predicate: l => l.attributes?.state === 'published',
  });
  return resolveUsersByIds({ isdk, authorIds });
};

// -------- catálogo de grupos --------
const GROUPS = [
  {
    id: 'sellers-with-variants-masters',
    label: 'Sellers con variantes (masters)',
    description:
      'Todos los sellers que tienen ≥1 listing con isVariantMaster=true. Útil para avisos de ADR-003/004 (sync, foto por color).',
    resolver: resolveSellersWithVariantsMasters,
  },
  {
    id: 'moda-sellers-with-variants',
    label: 'Sellers de Moda con variantes',
    description:
      'Subconjunto del anterior: solo categoryLevel1=moda. Útil para avisos específicos de foto por color.',
    resolver: resolveModaSellersWithVariants,
  },
  {
    id: 'casual-resellers',
    label: 'Revendedores casuales (Art. 9 fracc IV)',
    description:
      'Sellers con profile.publicData.sellerMode=casual_reseller. Útil para avisos fiscales o límites del régimen.',
    resolver: resolveCasualResellers,
  },
  {
    id: 'sellers-with-used-listings',
    label: 'Sellers con productos usados',
    description:
      'Sellers que tienen ≥1 listing con condition=used. Útil para avisos sobre segunda mano.',
    resolver: resolveSellersWithUsedListings,
  },
  {
    id: 'all-active-sellers',
    label: 'Todos los sellers activos',
    description:
      'Sellers con ≥1 listing publicado. ÚLTIMO RECURSO — usar con mucho cuidado (anuncios generales, cambios de términos).',
    resolver: resolveAllActiveSellers,
  },
];

const listGroupsMetaOnly = () =>
  GROUPS.map(({ id, label, description }) => ({ id, label, description }));

const resolveGroup = async groupId => {
  const group = GROUPS.find(g => g.id === groupId);
  if (!group) return null;

  const cached = getCached(groupId);
  if (cached) return { group, recipients: cached };

  const isdk = getIntegrationSdk();
  if (!isdk) throw new Error('integration_api_missing');

  const recipients = await group.resolver(isdk);
  setCached(groupId, recipients);
  return { group, recipients };
};

module.exports = {
  listGroupsMetaOnly,
  resolveGroup,
  invalidateCache,
  MAX_RECIPIENTS_PER_GROUP,
};
