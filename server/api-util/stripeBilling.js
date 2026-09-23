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

module.exports = { getStripeBilling, resolvePricesByLookupKeys, getOrCreateStripeCustomer };
