// XOLOLO Track C (docs/SUBSCRIPTIONS_V1.md §3.5): crea (o reutiliza) los
// Products/Prices de Stripe Billing para las suscripciones de sellers.
//
// Idempotente: para cada plan busca primero un Price ACTIVO con su
// lookup_key (server/api-util/billingPlans.js). Comportamiento:
//   - Mismo monto que la definición → skip
//   - Monto diferente → archiva el Price viejo (active:false, libera el
//     lookup_key) y crea uno nuevo con el monto actualizado. Los sellers
//     ya suscritos al Price viejo mantienen su monto hasta renovar
//     (Stripe no re-cobra retroactivamente).
//   - No existe → crea Product + Price.
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
const {
  PLANS,
  ONBOARDING_FEE,
  ENTERPRISE_PLANS,
  ENTERPRISE_SEATS,
} = require('../api-util/billingPlans');

const ensurePrice = async (stripe, def) => {
  const existing = await stripe.prices.list({
    lookup_keys: [def.lookupKey],
    active: true,
    limit: 10,
  });

  // Caso 1: ya hay un Price activo con el monto correcto → skip.
  const match = existing.data.find(p => p.unit_amount === def.unitAmount);
  if (match) {
    console.log(`[skip] ${def.lookupKey} ya existe → price ${match.id} (product ${match.product})`);
    return match;
  }

  // Caso 2: hay Price(s) activo(s) pero con monto distinto → archiva(los) y
  // libera el lookup_key para que el nuevo lo pueda tomar. Sellers ya
  // suscritos a esos Prices viejos mantienen su monto hasta renovar.
  if (existing.data.length > 0) {
    for (const p of existing.data) {
      console.log(
        `[archive] ${def.lookupKey} tenía ${p.id} con unit_amount=${p.unit_amount} (nuevo: ${def.unitAmount}) → archivando`
      );
      await stripe.prices.update(p.id, { active: false, lookup_key: '' });
    }
  }

  // Caso 3: busca si ya existe el Product (por metadata.xololoLookupKey) para
  // no crear duplicados cuando sólo re-emitimos el Price.
  let productId = null;
  if (existing.data.length > 0 && existing.data[0].product) {
    productId = existing.data[0].product;
  } else {
    const prodSearch = await stripe.products.search({
      query: `metadata['xololoLookupKey']:'${def.lookupKey}' AND active:'true'`,
      limit: 1,
    });
    if (prodSearch.data.length > 0) productId = prodSearch.data[0].id;
  }

  if (!productId) {
    const product = await stripe.products.create({
      name: def.productName,
      description: def.productDescription,
      metadata: { xololoLookupKey: def.lookupKey },
    });
    productId = product.id;
  }

  const price = await stripe.prices.create({
    product: productId,
    currency: def.currency,
    unit_amount: def.unitAmount,
    lookup_key: def.lookupKey,
    ...(def.recurring ? { recurring: def.recurring } : {}),
  });

  console.log(
    `[created] ${def.lookupKey} → product ${productId}, price ${price.id} (${(
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
  // XOLOLO Tier Empresarial · E6
  await ensurePrice(stripe, ENTERPRISE_PLANS.enterprise_annual);
  await ensurePrice(stripe, ENTERPRISE_PLANS.enterprise_monthly);
  await ensurePrice(stripe, ENTERPRISE_SEATS.enterprise_annual);
  await ensurePrice(stripe, ENTERPRISE_SEATS.enterprise_monthly);

  console.log(
    '\nListo. El checkout de suscripción resuelve el Price vigente por lookup_key en tiempo real — no hace falta guardar IDs en env vars.'
  );
};

run().catch(e => {
  console.error('Error corriendo el setup de Stripe Billing:', e?.message || e);
  process.exitCode = 1;
});
