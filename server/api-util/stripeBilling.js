// XOLOLO Track C (docs/SUBSCRIPTIONS_V1.md §3.5): cliente Stripe para
// la suscripción de sellers (Stripe Billing) — cuenta y credenciales
// SEPARADAS del Stripe Connect que ya usa el checkout del marketplace
// (ese lo maneja el backend de Sharetribe, este repo nunca tuvo su
// propio secret key hasta ahora). NUNCA reusar la misma cuenta Stripe
// para ambas cosas.
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

module.exports = { getStripeBilling };
