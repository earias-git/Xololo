// XOLOLO: endpoint que recibe la respuesta de la encuesta post-entrega
// del buyer. Ver docs/LOGISTICS_V1.md §4.
//
// Contrato:
//   POST /api/order-survey
//   Body: { transactionId, outcome: 'good' | 'bad', rating?, comment?, issueDetail? }
//   200 → { ok: true, outcome, acceptanceProof }
//   400 → { error: 'invalid_request', details }
//   401 → { error: 'unauthorized' }
//   403 → { error: 'not_customer' }
//   404 → { error: 'transaction_not_found' }
//   409 → { error: 'already_reviewed' | 'not_delivered' }
//   500 → { error: 'internal' }
//
// Reglas:
// - Solo el CUSTOMER (buyer) puede llamar.
// - La orden debe estar entregada (xShipping.currentStatus === 'delivered'
//   o transición transition/mark-delivered en la tx).
// - No permite doble review.
//
// Efectos:
// - 'good': guarda review en tx.metadata.xololoBuyerReview + acceptanceProof
//   type='explicit'. En v2 dispararemos aquí la transition/complete que
//   libera fondos al seller.
// - 'bad':  guarda disputa en tx.metadata.xololoDispute + acceptanceProof
//   type='disputed'. Los fondos quedan congelados (Xololo revisa <72h).
//   En v2 disparará una transition/dispute custom.

const { getSdk } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { sendEventNotifications } = require('../api-util/notifications');
const { buildTxContext } = require('../api-util/notifications/context');

module.exports = async (req, res) => {
  try {
    const { transactionId, outcome, rating, comment, issueDetail } = req.body || {};

    if (!transactionId || typeof transactionId !== 'string') {
      return res.status(400).json({ error: 'invalid_request', details: 'transactionId requerido.' });
    }
    if (outcome !== 'good' && outcome !== 'bad') {
      return res.status(400).json({ error: 'invalid_request', details: 'outcome debe ser good|bad.' });
    }
    if (outcome === 'good') {
      const r = Number(rating);
      if (!Number.isFinite(r) || r < 1 || r > 5) {
        return res.status(400).json({ error: 'invalid_request', details: 'rating debe ser 1-5.' });
      }
    }
    if (outcome === 'bad') {
      if (!issueDetail || String(issueDetail).trim().length < 10) {
        return res.status(400).json({
          error: 'invalid_request',
          details: 'issueDetail requerido (mínimo 10 caracteres).',
        });
      }
    }

    const sdk = getSdk(req, res);

    let currentUserResp;
    try {
      currentUserResp = await sdk.currentUser.show();
    } catch (e) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const currentUserId = currentUserResp.data.data.id.uuid;

    let txResp;
    try {
      txResp = await sdk.transactions.show({
        id: transactionId,
        include: ['customer'],
      });
    } catch (e) {
      if (e.status === 404) return res.status(404).json({ error: 'transaction_not_found' });
      throw e;
    }
    const tx = txResp.data.data;
    const customerId = tx.relationships?.customer?.data?.id?.uuid;
    if (customerId !== currentUserId) {
      return res.status(403).json({ error: 'not_customer' });
    }

    // metadata sólo es visible al operator (Integration API). El sdk
    // normal del buyer devolvería metadata:undefined y "already_reviewed"
    // nunca se dispararía → doble review posible. Leemos vía Integration
    // SDK para validar y también para escribir después.
    const isdk = getIntegrationSdk();
    if (!isdk) {
      // eslint-disable-next-line no-console
      console.error('[order-survey] Integration SDK no configurado');
      return res.status(500).json({ error: 'internal' });
    }
    let meta = {};
    try {
      const opTxResp = await isdk.transactions.show({ id: transactionId });
      meta = opTxResp.data.data.attributes.metadata || {};
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[order-survey] integration tx.show falló', e?.message);
      return res.status(500).json({ error: 'internal' });
    }
    if (meta.xololoBuyerReview || meta.xololoDispute) {
      return res.status(409).json({
        error: 'already_reviewed',
        details: 'Esta orden ya tiene una respuesta registrada.',
      });
    }

    // Validar que la orden está entregada. Se detecta si:
    // - Sharetribe registró una transición transition/mark-delivered, O
    // - El webhook Skydropx registró un evento con status 'delivered'.
    const transitions = tx.attributes.transitions || [];
    const wasDeliveredByTx = transitions.some(t => t.transition === 'transition/mark-delivered');
    const trackingEvents = meta.xololoShippingTrackingEvents || [];
    const wasDeliveredByWebhook = trackingEvents.some(e => e.status === 'delivered');
    if (!wasDeliveredByTx && !wasDeliveredByWebhook) {
      return res.status(409).json({
        error: 'not_delivered',
        details: 'La orden aún no ha sido marcada como entregada.',
      });
    }

    const nowIso = new Date().toISOString();

    if (outcome === 'good') {
      const review = {
        rating: Number(rating),
        comment: String(comment || '').slice(0, 500),
        submittedAt: nowIso,
        submittedBy: currentUserId,
      };
      const acceptanceProof = {
        type: 'explicit',
        acceptedAt: nowIso,
        acceptedBy: currentUserId,
        method: 'post_delivery_survey',
      };
      await isdk.transactions.updateMetadata({
        id: transactionId,
        metadata: {
          xololoBuyerReview: review,
          xololoAcceptanceProof: acceptanceProof,
        },
      });

      // XOLOLO: además de guardar la evidencia, disparamos la transición
      // MARK_RECEIVED del proceso Sharetribe para avanzar la orden. Sin
      // esto la tx queda estancada en DELIVERED — no hay botón "Recibí"
      // manual del buyer (ver stateDataPurchase.js). Fallamos silente si
      // la transición no aplica (state ya cambiado, etc.) porque la
      // review ya se guardó y es lo importante.
      try {
        await isdk.transactions.transition({
          id: transactionId,
          transition: 'transition/mark-received',
          params: {},
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(
          `[order-survey] transition mark-received falló para ${transactionId}:`,
          e?.data?.errors || e?.message
        );
      }

      return res.json({ ok: true, outcome: 'good', acceptanceProof });
    }

    // outcome === 'bad'
    const dispute = {
      openedAt: nowIso,
      openedBy: currentUserId,
      issueDetail: String(issueDetail || '').slice(0, 1000),
      status: 'pending_review',
      xololoAssignee: null, // se asigna al triaging en el dashboard interno
    };
    const acceptanceProof = {
      type: 'disputed',
      disputedAt: nowIso,
      method: 'post_delivery_survey',
    };
    await isdk.transactions.updateMetadata({
      id: transactionId,
      metadata: {
        xololoDispute: dispute,
        xololoAcceptanceProof: acceptanceProof,
      },
    });

    // XOLOLO D.9: notificar disputa a ambos (buyer confirm + seller
    // heads-up). Fire-and-forget: el buyer ya recibió su response 200.
    (async () => {
      try {
        const fresh = await isdk.transactions.show({ id: transactionId });
        const context = await buildTxContext(isdk, fresh.data.data, {
          dispute: {
            issueDetail: dispute.issueDetail,
            openedAt: dispute.openedAt,
          },
        });
        await sendEventNotifications('order.dispute_opened', context);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[order-survey] notify error:', err?.message);
      }
    })();

    return res.json({ ok: true, outcome: 'bad', acceptanceProof, dispute });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('order-survey unexpected:', e);
    return res.status(500).json({ error: 'internal' });
  }
};
