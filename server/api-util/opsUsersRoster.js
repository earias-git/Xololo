// XOLOLO OPS Users 360 · Fase A — construye el "roster" consolidado de
// usuarios para la vista /ops/users.
//
// Decisiones:
//   - Fetch de users + listings + transactions en paralelo con el
//     Integration SDK (mismo patrón que admin-overview). Hay duplicación
//     intencional de los paginators — cuando crezca el volumen,
//     extraemos a sharetribeFetchers.js compartido.
//   - Join en memoria por authorId / customerId / providerId.
//   - Cache por 10 min (una entrada por "snapshot completo", filters se
//     aplican en memoria por request).
//   - El roster NO devuelve PII sensible (RFC completo). Email sí
//     (ya es visible en /admin).
//
// Shape que exponemos por user — ver buildUserRosterEntry().

const { getIntegrationSdk } = require('./integrationSdk');
const { getAdminEmails } = require('./adminGate');

const MAX_PAGES = 20;
const PER_PAGE = 100;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

const SERVICE_UNIT_TYPES = new Set(['hour', 'day', 'night', 'fixed']);

// --------------------- fetch helpers ----------------------

const fetchAllListings = async isdk => {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const resp = await isdk.listings.query({
      page,
      perPage: PER_PAGE,
      'fields.listing': ['title', 'state', 'createdAt', 'publicData', 'metadata'],
    });
    all.push(...(resp.data.data || []));
    const totalPages = resp.data.meta?.totalPages || 1;
    if (page >= totalPages) break;
  }
  return all;
};

const fetchAllUsers = async isdk => {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const resp = await isdk.users.query({
      page,
      perPage: PER_PAGE,
      'fields.user': [
        'email',
        'createdAt',
        'stripeConnected',
        'profile.displayName',
        'profile.firstName',
        'profile.lastName',
        'profile.publicData',
        'profile.metadata',
      ],
    });
    all.push(...(resp.data.data || []));
    const totalPages = resp.data.meta?.totalPages || 1;
    if (page >= totalPages) break;
  }
  return all;
};

const fetchAllTxs = async isdk => {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const resp = await isdk.transactions.query({
      page,
      perPage: PER_PAGE,
      include: ['customer', 'provider', 'listing'],
      'fields.transaction': [
        'createdAt',
        'lastTransitionedAt',
        'lastTransition',
        'state',
        'processName',
        'payinTotal',
        'lineItems',
      ],
    });
    all.push(...(resp.data.data || []));
    const totalPages = resp.data.meta?.totalPages || 1;
    if (page >= totalPages) break;
  }
  return all;
};

// --------------------- clasificación ----------------------

const classifyListingSegment = listing => {
  const pd = listing.attributes?.publicData || {};
  const unitType = pd.unitType;
  const condition = pd.condition;
  if (SERVICE_UNIT_TYPES.has(unitType)) return 'service';
  if (condition === 'used') return 'used';
  return 'new';
};

const classifyUserType = (user, { adminEmails, listingCount, hasPurchases }) => {
  const email = String(user.attributes?.email || '').toLowerCase();
  if (email && adminEmails?.has(email)) return 'admin';
  const sellerMode = user.attributes?.profile?.publicData?.sellerMode;
  if (sellerMode === 'casual_reseller') return 'casual_reseller';
  if (sellerMode === 'store') return 'store';
  // Sin sellerMode declarado: inferimos. Con listings → store.
  if (listingCount > 0) return 'store';
  // Sin listings, con compras → buyer puro.
  if (hasPurchases) return 'buyer_only';
  // Sin nada → "lead" (registrado pero nunca activo).
  return 'lead';
};

const legalDocsSummary = metadata => {
  const legal = metadata?.xololoLegalDocs || {};
  const docs = legal.docs || {};
  const slots = Object.keys(docs);
  const approved = slots.filter(k => docs[k]?.status === 'approved').length;
  const pending = slots.filter(k => docs[k]?.status === 'pending').length;
  const rejected = slots.filter(k => docs[k]?.status === 'rejected').length;
  return {
    personType: legal.personType || null,
    approved,
    pending,
    rejected,
    total: slots.length,
  };
};

const extractAddress = publicData => {
  // Preferir pickupAddress (seller store), fallback a commercial o legal.
  const a =
    publicData?.pickupAddress ||
    publicData?.commercialAddress ||
    publicData?.legalAddress ||
    publicData?.address ||
    null;
  if (!a) return { state: null, city: null };
  return {
    state: a.area_level1 || a.state || null,
    city: a.area_level2 || a.city || null,
  };
};

// --------------------- construcción de entries ----------------------

/**
 * Construye el shape de un user tal como se expone al cliente del roster.
 */
const buildUserRosterEntry = (
  user,
  { listingsByAuthor, salesByProvider, purchasesByCustomer, adminEmails }
) => {
  const id = user.id?.uuid;
  const attrs = user.attributes || {};
  const profile = attrs.profile || {};
  const publicData = profile.publicData || {};
  const metadata = profile.metadata || {};

  const sellerListings = listingsByAuthor.get(id) || [];
  const bySegment = { new: 0, used: 0, service: 0 };
  let published = 0;
  for (const l of sellerListings) {
    bySegment[classifyListingSegment(l)] += 1;
    if (l.attributes?.state === 'published') published += 1;
  }

  const sales = salesByProvider.get(id) || { count: 0, gmvYTD: 0, lastAt: null };
  const purchases = purchasesByCustomer.get(id) || { count: 0, lastAt: null };

  const type = classifyUserType(user, {
    adminEmails,
    listingCount: sellerListings.length,
    hasPurchases: purchases.count > 0,
  });

  const addr = extractAddress(publicData);
  const subscription = metadata.xololoSubscription || null;
  const activity = metadata.xololoActivity || null;
  const legal = legalDocsSummary(metadata);

  // "Última actividad" = max de (lastSeenAt, lastSale, lastPurchase, createdAt).
  const activityCandidates = [
    activity?.lastSeenAt,
    sales.lastAt,
    purchases.lastAt,
    attrs.createdAt,
  ].filter(Boolean);
  const lastActivityAt = activityCandidates.length
    ? activityCandidates.reduce((max, iso) => (iso > max ? iso : max))
    : null;

  return {
    id,
    email: attrs.email || null,
    displayName: profile.displayName || null,
    firstName: profile.firstName || null,
    lastName: profile.lastName || null,
    slug: publicData.slug || null,
    createdAt: attrs.createdAt || null,
    lastSeenAt: activity?.lastSeenAt || null,
    lastActivityAt,
    type,
    verified: publicData.xololoVerified === true,
    verifiedAt: publicData.xololoVerifiedAt || null,
    stripeConnected: attrs.stripeConnected === true,
    subscriptionStatus: subscription?.status || null,
    legal,
    state: addr.state,
    city: addr.city,
    listings: {
      total: sellerListings.length,
      published,
      new: bySegment.new,
      used: bySegment.used,
      service: bySegment.service,
    },
    sales: { count: sales.count, gmvYTD: Number(sales.gmvYTD.toFixed(2)) },
    purchases: { count: purchases.count },
  };
};

// --------------------- snapshot cache ----------------------

let snapshotCache = null; // { at, entries }

const buildSnapshot = async isdk => {
  const [listings, users, txs] = await Promise.all([
    fetchAllListings(isdk),
    fetchAllUsers(isdk),
    fetchAllTxs(isdk),
  ]);

  // Index listings por authorId.
  const listingsByAuthor = new Map();
  for (const l of listings) {
    const authorId = l.relationships?.author?.data?.id?.uuid;
    if (!authorId) continue;
    if (!listingsByAuthor.has(authorId)) listingsByAuthor.set(authorId, []);
    listingsByAuthor.get(authorId).push(l);
  }

  // Index tx: sales por providerId, purchases por customerId.
  // GMV YTD = suma de payinTotal.amount (centavos) de tx de este año,
  // excluyendo canceladas.
  const yearStart = new Date();
  yearStart.setUTCMonth(0, 1);
  yearStart.setUTCHours(0, 0, 0, 0);

  const salesByProvider = new Map();
  const purchasesByCustomer = new Map();
  const isCanceled = tx => {
    const state = tx.attributes?.state;
    return state === 'canceled' || tx.attributes?.lastTransition?.includes('cancel');
  };

  for (const tx of txs) {
    const providerId = tx.relationships?.provider?.data?.id?.uuid;
    const customerId = tx.relationships?.customer?.data?.id?.uuid;
    const createdAt = tx.attributes?.createdAt;
    const lastAt = tx.attributes?.lastTransitionedAt || createdAt;
    const canceled = isCanceled(tx);

    if (providerId) {
      const bucket = salesByProvider.get(providerId) || { count: 0, gmvYTD: 0, lastAt: null };
      if (!canceled) bucket.count += 1;
      if (!canceled && createdAt && new Date(createdAt) >= yearStart) {
        const payin = tx.attributes?.payinTotal;
        if (payin?.amount) bucket.gmvYTD += payin.amount / 100;
      }
      if (!bucket.lastAt || lastAt > bucket.lastAt) bucket.lastAt = lastAt;
      salesByProvider.set(providerId, bucket);
    }
    if (customerId) {
      const bucket = purchasesByCustomer.get(customerId) || { count: 0, lastAt: null };
      if (!canceled) bucket.count += 1;
      if (!bucket.lastAt || lastAt > bucket.lastAt) bucket.lastAt = lastAt;
      purchasesByCustomer.set(customerId, bucket);
    }
  }

  const adminEmails = getAdminEmails();
  const entries = users.map(u =>
    buildUserRosterEntry(u, { listingsByAuthor, salesByProvider, purchasesByCustomer, adminEmails })
  );

  return { at: Date.now(), entries, totalUsers: users.length };
};

const getSnapshot = async ({ bypassCache = false } = {}) => {
  if (!bypassCache && snapshotCache && Date.now() - snapshotCache.at < CACHE_TTL_MS) {
    return { snapshot: snapshotCache, cached: true };
  }
  const isdk = getIntegrationSdk();
  if (!isdk) throw new Error('integration_api_missing');
  snapshotCache = await buildSnapshot(isdk);
  return { snapshot: snapshotCache, cached: false };
};

const invalidateSnapshot = () => {
  snapshotCache = null;
};

// --------------------- filters ----------------------

const MX_STATE_WHITELIST = new Set([
  'MX-AGU',
  'MX-BCN',
  'MX-BCS',
  'MX-CAM',
  'MX-CHP',
  'MX-CHH',
  'MX-COA',
  'MX-COL',
  'MX-CMX',
  'MX-CDMX',
  'MX-DUR',
  'MX-GUA',
  'MX-GRO',
  'MX-HID',
  'MX-JAL',
  'MX-MEX',
  'MX-MIC',
  'MX-MOR',
  'MX-NAY',
  'MX-NLE',
  'MX-OAX',
  'MX-PUE',
  'MX-QUE',
  'MX-ROO',
  'MX-SLP',
  'MX-SIN',
  'MX-SON',
  'MX-TAB',
  'MX-TAM',
  'MX-TLA',
  'MX-VER',
  'MX-YUC',
  'MX-ZAC',
]);

const ACTIVITY_BUCKETS = {
  today: 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

const matchActivity = (lastActivityAt, bucket) => {
  if (!bucket) return true;
  if (bucket === 'never') return !lastActivityAt;
  const days = ACTIVITY_BUCKETS[bucket];
  if (!days) return true;
  if (!lastActivityAt) return false;
  const ageMs = Date.now() - new Date(lastActivityAt).getTime();
  if (bucket === '90d+') return ageMs > 90 * 24 * 60 * 60 * 1000;
  return ageMs <= days * 24 * 60 * 60 * 1000;
};

const applyFilters = (entries, filters = {}) => {
  const q = (filters.q || '').trim().toLowerCase();
  const type = filters.type ? new Set(filters.type.split(',')) : null;
  const verified = filters.verified || null; // yes/no/any
  const sub = filters.sub ? new Set(filters.sub.split(',')) : null;
  const stripe = filters.stripe || null; // yes/no/any
  const legalFilter = filters.legal || null; // complete/partial/none
  const state = filters.state && MX_STATE_WHITELIST.has(filters.state) ? filters.state : null;
  const activity = filters.activity || null;

  return entries.filter(e => {
    if (q) {
      const hay = `${e.email || ''} ${e.displayName || ''} ${e.firstName || ''} ${e.lastName ||
        ''} ${e.slug || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (type && !type.has(e.type)) return false;
    if (verified === 'yes' && !e.verified) return false;
    if (verified === 'no' && e.verified) return false;
    if (sub) {
      const s = e.subscriptionStatus || 'none';
      if (!sub.has(s)) return false;
    }
    if (stripe === 'yes' && !e.stripeConnected) return false;
    if (stripe === 'no' && e.stripeConnected) return false;
    if (legalFilter) {
      const { approved, total } = e.legal;
      if (legalFilter === 'complete' && !(total > 0 && approved === total)) return false;
      if (legalFilter === 'partial' && !(approved > 0 && approved < total)) return false;
      if (legalFilter === 'none' && !(total === 0 || approved === 0)) return false;
    }
    if (state && e.state !== state) return false;
    if (activity && !matchActivity(e.lastActivityAt, activity)) return false;
    return true;
  });
};

const SORT_KEYS = {
  lastActivity: e => (e.lastActivityAt ? new Date(e.lastActivityAt).getTime() : 0),
  createdAt: e => (e.createdAt ? new Date(e.createdAt).getTime() : 0),
  gmv: e => e.sales.gmvYTD,
  listings: e => e.listings.total,
};

const applySortAndPagination = (
  entries,
  { sort = 'lastActivity', dir = 'desc', page = 1, pageSize = 50 }
) => {
  const keyFn = SORT_KEYS[sort] || SORT_KEYS.lastActivity;
  const multiplier = dir === 'asc' ? 1 : -1;
  const sorted = [...entries].sort((a, b) => (keyFn(a) - keyFn(b)) * multiplier);
  const start = (page - 1) * pageSize;
  return sorted.slice(start, start + pageSize);
};

// --------------------- facets ----------------------

const computeFacets = allEntries => {
  const byType = {};
  const byVerified = { yes: 0, no: 0 };
  const bySub = { active: 0, past_due: 0, canceled: 0, none: 0 };
  const byStripe = { yes: 0, no: 0 };
  const byLegal = { complete: 0, partial: 0, none: 0 };
  const byState = {};
  const byActivity = { today: 0, '7d': 0, '30d': 0, '90d': 0, '90d+': 0, never: 0 };

  for (const e of allEntries) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    byVerified[e.verified ? 'yes' : 'no'] += 1;
    const subKey = e.subscriptionStatus || 'none';
    if (bySub[subKey] != null) bySub[subKey] += 1;
    else bySub[subKey] = 1;
    byStripe[e.stripeConnected ? 'yes' : 'no'] += 1;
    const { approved, total } = e.legal;
    if (total === 0 || approved === 0) byLegal.none += 1;
    else if (approved < total) byLegal.partial += 1;
    else byLegal.complete += 1;
    if (e.state) byState[e.state] = (byState[e.state] || 0) + 1;
    for (const bucket of ['today', '7d', '30d', '90d', '90d+', 'never']) {
      if (matchActivity(e.lastActivityAt, bucket)) {
        byActivity[bucket] += 1;
        break;
      }
    }
  }

  return { byType, byVerified, bySub, byStripe, byLegal, byState, byActivity };
};

module.exports = {
  getSnapshot,
  invalidateSnapshot,
  applyFilters,
  applySortAndPagination,
  computeFacets,
  buildUserRosterEntry,
  classifyListingSegment,
  classifyUserType,
  legalDocsSummary,
  // exportado para tests
  CACHE_TTL_MS,
};
