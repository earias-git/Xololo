// XOLOLO Tier Empresarial · E6.5 — upgrade in-place de Starter → Enterprise.
//
// En vez de obligar al seller a pausar Starter y crear una nueva sub
// Enterprise (flow pragmático documentado en E6 como 409
// cancel_starter_first), este endpoint actualiza la subscription Stripe
// existente cambiando el plan item con proration_behavior='always_invoice'.
//
// POST /api/subscription/upgrade-to-enterprise
// Auth: user logueado. Mismo ciclo (annual|monthly) que el Starter.
//
// Body (JSON, opcional):
//   { seatsExtra: N }  colaboradores adicionales más allá de los 2
//                      incluidos. Default 0. Clamp [0, 20]. Se agrega
//                      como segundo line_item con quantity=N en Stripe.
//
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

  const seatsExtraRaw = Number(req.body?.seatsExtra ?? 0);
  const seatsExtra = Number.isFinite(seatsExtraRaw)
    ? Math.min(20, Math.max(0, Math.floor(seatsExtraRaw)))
    : 0;

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
    // item del plan Starter por el Enterprise + agregamos el seat line
    // con quantity=seatsExtra (0 por default). Si el seller eligió
    // extras en el selector pre-preview, se cobran prorrateados en la
    // misma invoice. Más tarde /team/buy-seat bumpea la quantity.
    const subItems = [
      { id: starterItem.id, price: enterprisePrice.id, quantity: 1 },
    ];
    if (seatsExtra > 0) {
      subItems.push({ price: seatPrice.id, quantity: seatsExtra });
    }

    const updated = await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      items: subItems,
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
        seatsExtraPaid: seatsExtra,
      },
    });

    // Seed metadata.xololoTeam con los seats comprados. Si ya existe un
    // team record, respeta collaborators/actions y actualiza seats.
    try {
      const refreshed = await isdk.users.show({ id: sellerId });
      const md = refreshed.data.data.attributes?.profile?.metadata || {};
      const prevTeam = md.xololoTeam || {};
      await isdk.users.updateProfile({
        id: sellerId,
        metadata: {
          xololoTeam: {
            collaborators: prevTeam.collaborators || [],
            seats: {
              used: prevTeam.seats?.used || 0,
              included: 2,
              extraPaid: seatsExtra,
            },
            actions: prevTeam.actions || [],
            updatedAt: new Date().toISOString(),
          },
        },
      });
    } catch (_e) {
      // non-fatal
    }

    return res.json({
      ok: true,
      tier: 'enterprise',
      billing,
      seats: { used: 0, included: 2, extraPaid: seatsExtra },
      latestInvoice: updated.latest_invoice || null,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[upgrade-to-enterprise] error:', e?.message || e);
    return res.status(500).json({ error: 'internal', detail: e?.message });
  }
};
