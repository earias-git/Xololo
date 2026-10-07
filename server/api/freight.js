// XOLOLO Envíos v2 · modo freight: cotización del envío por el seller
// y cobro secundario del envío por PaymentIntent en la misma cuenta
// Stripe que usamos para billing (compartida con Connect — ver
// server/api-util/stripeBilling.js §3-5).
//
// Flujo end-to-end:
//   1. Buyer paga sólo productos en el checkout normal (freight tiene
//      shipping-fee $0 en el breakdown). tx.xoloShipping.mode = 'freight'
//      con quotePending: true.
//   2. Seller ve card "Cotiza el envío" en TransactionPage y llama
//      POST /api/freight/quote con { transactionId, amountSubunits,
//      description, carrierName? }. Guarda quotedAmount/quotedAt/
//      quoteDescription/quoteCarrierName en metadata.xoloFreight.
//   3. Buyer ve card "Envío cotizado — Autorizar y pagar $XXX" y llama
//      POST /api/freight/create-payment-intent con { transactionId }.
//      Endpoint crea un PaymentIntent en Stripe con metadata
//      xololoType='freight_charge' + xololoTxId. Devuelve clientSecret.
//   4. Buyer confirma el pago en el front con Stripe Elements
//      (stripe.confirmCardPayment(clientSecret)). Stripe cobra la card
//      y emite payment_intent.succeeded.
//   5. Webhook Stripe (server/api/webhooks/stripe-billing.js) procesa
//      payment_intent.succeeded y escribe buyerAuthorizedAt +
//      freightPaidAt en metadata.xoloFreight. Ahí queda habilitado
//      que el seller pueda mark-dispatched.
//
// Nota: los flags dinámicos del flujo (quotedAt, buyerAuthorizedAt,
// etc.) viven en tx.metadata.xoloFreight — NO en protectedData —
// porque Integration SDK sólo permite escribir metadata post-initiate.
// El modo (freight) y el deliveryCode sí viven en protectedData porque
// se escriben durante el initiate. La UI compone ambos al leer.
//
// Este archivo cubre pasos 2 y 3. El paso 5 vive en el webhook.
//
// Escope v1 (TODO Fase 2/3):
// - Sin comisión de plataforma sobre el freight; el 100% del monto
//   queda en la cuenta Stripe de Xololo y el payout al seller se
//   maneja manualmente (transfer bancario). Cuando se defina el fee,
//   se hace application_fee_amount + transfer_data.destination.
// - Sin refund automático si el envío no se completa; se procesa manual.
// - Sin re-cotización tras autorización (una sola quote antes de que
//   el buyer autorice; si autoriza se congela). Puede re-cotizarse
//   mientras buyerAuthorizedAt sea null.

const { getSdk } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { getStripeBilling } = require('../api-util/stripeBilling');
const { computeFreightBreakdown } = require('../api-util/freightFees');

// XOLOLO Fase 1B (hoja Arquitectura técnica §9) — rollout gradual
// del cambio capture_method=automatic → manual. Feature flag en env
// FREIGHT_MANUAL_CAPTURE=1. Cuando está activo:
//   - PIs nuevos se crean con capture_method=manual (autorizan pero
//     NO cobran hasta que el seller marque dispatched).
//   - Dentro de la ventana de Stripe (5d Visa / 7d MC/Amex) se puede
//     CANCELAR sin fee → desbloquea los $0 fee de triggers #3 y #4
//     de la Política A (hoja Google Sheets).
//   - Fuera de la ventana, cancel = refund normal con fee cobrado.
// PIs ya creados ANTES de activar el flag siguen con auto-captura;
// sus webhooks siguen funcionando (succeeded marca ambas banderas).
const isManualCaptureEnabled = () => process.env.FREIGHT_MANUAL_CAPTURE === '1';

const MAX_DESCRIPTION_LEN = 500;
const MAX_CARRIER_LEN = 100;

// Helper compartido: valida sesión + autoriza según role, carga tx.
// role: 'provider' → sólo seller; 'customer' → sólo buyer.
const loadTxForActor = async (req, res, role) => {
  const { transactionId } = req.body || {};
  if (!transactionId || typeof transactionId !== 'string') {
    res.status(400).json({ error: 'invalid_request', details: 'transactionId requerido.' });
    return null;
  }
  const sdk = getSdk(req, res);
  let currentUserResp;
  try {
    // Incluimos stripeCustomer para poder pasar el id al PaymentIntent
    // y que Stripe Elements muestre payment methods guardados en el
    // Wallet (bug reportado: al re-comprar el buyer teclea la card
    // aunque ya la tenga guardada).
    currentUserResp = await sdk.currentUser.show({ include: ['stripeCustomer'] });
  } catch (e) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  const currentUserId = currentUserResp.data.data.id.uuid;
  const currentUserEmail = currentUserResp.data.data.attributes?.email;
  // Extraer stripeCustomer.id del payload denormalizado. Sharetribe
  // devuelve el customer como resource included; su id es el Stripe
  // Customer ID que ya vive en la cuenta Connect del marketplace
  // (misma cuenta que usamos para Billing y PaymentIntents de freight).
  const stripeCustomerRel = currentUserResp.data.data.relationships?.stripeCustomer?.data;
  const stripeCustomerIncluded = (currentUserResp.data.included || []).find(
    it => it.type === 'stripeCustomer' && it.id?.uuid === stripeCustomerRel?.id?.uuid
  );
  const stripeCustomerId = stripeCustomerIncluded?.attributes?.stripeCustomerId || null;

  let txResp;
  try {
    txResp = await sdk.transactions.show({
      id: transactionId,
      include: ['provider', 'customer'],
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
  const customerId = tx.relationships?.customer?.data?.id?.uuid;
  const expectedActorId = role === 'provider' ? providerId : customerId;
  if (expectedActorId !== currentUserId) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }

  const xShipping = tx.attributes.protectedData?.xololoShipping || {};
  return {
    tx,
    transactionId,
    xShipping,
    currentUserId,
    currentUserEmail,
    stripeCustomerId,
  };
};

// Helper: leer el shape actual de xoloFreight (con default vacío) para
// hacer merges no destructivos.
const readXoloFreight = tx => tx.attributes.metadata?.xoloFreight || {};

const quote = async (req, res) => {
  try {
    const ctx = await loadTxForActor(req, res, 'provider');
    if (!ctx) return;
    const { transactionId, tx, xShipping, currentUserId } = ctx;

    if (xShipping.mode !== 'freight') {
      return res.status(409).json({ error: 'not_freight_mode' });
    }
    const currentFreight = readXoloFreight(tx);
    // Una vez el buyer autorizó, la cotización queda congelada — el
    // seller no puede re-cotizar (ya se cobró). Antes de la
    // autorización sí puede re-cotizar libremente.
    if (currentFreight.buyerAuthorizedAt) {
      return res.status(409).json({ error: 'already_authorized' });
    }

    const { amountSubunits, description, carrierName } = req.body || {};
    const amount = Number(amountSubunits);
    if (!Number.isInteger(amount) || amount <= 0) {
      return res
        .status(400)
        .json({ error: 'invalid_request', details: 'amountSubunits debe ser entero positivo.' });
    }
    const desc = String(description || '').slice(0, MAX_DESCRIPTION_LEN).trim();
    if (!desc) {
      return res
        .status(400)
        .json({ error: 'invalid_request', details: 'description es requerida.' });
    }
    const carrier = String(carrierName || '').slice(0, MAX_CARRIER_LEN).trim() || null;

    const isdk = getIntegrationSdk();
    if (!isdk) {
      // eslint-disable-next-line no-console
      console.error('[freight.quote] Integration SDK no configurado');
      return res.status(500).json({ error: 'internal' });
    }

    const nowIso = new Date().toISOString();
    const xoloFreight = {
      ...currentFreight,
      quotedAmount: amount,
      quotedCurrency: 'MXN',
      quotedAt: nowIso,
      quotedBy: currentUserId,
      quoteDescription: desc,
      quoteCarrierName: carrier,
    };
    await isdk.transactions.updateMetadata({
      id: transactionId,
      metadata: { xoloFreight },
    });

    return res.json({ ok: true, quotedAt: nowIso, quotedAmount: amount });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('freight.quote unexpected:', e);
    return res.status(500).json({ error: 'internal' });
  }
};

const createPaymentIntent = async (req, res) => {
  try {
    const ctx = await loadTxForActor(req, res, 'customer');
    if (!ctx) return;
    const {
      transactionId,
      tx,
      xShipping,
      currentUserId,
      currentUserEmail,
      stripeCustomerId,
    } = ctx;

    if (xShipping.mode !== 'freight') {
      return res.status(409).json({ error: 'not_freight_mode' });
    }
    const currentFreight = readXoloFreight(tx);
    if (!currentFreight.quotedAt || !currentFreight.quotedAmount) {
      return res.status(409).json({ error: 'not_quoted_yet' });
    }
    if (currentFreight.buyerAuthorizedAt) {
      return res.status(409).json({ error: 'already_authorized' });
    }

    const stripe = getStripeBilling();
    if (!stripe) {
      // eslint-disable-next-line no-console
      console.error(
        '[freight.createPaymentIntent] Stripe no configurado. ' +
          `STRIPE_SECRET_KEY env var: ${
            process.env.STRIPE_SECRET_KEY ? 'presente' : 'AUSENTE'
          }. ` +
          'Verifica en el dashboard de Render que la variable esté seteada en el service ' +
          'y que se haya hecho un redeploy después de agregarla.'
      );
      return res.status(500).json({ error: 'stripe_missing' });
    }
    const isdk = getIntegrationSdk();
    if (!isdk) {
      // eslint-disable-next-line no-console
      console.error('[freight.createPaymentIntent] Integration SDK no configurado');
      return res.status(500).json({ error: 'internal' });
    }

    // Reutilizar el PI si ya se creó pero el buyer aún no confirmó.
    // Devolver el mismo clientSecret evita crear PIs huérfanos si el
    // buyer hace click varias veces en el botón.
    if (currentFreight.freightPaymentIntentId) {
      try {
        const existing = await stripe.paymentIntents.retrieve(
          currentFreight.freightPaymentIntentId
        );
        if (existing.status !== 'succeeded' && existing.status !== 'canceled') {
          return res.json({
            clientSecret: existing.client_secret,
            paymentIntentId: existing.id,
            amount: existing.amount,
            currency: existing.currency,
            reused: true,
          });
        }
      } catch (e) {
        // El PI viejo no se pudo recuperar (Stripe lo borró, key rotada,
        // etc.). Seguimos y creamos uno nuevo.
      }
    }

    // XOLOLO: si el buyer ya tiene un Stripe Customer (creado por
    // Sharetribe cuando pagó su primer producto), lo asociamos al PI.
    // Con `customer` seteado y `setup_future_usage='off_session'`,
    // Stripe Elements muestra el Wallet con los payment methods
    // guardados del buyer — no tiene que teclear card de nuevo.
    const customerParams = stripeCustomerId
      ? { customer: stripeCustomerId, setup_future_usage: 'off_session' }
      : {};

    // Desglose de fees: el buyer paga exactamente el flete cotizado.
    // Los fees (motor cobro + xololo admin + IVAs) se DESCUENTAN al
    // seller: seller recibe (flete − fees). Xololo absorbe la
    // diferencia del fee real de Stripe (calculado sobre el total).
    const breakdown = computeFreightBreakdown(currentFreight.quotedAmount);

    // Fase 1B: capture_method=manual retiene fondos sin cobrar hasta
    // que el seller marque dispatched. Dentro de la ventana Stripe
    // (5-7 días según red), cancelar = $0 fee. Fuera de la ventana,
    // Stripe captura automáticamente antes del expiry (card decline =
    // igual que automatic). El flag permite rollout gradual.
    const manualCapture = isManualCaptureEnabled();
    const captureParams = manualCapture ? { capture_method: 'manual' } : {};

    const pi = await stripe.paymentIntents.create({
      amount: breakdown.fleteSubunits,
      currency: (currentFreight.quotedCurrency || 'MXN').toLowerCase(),
      automatic_payment_methods: { enabled: true },
      ...captureParams,
      description: `Envío por flete · Xololo tx ${transactionId}`,
      receipt_email: currentUserEmail || undefined,
      ...customerParams,
      metadata: {
        xololoType: 'freight_charge',
        xololoTxId: transactionId,
        xololoBuyerId: currentUserId,
        xololoCaptureMethod: manualCapture ? 'manual' : 'automatic',
        xololoFleteSubunits: String(breakdown.fleteSubunits),
        xololoTotalFeesSubunits: String(breakdown.totalFeesSubunits),
        xololoSellerReceivesSubunits: String(breakdown.sellerReceivesSubunits),
      },
    });

    // Persistimos el PI id + desglose en la tx.
    const xoloFreight = {
      ...currentFreight,
      freightPaymentIntentId: pi.id,
      freightPaymentIntentCreatedAt: new Date().toISOString(),
      freightBreakdown: breakdown,
    };
    await isdk.transactions.updateMetadata({
      id: transactionId,
      metadata: { xoloFreight },
    });

    return res.json({
      clientSecret: pi.client_secret,
      paymentIntentId: pi.id,
      amount: pi.amount,
      currency: pi.currency,
      breakdown,
      reused: false,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('freight.createPaymentIntent unexpected:', e);
    return res.status(500).json({ error: 'internal' });
  }
};

// XOLOLO Fase 1B — captura/cancelación del PaymentIntent del flete.
// Llamadas desde otros endpoints (tx-flow.markDispatched, scheduler
// auto-cancel, operator admin). NO exponen HTTP endpoint directo —
// se consumen como funciones internas con el txId.
//
// Idempotencia: Stripe rechaza capture/cancel sobre un PI en estado
// final (succeeded/canceled). Capturamos esos errores y los
// convertimos en `{ ok: true, already: '<state>' }` para que el
// caller no tenga que preocuparse.

const captureFreightPi = async transactionId => {
  const isdk = getIntegrationSdk();
  if (!isdk) return { ok: false, error: 'integration_sdk_missing' };
  const stripe = getStripeBilling();
  if (!stripe) return { ok: false, error: 'stripe_not_configured' };

  const txResp = await isdk.transactions.show({ id: transactionId });
  const freight = txResp.data.data.attributes.metadata?.xoloFreight || {};
  const piId = freight.freightPaymentIntentId;
  if (!piId) return { ok: false, error: 'no_payment_intent' };

  try {
    const pi = await stripe.paymentIntents.capture(piId);
    return { ok: true, status: pi.status, amountCaptured: pi.amount_received };
  } catch (e) {
    const msg = e?.raw?.message || e?.message || '';
    if (/already been captured|has already succeeded/i.test(msg)) {
      return { ok: true, already: 'captured' };
    }
    if (/canceled|cannot capture/i.test(msg)) {
      return { ok: false, error: 'pi_not_capturable', message: msg };
    }
    // eslint-disable-next-line no-console
    console.error('[freight.captureFreightPi]', transactionId, msg);
    return { ok: false, error: 'stripe_error', message: msg };
  }
};

const cancelFreightPi = async (transactionId, reason) => {
  const isdk = getIntegrationSdk();
  if (!isdk) return { ok: false, error: 'integration_sdk_missing' };
  const stripe = getStripeBilling();
  if (!stripe) return { ok: false, error: 'stripe_not_configured' };

  const txResp = await isdk.transactions.show({ id: transactionId });
  const freight = txResp.data.data.attributes.metadata?.xoloFreight || {};
  const piId = freight.freightPaymentIntentId;
  if (!piId) return { ok: true, already: 'no_pi' };

  try {
    // Stripe cancel reasons válidas: duplicate | fraudulent |
    // requested_by_customer | abandoned. Default a 'abandoned' si no se pasa.
    const validReasons = ['duplicate', 'fraudulent', 'requested_by_customer', 'abandoned'];
    const cancellationReason = validReasons.includes(reason) ? reason : 'abandoned';
    const pi = await stripe.paymentIntents.cancel(piId, {
      cancellation_reason: cancellationReason,
    });
    return { ok: true, status: pi.status };
  } catch (e) {
    const msg = e?.raw?.message || e?.message || '';
    if (/already been canceled/i.test(msg)) {
      return { ok: true, already: 'canceled' };
    }
    if (/cannot be canceled|has already succeeded/i.test(msg)) {
      // Ya se capturó — hay que refund, no cancel. El caller decide.
      return { ok: false, error: 'pi_already_captured', message: msg };
    }
    // eslint-disable-next-line no-console
    console.error('[freight.cancelFreightPi]', transactionId, msg);
    return { ok: false, error: 'stripe_error', message: msg };
  }
};

module.exports = { quote, createPaymentIntent, captureFreightPi, cancelFreightPi };
