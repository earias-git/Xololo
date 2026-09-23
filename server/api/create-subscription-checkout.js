// XOLOLO Track C (docs/SUBSCRIPTIONS_V1.md §3.5): crea un Stripe
// Checkout Session para que el seller se suscriba (plan anual o
// mensual) + pague la cuota de onboarding en el mismo pago.
//
// Contrato:
//   POST /api/create-subscription-checkout
//   Body: { plan: 'annual' | 'monthly' }
//   Auth: user logueado.
//   200 → { url }  (redirigir el browser ahí — Stripe Checkout hosted page)
//   400 → { error: 'invalid_plan' }
//   401 → { error: 'unauthorized' }
//   409 → { error: 'already_subscribed' }  (ya tiene una suscripción activa)
//   500 → { error: 'stripe_billing_missing' | 'internal' }
//
// El onboarding fee ($499, una sola vez) se agrega como SEGUNDO
// line_item en el mismo Checkout Session (mode: 'subscription') —
// Stripe lo cobra sólo en la primera invoice, no se repite en
// renovaciones. Confirmación de pago exitoso: ver
// server/api/seller-subscription.js (POST) — llamado desde el
// success_url. El webhook (roadmap #5) es el mecanismo robusto a
// futuro para renovaciones/fallos; esto cubre el alta inicial.

const { getSdk } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const {
  getStripeBilling,
  resolvePricesByLookupKeys,
  getOrCreateStripeCustomer,
} = require('../api-util/stripeBilling');
const { PLANS, ONBOARDING_FEE } = require('../api-util/billingPlans');

const getMarketplaceRootUrl = () =>
  (process.env.REACT_APP_MARKETPLACE_ROOT_URL || 'https://xololo.mx').replace(/\/$/, '');

module.exports = async (req, res) => {
  const plan = String(req.body?.plan || '').trim();
  if (!PLANS[plan]) {
    return res.status(400).json({ error: 'invalid_plan' });
  }

  let currentUser;
  try {
    const sdk = getSdk(req, res);
    const uResp = await sdk.currentUser.show();
    currentUser = uResp.data.data;
  } catch (e) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const stripe = getStripeBilling();
  if (!stripe) return res.status(500).json({ error: 'stripe_billing_missing' });

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  const sellerId = currentUser.id.uuid;

  try {
    const existingResp = await isdk.users.show({ id: sellerId });
    const existingSub =
      existingResp.data.data.attributes?.profile?.metadata?.xololoSubscription || {};
    if (existingSub.status === 'active') {
      return res.status(409).json({ error: 'already_subscribed' });
    }

    const prices = await resolvePricesByLookupKeys(stripe, [
      PLANS[plan].lookupKey,
      ONBOARDING_FEE.lookupKey,
    ]);
    const planPrice = prices[PLANS[plan].lookupKey];
    const onboardingPrice = prices[ONBOARDING_FEE.lookupKey];
    if (!planPrice || !onboardingPrice) {
      // eslint-disable-next-line no-console
      console.error(
        '[create-subscription-checkout] Prices no encontrados en Stripe — ¿corriste yarn setup-stripe-billing?'
      );
      return res.status(500).json({ error: 'internal' });
    }

    const profile = currentUser.attributes.profile || {};
    const email = currentUser.attributes.email;
    const name = profile.displayName || `${profile.firstName || ''} ${profile.lastName || ''}`.trim();

    // El onboarding fee es una sola vez de por vida — no volver a
    // cobrarlo si el seller ya lo pagó antes (pausó y se reactiva).
    const onboardingAlreadyPaid = existingSub.onboardingFeePaid === true;

    const customerId = await getOrCreateStripeCustomer({
      stripe,
      isdk,
      sellerId,
      email,
      name,
    });

    const rootUrl = getMarketplaceRootUrl();
    const lineItems = [{ price: planPrice.id, quantity: 1 }];
    if (!onboardingAlreadyPaid) {
      lineItems.push({ price: onboardingPrice.id, quantity: 1 });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: lineItems,
      success_url: `${rootUrl}/account/subscription?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${rootUrl}/account/subscription?checkout=canceled`,
      subscription_data: {
        metadata: { xololoSellerId: sellerId, xololoPlan: plan },
      },
      metadata: { xololoSellerId: sellerId, xololoPlan: plan },
    });

    return res.json({ url: session.url });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[create-subscription-checkout] error:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};
