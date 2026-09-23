// XOLOLO Track C (docs/SUBSCRIPTIONS_V1.md §3.5): crea (o reutiliza) los
// Products/Prices de Stripe Billing para las suscripciones de sellers.
//
// Idempotente: para cada plan busca primero un Price ACTIVO con su
// lookup_key (server/api-util/billingPlans.js); si ya existe, no toca
// nada — lo reporta y sigue. Sólo crea Product+Price cuando no hay
// ninguno con ese lookup_key todavía. Correr de nuevo después de un
// cambio de monto NO actualiza el Price existente (Stripe Prices son
// inmutables) — hay que archivar el viejo a mano en el Dashboard y
// dejar que este script cree el nuevo con el mismo lookup_key.
//
// Requiere STRIPE_SECRET_KEY en .env — cuenta Stripe de Xololo para
// BILLING, separada de la que usa Sharetribe Connect para los pagos
// del marketplace (esa no vive en este repo).
//
// Uso: node server/scripts/setup-stripe-billing.js
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const { configureEnv } = require('../env');
configureEnv();

const { getStripeBilling } = require('../api-util/stripeBilling');
const { PLANS, ONBOARDING_FEE } = require('../api-util/billingPlans');

const ensurePrice = async (stripe, def) => {
  const existing = await stripe.prices.list({
    lookup_keys: [def.lookupKey],
    active: true,
    limit: 1,
  });
  if (existing.data.length > 0) {
    const price = existing.data[0];
    console.log(
      `[skip] ${def.lookupKey} ya existe → price ${price.id} (product ${price.product})`
    );
    return price;
  }

  const product = await stripe.products.create({
    name: def.productName,
    description: def.productDescription,
    metadata: { xololoLookupKey: def.lookupKey },
  });

  const price = await stripe.prices.create({
    product: product.id,
    currency: def.currency,
    unit_amount: def.unitAmount,
    lookup_key: def.lookupKey,
    ...(def.recurring ? { recurring: def.recurring } : {}),
  });

  console.log(
    `[created] ${def.lookupKey} → product ${product.id}, price ${price.id} (${(
      def.unitAmount / 100
    ).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}${
      def.recurring ? `/${def.recurring.interval}` : ' una sola vez'
    })`
  );
  return price;
};

const run = async () => {
  const stripe = getStripeBilling();
  if (!stripe) {
    console.error(
      'STRIPE_SECRET_KEY no está configurado en .env — agrégalo (cuenta Stripe de Xololo para billing, separada de Connect) y vuelve a correr este script.'
    );
    process.exitCode = 1;
    return;
  }

  console.log('Creando/verificando Products & Prices de Stripe Billing…\n');

  await ensurePrice(stripe, PLANS.annual);
  await ensurePrice(stripe, PLANS.monthly);
  await ensurePrice(stripe, ONBOARDING_FEE);

  console.log(
    '\nListo. El checkout de suscripción resuelve el Price vigente por lookup_key en tiempo real — no hace falta guardar IDs en env vars.'
  );
};

run().catch(e => {
  console.error('Error corriendo el setup de Stripe Billing:', e?.message || e);
  process.exitCode = 1;
});
