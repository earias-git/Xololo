// XOLOLO: endpoints ligeros para marcar sub-pasos del flujo de
// fulfillment que NO transicionan la tx en Sharetribe, sólo escriben
// flags con timestamp en tx.metadata.xoloFlow. La UI los usa para
// pintar el timeline "Preparando → Listo → En camino → Entregado".
//
// Contratos comunes:
//   POST /api/tx/mark-ready       Body: { transactionId }
//   POST /api/tx/mark-dispatched  Body: { transactionId }
//
//   200 → { ok: true, at }
//   400 → { error: 'invalid_request' }
//   401 → { error: 'unauthorized' }
//   404 → { error: 'transaction_not_found' }
//   409 → { error: 'not_applicable_mode' | 'already_set' | 'not_authorized_yet' }
//   500 → { error: 'internal' }
//
// Reglas:
// - Sólo el provider (seller) puede llamarlos.
// - `mark-ready`: aplica a pickup, localDelivery y freight (marca que
//   el producto físicamente ya está listo para su entrega/recolección).
//   No aplica a Skydropx (ahí "listo" equivale a "guía generada"; ver
//   generate-shipping-guide.js).
// - `mark-dispatched`: aplica a localDelivery, carrier (Skydropx) y
//   freight. No aplica a pickup (el buyer va al seller). En freight,
//   además requiere que el buyer haya autorizado el pago del envío
//   (buyerAuthorizedAt set) — si no, 409 not_authorized_yet.
// - Idempotencia: una vez set, no se puede volver a setear (409
//   already_set). El seller reincidiría por accidente si no.

const { getSdk } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');

const MODES_READY = ['pickup', 'localDelivery', 'freight'];
const MODES_DISPATCHED = ['localDelivery', 'carrier', 'freight'];

// Helper: valida sesión + ownership + carga tx. Devuelve
// { tx, xShipping, currentUserId } o responde con error y retorna null.
const loadTxForProvider = async (req, res) => {
  const { transactionId } = req.body || {};
  if (!transactionId || typeof transactionId !== 'string') {
    res.status(400).json({ error: 'invalid_request', details: 'transactionId requerido.' });
    return null;
  }

  const sdk = getSdk(req, res);
  let currentUserResp;
  try {
    currentUserResp = await sdk.currentUser.show();
  } catch (e) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  const currentUserId = currentUserResp.data.data.id.uuid;

  let txResp;
  try {
    txResp = await sdk.transactions.show({
      id: transactionId,
      include: ['provider'],
    });
  } catch (e) {
    if (e.status === 404) {
      res.status(404).json({ error: 'transaction_not_found' });
      return null;
    }
    throw e;
  }
  const tx = txResp.data.data;
  const providerId = tx.relationships?.provider?.data?.id?.uuid;
  if (providerId !== currentUserId) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }

  const xShipping = tx.attributes.protectedData?.xololoShipping || {};
  return { tx, transactionId, xShipping, currentUserId };
};

// Merge inmutable de xoloFlow — leemos el actual (puede ser undefined),
// aplicamos el patch y lo devolvemos completo para escribir a metadata.
const mergeFlow = (tx, patch) => {
  const current = tx.attributes.metadata?.xoloFlow || {};
  return { ...current, ...patch };
};

const markReady = async (req, res) => {
  try {
    const ctx = await loadTxForProvider(req, res);
    if (!ctx) return;
    const { transactionId, tx, xShipping, currentUserId } = ctx;

    if (!MODES_READY.includes(xShipping.mode)) {
      return res.status(409).json({ error: 'not_applicable_mode' });
    }
    const currentFlow = tx.attributes.metadata?.xoloFlow || {};
    if (currentFlow.readyAt) {
      return res.status(409).json({ error: 'already_set' });
    }

    const isdk = getIntegrationSdk();
    if (!isdk) {
      // eslint-disable-next-line no-console
      console.error('[tx-flow.markReady] Integration SDK no configurado');
      return res.status(500).json({ error: 'internal' });
    }

    const nowIso = new Date().toISOString();
    const xoloFlow = mergeFlow(tx, { readyAt: nowIso, readyBy: currentUserId });
    await isdk.transactions.updateMetadata({
      id: transactionId,
      metadata: { xoloFlow },
    });
    return res.json({ ok: true, at: nowIso });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('tx-flow.markReady unexpected:', e);
    return res.status(500).json({ error: 'internal' });
  }
};

const markDispatched = async (req, res) => {
  try {
    const ctx = await loadTxForProvider(req, res);
    if (!ctx) return;
    const { transactionId, tx, xShipping, currentUserId } = ctx;

    if (!MODES_DISPATCHED.includes(xShipping.mode)) {
      return res.status(409).json({ error: 'not_applicable_mode' });
    }
    const currentFlow = tx.attributes.metadata?.xoloFlow || {};
    if (currentFlow.dispatchedAt) {
      return res.status(409).json({ error: 'already_set' });
    }
    // En freight, el buyer debe haber autorizado el pago del envío
    // antes de que el seller pueda marcar despachado. `buyerAuthorizedAt`
    // vive en tx.metadata.xoloFreight (lo escribe el webhook Stripe
    // billing cuando llega payment_intent.succeeded), NO en
    // protectedData.xololoShipping.
    if (xShipping.mode === 'freight') {
      const currentFreight = tx.attributes.metadata?.xoloFreight || {};
      if (!currentFreight.buyerAuthorizedAt) {
        return res.status(409).json({ error: 'not_authorized_yet' });
      }
    }

    const isdk = getIntegrationSdk();
    if (!isdk) {
      // eslint-disable-next-line no-console
      console.error('[tx-flow.markDispatched] Integration SDK no configurado');
      return res.status(500).json({ error: 'internal' });
    }

    const nowIso = new Date().toISOString();
    const xoloFlow = mergeFlow(tx, { dispatchedAt: nowIso, dispatchedBy: currentUserId });
    await isdk.transactions.updateMetadata({
      id: transactionId,
      metadata: { xoloFlow },
    });

    // XOLOLO Fase 1B: si es freight con capture_method=manual, el PI
    // está en estado requires_capture esperando que marquemos despacho
    // para cobrar realmente. Lo capturamos aquí. Para tx viejas con
    // auto-captura, el PI ya está en succeeded y el capture es un
    // no-op idempotente.
    if (xShipping.mode === 'freight') {
      try {
        const { captureFreightPi } = require('./freight');
        const result = await captureFreightPi(transactionId);
        if (!result.ok && result.error !== 'pi_not_capturable') {
          // eslint-disable-next-line no-console
          console.error(
            `[tx-flow.markDispatched] captura PI freight tx=${transactionId}:`,
            result.error
          );
          // No bloqueamos el markDispatched — la bandera ya quedó
          // guardada. Operator puede revisar el PI manualmente si falló.
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(
          `[tx-flow.markDispatched] captureFreightPi threw tx=${transactionId}:`,
          e.message
        );
      }
    }

    return res.json({ ok: true, at: nowIso });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('tx-flow.markDispatched unexpected:', e);
    return res.status(500).json({ error: 'internal' });
  }
};

module.exports = { markReady, markDispatched };
