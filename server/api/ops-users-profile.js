// XOLOLO OPS Users 360 · Fase A — perfil consolidado de un user para el
// drawer drilldown de la vista /ops/users.
//
// GET /api/admin/ops/users/:userId/profile
//   200 → {
//     user,                 // RosterEntry + email + displayName + ...
//     raw: { attributes, profile }, // snapshot crudo útil para debug ops
//     listings: [{ id, title, state, segment, category, price, address,
//                   views, salesCount, createdAt }],
//     transactions: [{ id, role, counterpartyId, counterpartyName,
//                       listingId, listingTitle, state, lastTransition,
//                       amount, currency, createdAt, lastTransitionedAt }],
//     subscription: { status, currentPeriodEnd, cancelAt, invoiceHistory },
//     legalDocs: { personType, slots: [{key, status, uploadedAt, approvedAt, rejectionReason}] },
//     flags: [{ key, severity, reason, raisedAt }],
//     actionsHistory: [...]  // vacío en v1 — reservado para fase C.
//   }

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const {
  classifyListingSegment,
  classifyUserType,
  legalDocsSummary,
} = require('../api-util/opsUsersRoster');
const { getAdminEmails } = require('../api-util/adminGate');
const { readOpsBlock } = require('../api-util/opsAudit');

const MAX_LISTINGS = 200;
const MAX_TX_LISTED = 100;

const safeNumber = n => {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
};

const buildListingSummary = l => {
  const attrs = l.attributes || {};
  const pd = attrs.publicData || {};
  const md = attrs.metadata || {};
  const price = attrs.price || null;
  return {
    id: l.id?.uuid || null,
    title: attrs.title || null,
    state: attrs.state || null,
    segment: classifyListingSegment(l),
    categoryLevel1: pd.categoryLevel1 || pd.category || null,
    categoryLevel2: pd.categoryLevel2 || null,
    unitType: pd.unitType || null,
    condition: pd.condition || null,
    price: price ? { amount: price.amount, currency: price.currency } : null,
    address: {
      state: pd.pickupAddress?.area_level1 || pd.commercialAddress?.area_level1 || null,
      city: pd.pickupAddress?.area_level2 || pd.commercialAddress?.area_level2 || null,
    },
    views: safeNumber(md.xololoAnalytics?.views?.total || md.xololoAnalytics?.totals?.views),
    createdAt: attrs.createdAt || null,
  };
};

const buildTxSummary = (tx, userId, included = []) => {
  const attrs = tx.attributes || {};
  const rel = tx.relationships || {};
  const providerId = rel.provider?.data?.id?.uuid || null;
  const customerId = rel.customer?.data?.id?.uuid || null;
  const listingId = rel.listing?.data?.id?.uuid || null;
  const role = providerId === userId ? 'sold' : customerId === userId ? 'bought' : 'other';
  const counterpartyId = role === 'sold' ? customerId : providerId;
  const counterpartyEntity = included.find(i => i.type === 'user' && i.id?.uuid === counterpartyId);
  const listingEntity = included.find(i => i.type === 'listing' && i.id?.uuid === listingId);
  const payin = attrs.payinTotal;
  return {
    id: tx.id?.uuid || null,
    role,
    counterpartyId,
    counterpartyName: counterpartyEntity?.attributes?.profile?.displayName || null,
    listingId,
    listingTitle: listingEntity?.attributes?.title || null,
    state: attrs.state || null,
    lastTransition: attrs.lastTransition || null,
    amount: payin ? payin.amount / 100 : null,
    currency: payin?.currency || null,
    createdAt: attrs.createdAt || null,
    lastTransitionedAt: attrs.lastTransitionedAt || null,
  };
};

const buildFlags = user => {
  const pd = user.attributes?.profile?.publicData || {};
  const md = user.attributes?.profile?.metadata || {};
  const flags = [];
  const legal = md.xololoLegalDocs || {};
  const docs = legal.docs || {};

  // Pending legal docs > 7d
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  for (const [slot, info] of Object.entries(docs)) {
    if (info?.status === 'pending' && info?.uploadedAt) {
      const age = Date.now() - new Date(info.uploadedAt).getTime();
      if (age > SEVEN_DAYS_MS) {
        flags.push({
          key: 'legal_doc_stuck',
          severity: 'warn',
          reason: `Doc ${slot} pendiente desde hace ${Math.floor(age / 86_400_000)} días.`,
          raisedAt: info.uploadedAt,
        });
      }
    }
    if (info?.status === 'rejected') {
      flags.push({
        key: 'legal_doc_rejected',
        severity: 'info',
        reason: `Doc ${slot} rechazado (${info.rejectionReason || 'sin motivo'}).`,
        raisedAt: info.rejectedAt || info.updatedAt || null,
      });
    }
  }

  const sub = md.xololoSubscription || {};
  if (sub.status === 'past_due') {
    flags.push({
      key: 'subscription_past_due',
      severity: 'error',
      reason: `Suscripción vencida (último intento ${sub.lastInvoiceAt || 'desconocido'}).`,
      raisedAt: sub.updatedAt || null,
    });
  }
  if (sub.status === 'canceled') {
    flags.push({
      key: 'subscription_canceled',
      severity: 'info',
      reason: 'Suscripción cancelada.',
      raisedAt: sub.canceledAt || null,
    });
  }

  if (pd.xololoVerified === true && (!md.xololoSubscription || sub.status !== 'active')) {
    // Un Verified sin sub activa es sospechoso — necesita re-sync del badge.
    const sellerMode = pd.sellerMode;
    if (sellerMode !== 'casual_reseller') {
      flags.push({
        key: 'verified_without_active_sub',
        severity: 'warn',
        reason: 'Badge Verified activo pero suscripción no está active. Correr re-sync.',
        raisedAt: null,
      });
    }
  }

  const tax = md.xololoTaxReview || pd.xololoTaxReview;
  if (tax?.status === 'pending') {
    flags.push({
      key: 'tax_review_pending',
      severity: 'info',
      reason: 'Clasificación fiscal declarada por el seller esperando revisión.',
      raisedAt: tax.submittedAt || null,
    });
  }

  return flags;
};

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const userId = req.params?.userId;
  if (!userId) return res.status(400).json({ error: 'invalid_request' });

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    // 1) user
    const userResp = await isdk.users.show({
      id: userId,
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
    const user = userResp.data.data;
    if (!user) return res.status(404).json({ error: 'user_not_found' });

    // 2) listings del user (como author)
    const listings = [];
    for (let page = 1; page <= Math.ceil(MAX_LISTINGS / 100); page++) {
      const lResp = await isdk.listings.query({
        authorId: userId,
        page,
        perPage: 100,
        'fields.listing': ['title', 'state', 'createdAt', 'price', 'publicData', 'metadata'],
      });
      listings.push(...(lResp.data.data || []));
      const totalPages = lResp.data.meta?.totalPages || 1;
      if (page >= totalPages) break;
    }

    // 3) transactions donde el user es customer o provider.
    // Integration SDK no soporta OR nativo entre userId.customer/provider,
    // así que hacemos dos queries y mergeamos. Para no explotar en
    // volumen, limitamos a 100 txs en total ordenadas desc.
    const [asCustomer, asProvider] = await Promise.all([
      isdk.transactions.query({
        customerId: userId,
        page: 1,
        perPage: MAX_TX_LISTED,
        include: ['listing', 'customer', 'provider'],
        'fields.transaction': [
          'state',
          'lastTransition',
          'createdAt',
          'lastTransitionedAt',
          'payinTotal',
        ],
      }),
      isdk.transactions.query({
        providerId: userId,
        page: 1,
        perPage: MAX_TX_LISTED,
        include: ['listing', 'customer', 'provider'],
        'fields.transaction': [
          'state',
          'lastTransition',
          'createdAt',
          'lastTransitionedAt',
          'payinTotal',
        ],
      }),
    ]);

    const txMap = new Map();
    const incMap = new Map();
    for (const resp of [asCustomer, asProvider]) {
      for (const tx of resp.data.data || []) txMap.set(tx.id?.uuid, tx);
      for (const inc of resp.data.included || []) {
        const k = `${inc.type}:${inc.id?.uuid}`;
        if (!incMap.has(k)) incMap.set(k, inc);
      }
    }
    const txs = [...txMap.values()]
      .sort((a, b) => {
        const da = new Date(a.attributes?.createdAt || 0).getTime();
        const db = new Date(b.attributes?.createdAt || 0).getTime();
        return db - da;
      })
      .slice(0, MAX_TX_LISTED);
    const included = [...incMap.values()];

    // 4) armar entry resumen tipo roster (reusable en el header del drawer)
    const salesCount = txs.filter(tx => tx.relationships?.provider?.data?.id?.uuid === userId)
      .length;
    const purchasesCount = txs.filter(tx => tx.relationships?.customer?.data?.id?.uuid === userId)
      .length;
    const summary = {
      id: userId,
      email: user.attributes?.email || null,
      displayName: user.attributes?.profile?.displayName || null,
      firstName: user.attributes?.profile?.firstName || null,
      lastName: user.attributes?.profile?.lastName || null,
      createdAt: user.attributes?.createdAt || null,
      stripeConnected: user.attributes?.stripeConnected === true,
      type: classifyUserType(user, {
        adminEmails: getAdminEmails(),
        listingCount: listings.length,
        hasPurchases: purchasesCount > 0,
      }),
      verified: user.attributes?.profile?.publicData?.xololoVerified === true,
      verifiedAt: user.attributes?.profile?.publicData?.xololoVerifiedAt || null,
      slug: user.attributes?.profile?.publicData?.slug || null,
      sellerMode: user.attributes?.profile?.publicData?.sellerMode || null,
      lastSeenAt: user.attributes?.profile?.metadata?.xololoActivity?.lastSeenAt || null,
    };

    const subMeta = user.attributes?.profile?.metadata?.xololoSubscription || null;
    const subscription = subMeta
      ? {
          status: subMeta.status || null,
          currentPeriodEnd: subMeta.currentPeriodEnd || null,
          cancelAt: subMeta.cancelAt || null,
          lastInvoiceAt: subMeta.lastInvoiceAt || null,
          plan: subMeta.plan || null,
        }
      : null;

    const legal = user.attributes?.profile?.metadata?.xololoLegalDocs || {};
    const legalDocs = {
      personType: legal.personType || null,
      summary: legalDocsSummary(user.attributes?.profile?.metadata),
      slots: Object.entries(legal.docs || {}).map(([key, info]) => ({
        key,
        status: info?.status || 'missing',
        uploadedAt: info?.uploadedAt || null,
        approvedAt: info?.approvedAt || null,
        rejectedAt: info?.rejectedAt || null,
        rejectionReason: info?.rejectionReason || null,
        url: info?.url || null,
      })),
    };

    const ops = readOpsBlock(user);
    return res.json({
      summary,
      listings: listings.map(buildListingSummary),
      transactions: txs.map(tx => buildTxSummary(tx, userId, included)),
      subscription,
      legalDocs,
      flags: buildFlags(user),
      notes: ops.notes || [],
      auditLog: ops.audit || [],
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[ops-users-profile] error:', e?.message || e);
    if (e?.status === 404) return res.status(404).json({ error: 'user_not_found' });
    return res.status(500).json({ error: 'internal' });
  }
};
