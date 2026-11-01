// XOLOLO Tier Empresarial · E6.5 — upgrade in-place de Starter → Enterprise.
//
// En vez de obligar al seller a pausar Starter y crear una nueva sub
// Enterprise (flow pragmático documentado en E6 como 409
// cancel_starter_first), este endpoint actualiza la subscription Stripe
// existente cambiando el plan item con proration_behavior='always_invoice'.
//
// POST /api/subscription/upgrade-to-enterprise
// Auth: user logueado. Mismo ciclo (annual|monthly) que el Starter.
//   200 → { ok, tier: 'enterprise', seats, invoiceId? }
//   409 → { error: 'no_active_starter' | 'already_enterprise' }
//   500 → { error: 'stripe_billing_missing' | 'internal' }

const { getSdk } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const {
  getStripeBilling,
  resolvePricesByLookupKeys,
  syncSubscriptionMetadata,
} = require('../api-util/stripeBilling');
const { PLANS, ENTERPRISE_PLANS, ENTERPRISE_SEATS } = require('../api-util/billingPlans');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  let sellerId;
  try {
    const sdk = getSdk(req, res);
    const uResp = await sdk.currentUser.show();
    sellerId = uResp.data.data.id.uuid;
  } catch (e) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const stripe = getStripeBilling();
  if (!stripe) return res.status(500).json({ error: 'stripe_billing_missing' });

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    const resp = await isdk.users.show({ id: sellerId });
    const sub = resp.data.data.attributes?.profile?.metadata?.xololoSubscription || {};
    if (sub.tier === 'enterprise') {
      return res.status(409).json({ error: 'already_enterprise' });
    }
    if (sub.status !== 'active' || !sub.stripeSubscriptionId) {
      return res.status(409).json({ error: 'no_active_starter' });
    }

    const billing = sub.plan === 'annual' ? 'annual' : 'monthly';
    const starterLookup =
      billing === 'annual' ? PLANS.annual.lookupKey : PLANS.monthly.lookupKey;
    const enterprisePlanLookup =
      billing === 'annual'
        ? ENTERPRISE_PLANS.enterprise_annual.lookupKey
        : ENTERPRISE_PLANS.enterprise_monthly.lookupKey;
    const seatLookup =
      billing === 'annual'
        ? ENTERPRISE_SEATS.enterprise_annual.lookupKey
        : ENTERPRISE_SEATS.enterprise_monthly.lookupKey;

    const prices = await resolvePricesByLookupKeys(stripe, [
      starterLookup,
      enterprisePlanLookup,
      seatLookup,
    ]);
    const enterprisePrice = prices[enterprisePlanLookup];
    const seatPrice = prices[seatLookup];
    if (!enterprisePrice || !seatPrice) {
      // eslint-disable-next-line no-console
      console.error('[upgrade-to-enterprise] Prices no encontrados — corre yarn setup-stripe-billing');
      return res.status(500).json({ error: 'internal' });
    }

    // Lee la sub actual para encontrar el line_item del Starter.
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
    const starterItem = stripeSub.items.data.find(
      it => it.price?.lookup_key === starterLookup || it.price?.id === prices[starterLookup]?.id
    );
    if (!starterItem) {
      return res
        .status(409)
        .json({ error: 'starter_item_not_found_in_stripe' });
    }

    // Switch in-place con prorated invoice inmediata. Reemplazamos el
    // item del plan Starter por el Enterprise. El seat line_item se
    // agrega al momento con quantity=0 (Stripe lo acepta y no cobra;
    // se bumpea con /team/buy-seat cuando el admin invita más de 2).
    const updated = await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      items: [
        { id: starterItem.id, price: enterprisePrice.id, quantity: 1 },
      ],
      proration_behavior: 'always_invoice',
      metadata: {
        xololoSellerId: sellerId,
        xololoPlan: billing,
        xololoTier: 'enterprise',
        xololoSeatPriceId: seatPrice.id,
      },
    });

    // Sync metadata.xololoSubscription.
    await syncSubscriptionMetadata({
      isdk,
      sellerId,
      subscription: updated,
      plan: billing,
      extra: {
        tier: 'enterprise',
        seatPriceId: seatPrice.id,
        seatsExtraPaid: 0,
      },
    });

    // Seed metadata.xololoTeam si no existe.
    try {
      const refreshed = await isdk.users.show({ id: sellerId });
      const md = refreshed.data.data.attributes?.profile?.metadata || {};
      if (!md.xololoTeam || !md.xololoTeam.seats) {
        await isdk.users.updateProfile({
          id: sellerId,
          metadata: {
            xololoTeam: {
              collaborators: md.xololoTeam?.collaborators || [],
              seats: { used: 0, included: 2, extraPaid: 0 },
              actions: md.xololoTeam?.actions || [],
              updatedAt: new Date().toISOString(),
            },
          },
        });
      }
    } catch (_e) {
      // non-fatal
    }

    return res.json({
      ok: true,
      tier: 'enterprise',
      billing,
      seats: { used: 0, included: 2, extraPaid: 0 },
      latestInvoice: updated.latest_invoice || null,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[upgrade-to-enterprise] error:', e?.message || e);
    return res.status(500).json({ error: 'internal', detail: e?.message });
  }
};
