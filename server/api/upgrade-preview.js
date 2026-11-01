// XOLOLO Tier Empresarial · E6.6 — preview del cargo prorrateado del
// upgrade Starter → Enterprise.
//
// GET /api/subscription/upgrade-preview
// Auth: user logueado. Sin side effects — solo consulta Stripe.
//
// Flujo:
//   1. Lee stripeSubscriptionId del seller.
//   2. Resuelve prices Enterprise del mismo billing cycle.
//   3. Llama stripe.invoices.createPreview() simulando el swap de items.
//   4. Devuelve breakdown líneas: saldo a favor + cargo nuevo + total.
//
//   200 → {
//     ok: true,
//     today: {
//       lines: [{ description, amount, isCredit }],
//       subtotal, tax, total,
//       currency,
//     },
//     nextRenewal: { amount, currency, date },
//     starterPlan: 'annual' | 'monthly',
//     daysRemaining,
//   }
//   409 → { error: 'no_active_starter' | 'already_enterprise' }
//
// Pendiente: CFDI automático del cargo adicional. Se timbrará manual
// hasta que esté configurado el PAC Facturapi (ver spike #16).

const { getSdk } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const {
  getStripeBilling,
  resolvePricesByLookupKeys,
} = require('../api-util/stripeBilling');
const { PLANS, ENTERPRISE_PLANS, ENTERPRISE_SEATS } = require('../api-util/billingPlans');

const centsToPesos = c => Number(c) / 100;

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

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
    const starterPrice = prices[starterLookup];
    const enterprisePrice = prices[enterprisePlanLookup];
    const seatPrice = prices[seatLookup];
    const missing = [];
    if (!starterPrice) missing.push(starterLookup);
    if (!enterprisePrice) missing.push(enterprisePlanLookup);
    if (!seatPrice) missing.push(seatLookup);
    if (missing.length > 0) {
      // eslint-disable-next-line no-console
      console.error('[upgrade-preview] Prices faltantes en Stripe:', missing.join(', '));
      return res.status(503).json({
        error: 'prices_not_configured',
        missing,
        hint: 'Corre `yarn setup-stripe-billing` en el entorno para crear los Prices Enterprise.',
      });
    }

    // Lee la sub Stripe para encontrar el item del Starter.
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
    const starterItem = stripeSub.items.data.find(
      it => it.price?.id === starterPrice.id || it.price?.lookup_key === starterLookup
    );
    if (!starterItem) {
      return res.status(409).json({ error: 'starter_item_not_found_in_stripe' });
    }

    const prorationDate = Math.floor(Date.now() / 1000);
    // createPreview es la API moderna del SDK v18+; retrieveUpcoming
    // es la legacy pero compatible. Elegimos la primera disponible.
    const usesCreatePreview = typeof stripe.invoices.createPreview === 'function';
    const usesRetrieveUpcoming = typeof stripe.invoices.retrieveUpcoming === 'function';
    if (!usesCreatePreview && !usesRetrieveUpcoming) {
      // eslint-disable-next-line no-console
      console.error('[upgrade-preview] SDK Stripe sin createPreview ni retrieveUpcoming');
      return res.status(500).json({
        error: 'stripe_sdk_outdated',
        detail: 'El SDK de Stripe no expone createPreview ni retrieveUpcoming',
      });
    }

    // El shape del argumento difiere ligeramente entre ambas APIs:
    //   - retrieveUpcoming (legacy): subscription_items + subscription_proration_date
    //   - createPreview (moderno):   subscription_details.{items, proration_date, proration_behavior}
    const upcoming = usesCreatePreview
      ? await stripe.invoices.createPreview({
          customer: stripeSub.customer,
          subscription: stripeSub.id,
          subscription_details: {
            items: [{ id: starterItem.id, price: enterprisePrice.id, quantity: 1 }],
            proration_behavior: 'always_invoice',
            proration_date: prorationDate,
          },
        })
      : await stripe.invoices.retrieveUpcoming({
          customer: stripeSub.customer,
          subscription: stripeSub.id,
          subscription_items: [
            { id: starterItem.id, price: enterprisePrice.id, quantity: 1 },
          ],
          subscription_proration_behavior: 'always_invoice',
          subscription_proration_date: prorationDate,
        });

    // Lineas del preview — Stripe devuelve una por cada partida prorratada:
    //   type: 'invoiceitem' con amount negativo = saldo a favor del plan viejo
    //   type: 'subscription' con amount positivo = cargo del plan nuevo
    const linesRaw = upcoming.lines?.data || [];
    const lines = linesRaw.map(l => ({
      description: l.description || (l.amount < 0 ? 'Saldo a favor plan anterior' : 'Cargo plan nuevo'),
      amount: centsToPesos(l.amount),
      isCredit: Number(l.amount) < 0,
      period: l.period
        ? {
            start: new Date(l.period.start * 1000).toISOString(),
            end: new Date(l.period.end * 1000).toISOString(),
          }
        : null,
    }));

    // Días restantes del ciclo actual (para contexto en la UI).
    const periodEnd = stripeSub.current_period_end;
    const daysRemaining = periodEnd
      ? Math.max(0, Math.ceil((periodEnd - prorationDate) / 86400))
      : null;

    return res.json({
      ok: true,
      today: {
        lines,
        subtotal: centsToPesos(upcoming.subtotal || 0),
        tax: centsToPesos(upcoming.tax || 0),
        total: centsToPesos(upcoming.amount_due || upcoming.total || 0),
        currency: (upcoming.currency || 'mxn').toUpperCase(),
      },
      nextRenewal: {
        amount: centsToPesos(enterprisePrice.unit_amount || 0),
        currency: (enterprisePrice.currency || 'mxn').toUpperCase(),
        date: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      },
      starterPlan: billing,
      daysRemaining,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[upgrade-preview] error:', e?.message || e, e?.type || '', e?.code || '');
    return res.status(500).json({
      error: 'internal',
      detail: e?.message || null,
      stripeType: e?.type || null,
      stripeCode: e?.code || null,
    });
  }
};
