// XOLOLO Track #27 Fase 3: helper para ejecutar transfers reales a la
// cuenta Stripe Connect del seller.
//
// Modelo de pagos de Xololo:
//   - El cobro al buyer entra a la cuenta plataforma Stripe de Xololo.
//   - Cuando una venta se completa Y el seller ya pasó el gate del
//     payout, Ops libera desde /ops/payout-queue y este helper ejecuta
//     el transfer real.
//   - Idempotencia: cada transfer usa `idempotency_key = tx-{txId}`
//     para que un retry no duplique el movimiento (Stripe devuelve
//     el mismo Transfer si ya existe uno con esa key).
//
// Fallos esperados y cómo los tratamos:
//   - STRIPE_SECRET_KEY ausente → return { ok:false, code:'stripe_not_configured' }
//   - seller sin stripeAccountId → { ok:false, code:'seller_no_stripe_account' }
//     (debería estar bloqueado por el gate, pero chequeamos defensivamente)
//   - amount <= 0 → { ok:false, code:'invalid_amount' }
//   - error de Stripe → { ok:false, code:'stripe_error', message }
//
// Rationale: toda vía de falla deja marcada su razón en la tx metadata
// para que PayoutQueueView muestre el estado y Ops decida reintentar o
// revisar manualmente desde Stripe dashboard.

const Stripe = require('stripe');

let cached = null;
const getStripe = () => {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  cached = new Stripe(key, { apiVersion: '2024-06-20' });
  return cached;
};

// Resuelve el Stripe Account ID del seller desde Sharetribe.
// En Sharetribe el stripeAccount es una relación del user, hay que
// include='stripeAccount' en el show.
const getSellerStripeAccountId = async (isdk, sellerId) => {
  try {
    const resp = await isdk.users.show({ id: sellerId, include: ['stripeAccount'] });
    const included = resp.data.included || [];
    const stripeAccount = included.find(inc => inc.type === 'stripeAccount');
    if (!stripeAccount) return null;
    return stripeAccount.attributes?.stripeAccountId || null;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[stripePayouts] getSellerStripeAccountId error:', e?.message);
    return null;
  }
};

// Ejecuta un transfer único a la cuenta Connect del seller.
// `txId` se usa como idempotency key — reintento no duplica.
const createPayoutTransfer = async ({ txId, sellerStripeAccountId, amountSubunits, currency = 'mxn', description }) => {
  const stripe = getStripe();
  if (!stripe) {
    return { ok: false, code: 'stripe_not_configured' };
  }
  if (!sellerStripeAccountId) {
    return { ok: false, code: 'seller_no_stripe_account' };
  }
  if (!Number.isFinite(amountSubunits) || amountSubunits <= 0) {
    return { ok: false, code: 'invalid_amount' };
  }
  try {
    const transfer = await stripe.transfers.create(
      {
        amount: Math.round(amountSubunits),
        currency: String(currency).toLowerCase(),
        destination: sellerStripeAccountId,
        description: description || `Xololo payout tx ${txId}`,
        metadata: { xololoTxId: txId },
      },
      {
        // Idempotencia: Stripe devuelve el mismo Transfer si la key
        // ya fue usada, no crea uno nuevo.
        idempotencyKey: `xololo-payout-${txId}`,
      }
    );
    return {
      ok: true,
      transferId: transfer.id,
      amountTransferred: transfer.amount,
      currency: transfer.currency,
    };
  } catch (e) {
    return {
      ok: false,
      code: 'stripe_error',
      message: e?.message || 'unknown',
      stripeCode: e?.code || null,
    };
  }
};

module.exports = {
  getStripe,
  getSellerStripeAccountId,
  createPayoutTransfer,
};
