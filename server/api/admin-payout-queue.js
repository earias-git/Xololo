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
const {
  getSellerStripeAccountId,
  createPayoutTransfer,
} = require('../api-util/stripePayouts');

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

// "Pendiente" para esta cola admin = la tx no está exclu ida (refund/
// cancel/dispute), está en estado completed/delivered/reviewed Y
// todavía NO tiene un transfer exitoso. Esto incluye 2 escenarios:
//   a) Nunca liberada (xololoPayoutReleased != true)
//   b) Liberada pero el transfer real falló (released=true + transferError
//      presente + sin transferId). Importante mostrarlas también para
//      que Ops las vea y use el botón de reintento.
const isPendingPayout = tx => {
  const attrs = tx.attributes || {};
  if (EXCLUDED_STATES.has(attrs.state)) return false;
  const meta = attrs.metadata || {};
  if (meta.xololoPayoutTransferId) return false; // transfer exitoso → ya salió
  const isCompletedState =
    COMPLETED_STATES.has(attrs.state) ||
    (attrs.lastTransition && COMPLETED_TRANSITIONS.has(attrs.lastTransition));
  return isCompletedState;
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
    const bySeller = new Map(); // providerId → { count, amount, oldest, txIds, txFailedIds }
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
          agg = {
            count: 0,
            amount: 0,
            oldest: null,
            txIds: [],
            failedTxIds: [],
            lastTransferError: null,
          };
          bySeller.set(providerId, agg);
        }
        agg.count += 1;
        agg.amount += tx.attributes?.payoutTotal?.amount || 0;
        const txUuid = tx.id?.uuid || tx.id;
        agg.txIds.push(txUuid);
        const meta = tx.attributes?.metadata || {};
        if (meta.xololoPayoutReleased === true && !meta.xololoPayoutTransferId) {
          agg.failedTxIds.push(txUuid);
          if (meta.xololoPayoutTransferError) {
            agg.lastTransferError = meta.xololoPayoutTransferError;
          }
        }
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
          // Fase 3: transfers que fallaron después de release. Ops los
          // ve con un badge rojo y usa "Reintentar transfer".
          failedTransferCount: agg.failedTxIds.length,
          failedTxIds: agg.failedTxIds,
          lastTransferError: agg.lastTransferError,
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

// Trae el payoutTotal + state de una tx para validar antes de transferir.
const fetchTxForTransfer = async (isdk, txId) => {
  try {
    const resp = await isdk.transactions.show({
      id: txId,
      'fields.transaction': ['state', 'payoutTotal', 'metadata'],
    });
    return resp.data.data;
  } catch (e) {
    return null;
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

  // Resolvemos el stripeAccountId del seller UNA vez (todas sus tx van
  // al mismo destino). Si no lo tiene, igual marcamos released=true
  // pero cada tx queda con transferError 'seller_no_stripe_account'
  // para que Ops lo vea.
  const sellerStripeAccountId = await getSellerStripeAccountId(isdk, sellerId);

  const results = [];
  for (const txId of txIds) {
    const result = { txId, released: false, transferred: false, transferError: null };
    try {
      // 1) Marcar released=true (si falla, saltamos al siguiente).
      await isdk.transactions.updateMetadata({
        id: txId,
        metadata: {
          xololoPayoutReleased: true,
          xololoPayoutReleasedAt: new Date().toISOString(),
          xololoPayoutReleasedBy: admin.operatorId || null,
          xololoPayoutReleaseNote: note || null,
        },
      });
      result.released = true;

      // 2) Intentar transfer real. Validamos amount desde la tx (NO
      //    confiamos en lo que vino del cliente para evitar transfer
      //    arbitrario).
      const tx = await fetchTxForTransfer(isdk, txId);
      const amount = tx?.attributes?.payoutTotal?.amount || 0;
      const currency = tx?.attributes?.payoutTotal?.currency || 'MXN';
      const alreadyTransferred = tx?.attributes?.metadata?.xololoPayoutTransferId;
      if (alreadyTransferred) {
        result.transferred = true;
        result.transferId = alreadyTransferred;
      } else {
        const transfer = await createPayoutTransfer({
          txId,
          sellerStripeAccountId,
          amountSubunits: amount,
          currency,
          description: note ? `Xololo payout tx ${txId} — ${note}` : undefined,
        });
        if (transfer.ok) {
          await isdk.transactions.updateMetadata({
            id: txId,
            metadata: {
              xololoPayoutTransferId: transfer.transferId,
              xololoPayoutTransferredAt: new Date().toISOString(),
              xololoPayoutTransferError: null,
            },
          });
          result.transferred = true;
          result.transferId = transfer.transferId;
        } else {
          const errMsg = transfer.code + (transfer.message ? `: ${transfer.message}` : '');
          await isdk.transactions.updateMetadata({
            id: txId,
            metadata: {
              xololoPayoutTransferError: errMsg,
              xololoPayoutTransferErrorAt: new Date().toISOString(),
            },
          });
          result.transferError = errMsg;
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[admin-payout-queue] release failed for', txId, e?.message);
      result.transferError = result.transferError || e?.message || 'unknown';
    }
    results.push(result);
  }

  const releasedCount = results.filter(r => r.released).length;
  const transferredCount = results.filter(r => r.transferred).length;
  const failedCount = results.filter(r => r.released && !r.transferred).length;

  // Invalida cache para que la siguiente consulta refleje el estado.
  cache = null;
  cacheAt = 0;
  return res.json({
    ok: true,
    releasedCount,
    transferredCount,
    failedCount,
    results,
  });
};

// Reintenta el transfer para tx que ya están released=true pero el
// transfer falló (xololoPayoutTransferError existe, transferId no).
const retry = async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin.ok) return;

  const sellerId = String(req.body?.sellerId || '').trim();
  const txIds = Array.isArray(req.body?.txIds) ? req.body.txIds : [];
  if (!sellerId || !txIds.length) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  const sellerStripeAccountId = await getSellerStripeAccountId(isdk, sellerId);

  const results = [];
  for (const txId of txIds) {
    const tx = await fetchTxForTransfer(isdk, txId);
    const meta = tx?.attributes?.metadata || {};
    if (meta.xololoPayoutTransferId) {
      results.push({ txId, transferred: true, transferId: meta.xololoPayoutTransferId });
      continue;
    }
    const amount = tx?.attributes?.payoutTotal?.amount || 0;
    const currency = tx?.attributes?.payoutTotal?.currency || 'MXN';
    const transfer = await createPayoutTransfer({
      txId,
      sellerStripeAccountId,
      amountSubunits: amount,
      currency,
    });
    if (transfer.ok) {
      await isdk.transactions.updateMetadata({
        id: txId,
        metadata: {
          xololoPayoutTransferId: transfer.transferId,
          xololoPayoutTransferredAt: new Date().toISOString(),
          xololoPayoutTransferError: null,
        },
      });
      results.push({ txId, transferred: true, transferId: transfer.transferId });
    } else {
      const errMsg = transfer.code + (transfer.message ? `: ${transfer.message}` : '');
      await isdk.transactions.updateMetadata({
        id: txId,
        metadata: {
          xololoPayoutTransferError: errMsg,
          xololoPayoutTransferErrorAt: new Date().toISOString(),
        },
      });
      results.push({ txId, transferred: false, transferError: errMsg });
    }
  }

  cache = null;
  cacheAt = 0;
  return res.json({
    ok: true,
    transferredCount: results.filter(r => r.transferred).length,
    failedCount: results.filter(r => !r.transferred).length,
    results,
  });
};

module.exports = { list, release, retry };
