// XOLOLO Tier Empresarial · E6 — endpoints de seats + downgrade.
//
// POST /api/team/buy-seat
//   Body: { targetSellerId }  (= admin, se valida en requirePermission('team'))
//   Agrega 1 asiento adicional a la suscripción Stripe actual: bump
//   quantity del seat Price. Al éxito, actualiza
//   metadata.xololoSubscription.seatsExtraPaid y
//   metadata.xololoTeam.seats.extraPaid.
//   200 → { seats: { included, extraPaid, used } }
//   409 → { error: 'not_enterprise' | 'no_seat_price_configured' }
//
// POST /api/team/downgrade
//   Body: { targetSellerId }
//   Downgrade a Starter. Bloqueado si hay colaboradores activos.
//   409 → { error: 'has_collaborators', count }
//   Al éxito: cancela el seat line_item (quantity=0) y la sub baja al
//   plan starter. Sincroniza tier='starter'.
//   NOTA: para v1, el "downgrade real" se implementa como "pausa la
//   sub Enterprise" — el seller tiene que crear una nueva Starter
//   después. Flow completo (switch via Stripe prorating) queda para v2.

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { getStripeBilling } = require('../api-util/stripeBilling');
const { readTeam, recordTeamAction } = require('../api-util/teamStore');

// ============================================================
// POST /team/buy-seat
// ============================================================

const buySeat = async (req, res) => {
  const adminId = req.actingAs.adminId;
  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });
  const stripe = getStripeBilling();
  if (!stripe) return res.status(500).json({ error: 'stripe_billing_missing' });

  try {
    const resp = await isdk.users.show({ id: adminId });
    const md = resp.data.data.attributes?.profile?.metadata || {};
    const sub = md.xololoSubscription || {};
    if (sub.tier !== 'enterprise' || sub.status !== 'active') {
      return res.status(409).json({ error: 'not_enterprise' });
    }
    const seatPriceId = sub.seatPriceId;
    if (!seatPriceId) {
      return res.status(409).json({ error: 'no_seat_price_configured' });
    }
    const stripeSubId = sub.stripeSubscriptionId;
    if (!stripeSubId) {
      return res.status(409).json({ error: 'no_stripe_subscription' });
    }

    // Lee la sub actual. Si el seat Price ya está como line_item, bumpea
    // quantity+1; si no, lo agrega.
    const stripeSub = await stripe.subscriptions.retrieve(stripeSubId);
    const seatItem = stripeSub.items.data.find(it => it.price?.id === seatPriceId);
    if (seatItem) {
      await stripe.subscriptions.update(stripeSubId, {
        items: [{ id: seatItem.id, quantity: (seatItem.quantity || 0) + 1 }],
        proration_behavior: 'always_invoice',
      });
    } else {
      await stripe.subscriptions.update(stripeSubId, {
        items: [{ price: seatPriceId, quantity: 1 }],
        proration_behavior: 'always_invoice',
      });
    }

    // Sync local: bump seatsExtraPaid y team.seats.extraPaid.
    const nextSub = { ...sub, seatsExtraPaid: (Number(sub.seatsExtraPaid) || 0) + 1 };
    const prevTeam = md.xololoTeam || { collaborators: [], seats: { used: 0, included: 2, extraPaid: 0 }, actions: [] };
    const nextTeam = {
      ...prevTeam,
      seats: {
        ...prevTeam.seats,
        extraPaid: (prevTeam.seats?.extraPaid || 0) + 1,
      },
      updatedAt: new Date().toISOString(),
    };
    await isdk.users.updateProfile({
      id: adminId,
      metadata: {
        xololoSubscription: nextSub,
        xololoTeam: nextTeam,
      },
    });

    recordTeamAction({
      isdk,
      adminId,
      actor: {
        userId: req.actingAs.actorUserId,
        email: req.actingAs.actorEmail,
        name: req.actingAs.actorName,
      },
      action: 'team.seat_purchased',
      payload: {
        seatsIncluded: nextTeam.seats.included,
        seatsExtraPaid: nextTeam.seats.extraPaid,
      },
    });

    return res.json({ seats: nextTeam.seats });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[team.buySeat] error:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

// ============================================================
// POST /team/downgrade
// ============================================================

const downgrade = async (req, res) => {
  const adminId = req.actingAs.adminId;
  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });
  const stripe = getStripeBilling();
  if (!stripe) return res.status(500).json({ error: 'stripe_billing_missing' });

  try {
    const resp = await isdk.users.show({ id: adminId });
    const md = resp.data.data.attributes?.profile?.metadata || {};
    const sub = md.xololoSubscription || {};
    if (sub.tier !== 'enterprise') {
      return res.status(409).json({ error: 'not_enterprise' });
    }

    const team = readTeam(resp.data.data);
    const activeCollabs = (team.collaborators || []).filter(c =>
      ['invited', 'active', 'paused'].includes(c.status)
    );
    if (activeCollabs.length > 0) {
      return res.status(409).json({
        error: 'has_collaborators',
        count: activeCollabs.length,
        hint: 'Remueve a todos los colaboradores antes de hacer downgrade.',
      });
    }

    // Cancela la sub Enterprise con cancel_at_period_end=true. Al final
    // del periodo baja a Starter si el seller crea una nueva sub.
    // (v1 simple: no auto-crear la Starter — forzamos al seller a
    // elegir plan de nuevo).
    if (sub.stripeSubscriptionId) {
      await stripe.subscriptions.update(sub.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });
    }

    const nextSub = { ...sub, cancelAtPeriodEnd: true, downgradeRequestedAt: new Date().toISOString() };
    await isdk.users.updateProfile({
      id: adminId,
      metadata: { xololoSubscription: nextSub },
    });

    recordTeamAction({
      isdk,
      adminId,
      actor: {
        userId: req.actingAs.actorUserId,
        email: req.actingAs.actorEmail,
        name: req.actingAs.actorName,
      },
      action: 'team.downgrade_requested',
      payload: { periodEnd: sub.currentPeriodEnd },
    });

    return res.json({ ok: true, cancelAt: sub.currentPeriodEnd });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[team.downgrade] error:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

module.exports = { buySeat, downgrade };
