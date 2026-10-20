// XOLOLO Track #27 Fase 2: lista de ventas del seller con dinero
// retenido en Xololo pendiente de liberación.
//
// Contrato:
//   GET /api/seller-pending-payouts
//   Auth: user logueado. Devuelve SOLO sus propias tx retenidas.
//   200 → {
//     pendingCount: number,            // cantidad de tx retenidas
//     pendingAmountSubunits: number,   // suma de payoutTotal en centavos
//     currency: 'MXN',
//     oldestPendingAt: 'ISO' | null,   // la más vieja (para mensaje de urgencia)
//     canReceivePayout: boolean,       // mismo flag que el gate
//     txIds: Array<string>,            // uuids de las tx (para debugging / vista admin)
//   }
//   401 → { error: 'unauthorized' }
//
// Reglas:
//   - Tx "pendiente de payout" = state 'completed' O lastTransition de
//     entrega/complete, Y NO está marcada `xololoPayoutReleased=true`.
//   - Si el seller YA puede recibir (canReceivePayout=true), igual
//     devolvemos el conteo + monto por si Ops aún no procesó el batch.
//
// Rationale: alimenta el PayoutGateBanner con una cifra concreta
// ("$450 esperando") en vez de un mensaje vacío. Más motivador para
// cerrar el gate.

const { getSdk } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { slotsForPersonType } = require('../api-util/legalDocSlots');

// Estados y transiciones que consideramos "venta cerrada y dinero
// retenido". Mantenemos conservador: sólo lo que el buyer confirmó o
// la plataforma marcó entregado. Un refund/cancel saca la tx del cómputo.
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

const fetchSellerCompletedSales = async (isdk, sellerId) => {
  const all = [];
  // Hasta 5 páginas × 100 = 500 tx máximo. Casual puro no debería
  // superar esto en producción; si lo hace, iteramos.
  for (let page = 1; page <= 5; page++) {
    const resp = await isdk.transactions.query({
      providerId: sellerId,
      page,
      perPage: 100,
      'fields.transaction': [
        'createdAt',
        'lastTransitionedAt',
        'state',
        'lastTransition',
        'payoutTotal',
        'metadata',
      ],
    });
    const data = resp.data.data || [];
    all.push(...data);
    const totalPages = resp.data.meta?.totalPages || 1;
    if (page >= totalPages) break;
  }
  return all;
};

const isLegalDocsComplete = (personType, docs, sellerMode) => {
  if (!personType) return false;
  const required = slotsForPersonType(personType, sellerMode);
  if (!required.length) return false;
  return required.every(slot => !!docs?.[slot.key]);
};

const getStatus = async (req, res) => {
  let sellerId;
  let stripeConnected = false;
  try {
    const sdk = getSdk(req, res);
    const uResp = await sdk.currentUser.show();
    sellerId = uResp.data.data.id.uuid;
    stripeConnected = uResp.data.data.attributes?.stripeConnected === true;
  } catch (e) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    // Perfil completo para calcular canReceivePayout (misma lógica que
    // seller-payout-gate — podríamos extraer a util compartido en Fase 3).
    const uShow = await isdk.users.show({ id: sellerId });
    const profile = uShow.data.data.attributes?.profile || {};
    const legalDocs = profile.metadata?.xololoLegalDocs || {};
    const sellerMode = profile.publicData?.sellerMode || 'store';
    const legalDocsComplete = isLegalDocsComplete(
      legalDocs.personType || null,
      legalDocs.docs || {},
      sellerMode
    );
    const canReceivePayout = stripeConnected && legalDocsComplete;

    const txs = await fetchSellerCompletedSales(isdk, sellerId);
    const pending = txs.filter(isPendingPayout);

    let pendingAmountSubunits = 0;
    let oldestPendingAt = null;
    const txIds = [];
    for (const tx of pending) {
      pendingAmountSubunits += tx.attributes?.payoutTotal?.amount || 0;
      txIds.push(tx.id?.uuid || tx.id);
      const transitionedAt = tx.attributes?.lastTransitionedAt;
      if (transitionedAt) {
        if (!oldestPendingAt || new Date(transitionedAt) < new Date(oldestPendingAt)) {
          oldestPendingAt = transitionedAt;
        }
      }
    }

    return res.json({
      pendingCount: pending.length,
      pendingAmountSubunits,
      currency: 'MXN',
      oldestPendingAt,
      canReceivePayout,
      txIds,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[seller-pending-payouts] get error:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

module.exports = (req, res) => {
  if (req.method === 'GET') return getStatus(req, res);
  res.status(405).json({ error: 'method_not_allowed' });
};
