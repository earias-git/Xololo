// XOLOLO Track C (docs/SUBSCRIPTIONS_V1.md §3.5): status de la
// suscripción del seller autenticado + confirmación post-checkout.
//
// Contrato:
//   GET /api/seller-subscription
//   Auth: user logueado. Devuelve SU propio estado de suscripción.
//   200 → {
//     plan: 'annual' | 'monthly' | null,
//     status: 'active' | 'past_due' | 'canceled' | 'none',
//     currentPeriodEnd: 'ISO' | null,
//     cancelAtPeriodEnd: boolean,
//     onboardingFeePaid: boolean
//   }
//   401 → { error: 'unauthorized' }
//
//   POST /api/seller-subscription
//   Body: { sessionId }
//   Auth: user logueado. Confirma un Checkout Session recién completado
//   (llamado desde el success_url) y persiste el estado. Verifica que
//   el session le pertenezca al user logueado antes de escribir nada.
//   200 → { ok: true, status }
//   400 → { error: 'invalid_request' }
//   403 → { error: 'forbidden' }  (session no es de este user)
//   401 → { error: 'unauthorized' }
//
// Nota: esto es un puente hasta que exista el webhook (roadmap #5).
// Cubre el alta inicial (el seller vuelve del Checkout con éxito) pero
// NO renovaciones ni fallos de pago posteriores — eso requiere el
// webhook escuchando eventos async de Stripe.

const { getSdk } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { getStripeBilling, syncSubscriptionMetadata } = require('../api-util/stripeBilling');

const getCurrentSellerId = async (req, res) => {
  const sdk = getSdk(req, res);
  const uResp = await sdk.currentUser.show();
  return uResp.data.data.id.uuid;
};

const getStatus = async (req, res) => {
  let sellerId;
  try {
    sellerId = await getCurrentSellerId(req, res);
  } catch (e) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    const resp = await isdk.users.show({ id: sellerId });
    const sub = resp.data.data.attributes?.profile?.metadata?.xololoSubscription || {};
    // XOLOLO Tier Empresarial · E3: exponer `tier` para que el UI
    // sepa si mostrar la tab "Equipo". Default 'starter' si hay
    // suscripción activa, null si not. 'enterprise' lo setea E6.
    const status = sub.status || 'none';
    const explicitTier = sub.tier;
    const tier = explicitTier
      ? explicitTier
      : status === 'active'
      ? 'starter'
      : null;
    return res.json({
      plan: sub.plan || null,
      status,
      tier,
      currentPeriodEnd: sub.currentPeriodEnd || null,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd === true,
      onboardingFeePaid: sub.onboardingFeePaid === true,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[seller-subscription] get error:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

const confirmCheckout = async (req, res) => {
  const sessionId = String(req.body?.sessionId || '').trim();
  if (!sessionId) return res.status(400).json({ error: 'invalid_request' });

  let sellerId;
  try {
    sellerId = await getCurrentSellerId(req, res);
  } catch (e) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const stripe = getStripeBilling();
  if (!stripe) return res.status(500).json({ error: 'stripe_billing_missing' });

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription'],
    });

    if (session.metadata?.xololoSellerId !== sellerId) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const subscription = session.subscription;
    if (!subscription || session.payment_status !== 'paid') {
      return res.status(400).json({ error: 'invalid_request', details: 'checkout_not_paid' });
    }

    const onboardingIncluded = session.metadata?.xololoOnboardingIncluded === 'true';
    // XOLOLO Tier Empresarial · E6: setea tier + seatPriceId desde el
    // metadata del checkout. Para Enterprise agrega seats default.
    const tier = session.metadata?.xololoTier || 'starter';
    const seatPriceId = session.metadata?.xololoSeatPriceId || null;
    const extra = { tier };
    if (onboardingIncluded) extra.onboardingFeePaid = true;
    if (tier === 'enterprise') {
      extra.seatPriceId = seatPriceId;
      extra.seatsExtraPaid = 0;
    }
    const updated = await syncSubscriptionMetadata({
      isdk,
      sellerId,
      subscription,
      plan: session.metadata?.xololoPlan,
      extra,
    });

    // Enterprise: inicializar metadata.xololoTeam.seats.included=2 si
    // no existe aún (sellers pre-E6 no tienen el bloque).
    if (tier === 'enterprise') {
      try {
        const resp = await isdk.users.show({ id: sellerId });
        const md = resp.data.data.attributes?.profile?.metadata || {};
        const prevTeam = md.xololoTeam;
        if (!prevTeam || !prevTeam.seats) {
          await isdk.users.updateProfile({
            id: sellerId,
            metadata: {
              xololoTeam: {
                collaborators: prevTeam?.collaborators || [],
                seats: { used: 0, included: 2, extraPaid: 0 },
                actions: prevTeam?.actions || [],
                updatedAt: new Date().toISOString(),
              },
            },
          });
        }
      } catch (_e) {
        // non-fatal — se puede seedear después al primer invite.
      }
    }

    return res.json({ ok: true, status: updated.status, tier });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[seller-subscription] confirm error:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

module.exports = async (req, res) => {
  if (req.method === 'POST') return confirmCheckout(req, res);
  return getStatus(req, res);
};
