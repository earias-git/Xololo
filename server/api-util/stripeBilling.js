// XOLOLO Track C (docs/SUBSCRIPTIONS_V1.md §3.5): cliente Stripe para
// la suscripción de sellers (Stripe Billing). Usa `STRIPE_SECRET_KEY`
// — misma cuenta Stripe que Connect (decisión de earias al configurar
// la key; el plan original proponía una cuenta separada, ver §3.5 en
// el doc para el detalle de la decisión).
//
// Uso:
//   const { getStripeBilling } = require('../api-util/stripeBilling');
//   const stripe = getStripeBilling();
//   if (!stripe) return res.status(500).json({ error: 'stripe_billing_missing' });

const Stripe = require('stripe');

let cached = null;

const getStripeBilling = () => {
  if (cached) return cached;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  cached = new Stripe(secretKey, { apiVersion: '2024-06-20' });
  return cached;
};

// Resuelve los Price IDs vigentes por lookup_key en una sola llamada.
// Nunca guardamos Price IDs en env vars/metadata — si se archiva un
// Price y se crea uno nuevo con el mismo lookup_key, esto recoge el
// nuevo automáticamente.
const resolvePricesByLookupKeys = async (stripe, lookupKeys) => {
  const resp = await stripe.prices.list({ lookup_keys: lookupKeys, active: true });
  const byLookupKey = {};
  resp.data.forEach(price => {
    byLookupKey[price.lookup_key] = price;
  });
  return byLookupKey;
};

// Reutiliza el Stripe Customer del seller si ya existe
// (user.attributes.profile.metadata.xololoSubscription.stripeCustomerId),
// o crea uno nuevo y lo persiste vía Integration SDK. No pisa el resto
// de xololoSubscription si ya tenía datos (ej. de una suscripción
// anterior cancelada).
const getOrCreateStripeCustomer = async ({ stripe, isdk, sellerId, email, name }) => {
  const resp = await isdk.users.show({ id: sellerId });
  const existing = resp.data.data.attributes?.profile?.metadata?.xololoSubscription || {};

  if (existing.stripeCustomerId) {
    return existing.stripeCustomerId;
  }

  const customer = await stripe.customers.create({
    email,
    name,
    metadata: { xololoSellerId: sellerId },
  });

  await isdk.users.updateProfile({
    id: sellerId,
    metadata: {
      xololoSubscription: { ...existing, stripeCustomerId: customer.id },
    },
  });

  return customer.id;
};

// Mapa de status de Stripe Subscription → status interno de Xololo.
// Usado tanto por la confirmación manual (seller-subscription.js) como
// por el webhook (server/api/webhooks/stripe-billing.js) — una sola
// fuente de verdad para no desincronizar los dos caminos.
const STRIPE_TO_XOLOLO_STATUS = {
  active: 'active',
  trialing: 'active',
  past_due: 'past_due',
  unpaid: 'past_due',
  canceled: 'canceled',
  incomplete: 'past_due',
  incomplete_expired: 'canceled',
};

// Persiste el estado de una Stripe Subscription en
// user.attributes.profile.metadata.xololoSubscription. No pisa
// `warningsSent`/`lastWarningAt` salvo que se pasen explícitamente en
// `extra` — eso lo maneja el handler de invoice.payment_failed.
const syncSubscriptionMetadata = async ({ isdk, sellerId, subscription, plan, extra = {} }) => {
  const existingResp = await isdk.users.show({ id: sellerId });
  const existing = existingResp.data.data.attributes?.profile?.metadata?.xololoSubscription || {};

  const updated = {
    ...existing,
    plan: plan || existing.plan || null,
    status: STRIPE_TO_XOLOLO_STATUS[subscription.status] || 'active',
    stripeCustomerId: subscription.customer,
    stripeSubscriptionId: subscription.id,
    currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    onboardingFeePaid: true,
    warningsSent: existing.warningsSent || [],
    lastWarningAt: existing.lastWarningAt || null,
    ...extra,
  };

  await isdk.users.updateProfile({
    id: sellerId,
    metadata: { xololoSubscription: updated },
  });

  return updated;
};

// Busca al seller por Stripe customer/subscription metadata. Siempre
// escribimos `xololoSellerId` en subscription_data.metadata al crear
// el Checkout Session — Stripe lo propaga a todos los objetos
// derivados (Subscription, y sus Invoices), así que esto es la forma
// confiable de volver de "evento de Stripe" a "user de Sharetribe"
// sin tener que mantener un índice propio.
const getSellerIdFromSubscription = subscription => subscription?.metadata?.xololoSellerId || null;

module.exports = {
  getStripeBilling,
  resolvePricesByLookupKeys,
  getOrCreateStripeCustomer,
  syncSubscriptionMetadata,
  getSellerIdFromSubscription,
  STRIPE_TO_XOLOLO_STATUS,
};
