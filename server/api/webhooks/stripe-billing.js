// XOLOLO Track C (docs/SUBSCRIPTIONS_V1.md §3.5, roadmap #5): webhook
// receiver de Stripe Billing (suscripción de sellers). Se registra en
// el Dashboard de Stripe: Developers > Webhooks, apuntando a
// POST https://<host>/api/webhooks/stripe-billing, escuchando:
//
//   - checkout.session.completed   → activa la suscripción (alta inicial)
//   - invoice.payment_failed       → registra el intento fallido + avisa al seller
//   - customer.subscription.updated → sync de status/currentPeriodEnd/cancelAtPeriodEnd
//   - customer.subscription.deleted → cierre final (Stripe la borra sola
//     cuando cancel_at_period_end se cumple, o por unpaid) → avisa al seller
//
// Esto es el mecanismo ROBUSTO para mantener xololoSubscription al día
// (renovaciones, fallos de pago, cancelaciones) — server/api/seller-subscription.js
// (POST) es sólo un puente para el alta inicial cuando el seller vuelve
// del success_url, y hace básicamente lo mismo que checkout.session.completed
// aquí (ambos son idempotentes, no hay problema si corren dos veces).
//
// El gate real de publicación (Search/Storefront/Listing, roadmap #6)
// y el job de avisos de renovación 30/15/3/1 días (roadmap futuro,
// job diario tipo tacit-acceptance.js) NO viven aquí — este archivo
// sólo mantiene xololoSubscription sincronizado con Stripe.
//
// Contrato:
//   POST /api/webhooks/stripe-billing
//   Headers: Stripe-Signature (verificado con STRIPE_BILLING_WEBHOOK_SECRET)
//   200 → { ok: true, processed: bool, type, reason? }
//   400 → { error: 'invalid_signature' | 'invalid_json' }
//   500 → { error: '...' } (Stripe reintenta automáticamente)

const {
  getStripeBilling,
  syncSubscriptionMetadata,
  getSellerIdFromSubscription,
} = require('../../api-util/stripeBilling');
const { getIntegrationSdk } = require('../../api-util/integrationSdk');
const { sendEventNotifications } = require('../../api-util/notifications');

const WEBHOOK_SECRET = process.env.STRIPE_BILLING_WEBHOOK_SECRET;

const PLAN_LABELS = { annual: 'anual', monthly: 'mensual' };

const getRootUrl = () =>
  (process.env.REACT_APP_MARKETPLACE_ROOT_URL || 'https://xololo.mx').replace(/\/$/, '');

// Dedup best-effort de eventos (Stripe puede reentregar el mismo
// evento más de una vez). In-memory, se resetea con cada deploy —
// aceptable porque toda la lógica de abajo es idempotente de todos
// modos (sync* siempre escribe el estado más fresco, no acumula).
const PROCESSED_EVENT_IDS = new Set();
const MAX_TRACKED_EVENTS = 1000;
const isDuplicateEvent = id => {
  if (!id) return false;
  if (PROCESSED_EVENT_IDS.has(id)) return true;
  PROCESSED_EVENT_IDS.add(id);
  if (PROCESSED_EVENT_IDS.size > MAX_TRACKED_EVENTS) {
    PROCESSED_EVENT_IDS.delete(PROCESSED_EVENT_IDS.values().next().value);
  }
  return false;
};

const buildSellerContext = user => {
  const profile = user.attributes?.profile || {};
  const name =
    profile.displayName || `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
  return { name: name || 'Seller', email: user.attributes?.email };
};

const notifySeller = async (isdk, sellerId, event, subscriptionMeta) => {
  try {
    const resp = await isdk.users.show({ id: sellerId });
    const seller = buildSellerContext(resp.data.data);
    if (!seller.email) return;
    await sendEventNotifications(event, {
      seller,
      subscription: {
        planLabel: PLAN_LABELS[subscriptionMeta.plan] || subscriptionMeta.plan || 'Xololo',
        currentPeriodEndLabel: subscriptionMeta.currentPeriodEnd
          ? new Date(subscriptionMeta.currentPeriodEnd).toLocaleDateString('es-MX', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })
          : '',
        url: `${getRootUrl()}/account/subscription`,
      },
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[webhook stripe-billing] notify falló:', e?.message);
  }
};

module.exports = async (req, res) => {
  const stripe = getStripeBilling();
  if (!stripe) return res.status(500).json({ error: 'stripe_billing_missing' });

  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));

  let event;
  if (WEBHOOK_SECRET) {
    try {
      event = stripe.webhooks.constructEvent(rawBody, req.headers['stripe-signature'], WEBHOOK_SECRET);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[webhook stripe-billing] firma inválida:', e.message);
      return res.status(400).json({ error: 'invalid_signature' });
    }
  } else {
    // Sin secret configurado: acepta sin verificar firma — SÓLO para
    // probar antes de registrar el webhook real en Stripe Dashboard.
    // eslint-disable-next-line no-console
    console.warn(
      '[webhook stripe-billing] STRIPE_BILLING_WEBHOOK_SECRET no configurado — aceptando sin verificar firma (sólo dev/pruebas, nunca en prod).'
    );
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch (e) {
      return res.status(400).json({ error: 'invalid_json' });
    }
  }

  if (isDuplicateEvent(event.id)) {
    return res.status(200).json({ ok: true, processed: false, reason: 'duplicate_event', type: event.type });
  }

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const sellerId = session.metadata?.xololoSellerId;
      if (session.mode !== 'subscription' || !sellerId || !session.subscription) {
        return res.status(200).json({ ok: true, processed: false, reason: 'not_applicable', type: event.type });
      }
      const subscription = await stripe.subscriptions.retrieve(session.subscription);
      const updated = await syncSubscriptionMetadata({
        isdk,
        sellerId,
        subscription,
        plan: session.metadata?.xololoPlan,
      });
      await notifySeller(isdk, sellerId, 'seller.subscription_started', updated);
    } else if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      if (!invoice.subscription) {
        return res.status(200).json({ ok: true, processed: false, reason: 'not_applicable', type: event.type });
      }
      const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
      const sellerId = getSellerIdFromSubscription(subscription);
      if (!sellerId) {
        return res.status(200).json({ ok: true, processed: false, reason: 'no_seller_metadata', type: event.type });
      }
      const existingResp = await isdk.users.show({ id: sellerId });
      const existing = existingResp.data.data.attributes?.profile?.metadata?.xololoSubscription || {};
      const warningsSent = [...(existing.warningsSent || []), new Date().toISOString()];
      const updated = await syncSubscriptionMetadata({
        isdk,
        sellerId,
        subscription,
        plan: existing.plan,
        extra: { warningsSent, lastWarningAt: new Date().toISOString() },
      });
      await notifySeller(isdk, sellerId, 'seller.payment_failed_warning', updated);
    } else if (event.type === 'customer.subscription.updated') {
      const subscription = event.data.object;
      const sellerId = getSellerIdFromSubscription(subscription);
      if (!sellerId) {
        return res.status(200).json({ ok: true, processed: false, reason: 'no_seller_metadata', type: event.type });
      }
      await syncSubscriptionMetadata({ isdk, sellerId, subscription });
    } else if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      const sellerId = getSellerIdFromSubscription(subscription);
      if (!sellerId) {
        return res.status(200).json({ ok: true, processed: false, reason: 'no_seller_metadata', type: event.type });
      }
      const updated = await syncSubscriptionMetadata({ isdk, sellerId, subscription });
      await notifySeller(isdk, sellerId, 'seller.subscription_canceled', updated);
    } else {
      return res.status(200).json({ ok: true, processed: false, reason: 'ignored_event_type', type: event.type });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[webhook stripe-billing] error procesando ${event.type}:`, e.message);
    // 500 → Stripe reintenta automáticamente con backoff.
    return res.status(500).json({ error: 'internal' });
  }

  return res.status(200).json({ ok: true, processed: true, type: event.type });
};
