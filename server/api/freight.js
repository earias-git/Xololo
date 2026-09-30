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

    // Desglose de fees: buyer paga base + motor cobro + IVA + xololo
    // admin + IVA. El seller recibe la base; Xololo absorbe la
    // diferencia del fee real de Stripe (calculado sobre el total).
    const breakdown = computeFreightBreakdown(currentFreight.quotedAmount);

    const pi = await stripe.paymentIntents.create({
      amount: breakdown.totalSubunits,
      currency: (currentFreight.quotedCurrency || 'MXN').toLowerCase(),
      automatic_payment_methods: { enabled: true },
      description: `Envío por flete · Xololo tx ${transactionId}`,
      receipt_email: currentUserEmail || undefined,
      ...customerParams,
      metadata: {
        xololoType: 'freight_charge',
        xololoTxId: transactionId,
        xololoBuyerId: currentUserId,
        xololoFleteSubunits: String(breakdown.fleteSubunits),
        xololoMotorSubunits: String(breakdown.motorCobroSubunits + breakdown.ivaMotorSubunits),
        xololoXololoSubunits: String(breakdown.xololoAdminSubunits + breakdown.ivaXololoAdminSubunits),
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

module.exports = { quote, createPaymentIntent };
