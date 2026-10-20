// XOLOLO Track #27 Fase 2: cola de sellers con dinero retenido en Xololo.
//
// Para Ops: ver quiénes esperan pago y qué les falta cerrar (Stripe,
// docs, o ambos). Permite priorizar seguimiento y detectar sellers
// olvidados con dinero esperando sin que ellos lo sepan.
//
// Endpoints:
//   GET /api/admin/payout-queue
//     200 → {
//       items: [{
//         sellerId, sellerName, sellerEmail, sellerMode,
//         pendingCount, pendingAmountSubunits, oldestPendingAt,
//         stripeConnected, legalDocsComplete, canReceivePayout,
//         blockers: ['stripe', 'legalDocs'],
//       }],
//       totalPending: number,          // suma total global
//       cached: boolean,
//     }
//
//   POST /api/admin/payout-queue/release
//     Body: { sellerId, txIds: Array<string>, note?: string }
//     Marca las tx como `xololoPayoutReleased=true` (metadata), queda
//     listas para procesar el transfer real desde Stripe dashboard o
//     con un script futuro. NO ejecuta el transfer todavía — fase 3.
//     200 → { ok: true, releasedCount }
//     400 → { error: 'invalid_request' }
//
// Implementación bruta a propósito: paginar tx completadas filtrando por
// la metadata, agrupar por providerId, resolver perfil + gate por seller.
// Volumen esperado al inicio: decenas de sellers con pendientes. Cuando
// crezca se agrega índice/materialized view.

const { requireAdmin } = require('../api-util/adminGate');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { slotsForPersonType } = require('../api-util/legalDocSlots');

const CACHE_TTL_MS = 60 * 1000; // 1 min — datos de dinero esperando.
let cache = null;
let cacheAt = 0;

const COMPLETED_STATES = new Set(['completed', 'delivered', 'reviewed']);
const COMPLETED_TRANSITIONS = new Set([
  'transition/complete',
  'transition/mark-delivered',
  'transition/mark-received',
  'transition/review-1-by-provider',
  'transition/review-1-by-customer',
  'transition/review-2-by-provider',
  'transition/review-2-by-customer',
  'transition/expire-review-period',
]);
const EXCLUDED_STATES = new Set(['canceled', 'refunded', 'disputed']);

const isPendingPayout = tx => {
  const attrs = tx.attributes || {};
  if (EXCLUDED_STATES.has(attrs.state)) return false;
  const meta = attrs.metadata || {};
  if (meta.xololoPayoutReleased === true) return false;
  if (COMPLETED_STATES.has(attrs.state)) return true;
  if (attrs.lastTransition && COMPLETED_TRANSITIONS.has(attrs.lastTransition)) return true;
  return false;
};

const isLegalDocsComplete = (personType, docs, sellerMode) => {
  if (!personType) return false;
  const required = slotsForPersonType(personType, sellerMode);
  if (!required.length) return false;
  return required.every(slot => !!docs?.[slot.key]);
};

const MAX_PAGES = 20;
const PER_PAGE = 100;

const list = async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin.ok) return;

  if (cache && Date.now() - cacheAt < CACHE_TTL_MS) {
    return res.json({ ...cache, cached: true });
  }

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    // 1) Barremos todas las tx completadas-y-no-liberadas.
    const bySeller = new Map(); // providerId → { count, amount, oldest, txIds }
    for (let page = 1; page <= MAX_PAGES; page++) {
      const resp = await isdk.transactions.query({
        page,
        perPage: PER_PAGE,
        include: ['provider'],
        'fields.transaction': [
          'lastTransitionedAt',
          'state',
          'lastTransition',
          'payoutTotal',
          'metadata',
        ],
      });
      const data = resp.data.data || [];
      for (const tx of data) {
        if (!isPendingPayout(tx)) continue;
        const providerId = tx.relationships?.provider?.data?.id?.uuid;
        if (!providerId) continue;
        let agg = bySeller.get(providerId);
        if (!agg) {
          agg = { count: 0, amount: 0, oldest: null, txIds: [] };
          bySeller.set(providerId, agg);
        }
        agg.count += 1;
        agg.amount += tx.attributes?.payoutTotal?.amount || 0;
        agg.txIds.push(tx.id?.uuid || tx.id);
        const t = tx.attributes?.lastTransitionedAt;
        if (t && (!agg.oldest || new Date(t) < new Date(agg.oldest))) {
          agg.oldest = t;
        }
      }
      const totalPages = resp.data.meta?.totalPages || 1;
      if (page >= totalPages) break;
    }

    // 2) Resolvemos el perfil + gate de cada seller con pendientes.
    const items = [];
    let totalPending = 0;
    for (const [sellerId, agg] of bySeller.entries()) {
      try {
        const uResp = await isdk.users.show({ id: sellerId });
        const u = uResp.data.data;
        const profile = u.attributes?.profile || {};
        const legalDocs = profile.metadata?.xololoLegalDocs || {};
        const sellerMode = profile.publicData?.sellerMode || 'store';
        const stripeConnected = u.attributes?.stripeConnected === true;
        const legalDocsComplete = isLegalDocsComplete(
          legalDocs.personType || null,
          legalDocs.docs || {},
          sellerMode
        );
        const canReceivePayout = stripeConnected && legalDocsComplete;
        const blockers = [];
        if (!stripeConnected) blockers.push('stripe');
        if (!legalDocsComplete) blockers.push('legalDocs');

        totalPending += agg.amount;
        items.push({
          sellerId,
          sellerName: profile.displayName || profile.firstName || '',
          sellerEmail: u.attributes?.email || null,
          sellerMode,
          pendingCount: agg.count,
          pendingAmountSubunits: agg.amount,
          oldestPendingAt: agg.oldest,
          stripeConnected,
          legalDocsComplete,
          canReceivePayout,
          blockers,
          txIds: agg.txIds,
        });
      } catch (e) {
        // Un seller cuyo show falla no bloquea el resto de la cola.
        // eslint-disable-next-line no-console
        console.warn('[admin-payout-queue] user.show failed for', sellerId, e?.message);
      }
    }

    // Orden: primero los que YA pueden recibir (listos para procesar),
    // después los que tienen más dinero esperando.
    items.sort((a, b) => {
      if (a.canReceivePayout !== b.canReceivePayout) {
        return a.canReceivePayout ? -1 : 1;
      }
      return b.pendingAmountSubunits - a.pendingAmountSubunits;
    });

    cache = { items, totalPending };
    cacheAt = Date.now();
    return res.json({ items, totalPending, cached: false });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[admin-payout-queue] list error:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

const release = async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin.ok) return;

  const sellerId = String(req.body?.sellerId || '').trim();
  const txIds = Array.isArray(req.body?.txIds) ? req.body.txIds : [];
  const note = String(req.body?.note || '').slice(0, 500);
  if (!sellerId || !txIds.length) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  let releasedCount = 0;
  try {
    for (const txId of txIds) {
      try {
        // XOLOLO: marcar metadata. Esto NO ejecuta el transfer — es un
        // flag que la contabilidad usa para liberar manualmente desde
        // Stripe dashboard. En Fase 3, un cron hará el transfer real.
        await isdk.transactions.updateMetadata({
          id: txId,
          metadata: {
            xololoPayoutReleased: true,
            xololoPayoutReleasedAt: new Date().toISOString(),
            xololoPayoutReleasedBy: admin.operatorId || null,
            xololoPayoutReleaseNote: note || null,
          },
        });
        releasedCount += 1;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[admin-payout-queue] release failed for', txId, e?.message);
      }
    }
    // Invalida cache para que la siguiente consulta refleje la liberación.
    cache = null;
    cacheAt = 0;
    return res.json({ ok: true, releasedCount });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[admin-payout-queue] release error:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

module.exports = { list, release };
