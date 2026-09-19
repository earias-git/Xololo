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

const { getSdk, getTrustedSdk } = require('../api-util/sdk');

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

    const meta = tx.attributes.metadata || {};
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
    const trustedSdk = await getTrustedSdk(req);

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
      await trustedSdk.transactions.updateMetadata({
        id: transactionId,
        metadata: {
          xololoBuyerReview: review,
          xololoAcceptanceProof: acceptanceProof,
        },
      });
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
    await trustedSdk.transactions.updateMetadata({
      id: transactionId,
      metadata: {
        xololoDispute: dispute,
        xololoAcceptanceProof: acceptanceProof,
      },
    });
    return res.json({ ok: true, outcome: 'bad', acceptanceProof, dispute });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('order-survey unexpected:', e);
    return res.status(500).json({ error: 'internal' });
  }
};
