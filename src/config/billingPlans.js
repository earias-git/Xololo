// XOLOLO Track C (docs/SUBSCRIPTIONS_V1.md §3.1): mirror cliente de
// server/api-util/billingPlans.js — sólo lo necesario para pintar las
// 2 tarjetas de plan en SubscriptionPage. Los montos reales que se
// cobran siempre los resuelve el server desde Stripe (lookup_key); si
// esto se desincroniza es sólo un problema de copy, no de cobro.

export const BILLING_PLANS = [
  {
    key: 'annual',
    label: 'Plan anual',
    priceLabel: '$2,028 MXN',
    periodLabel: 'al año',
    hint: 'Equivale a $169/mes · IVA incluido · se renueva automáticamente cada año',
    highlight: true,
  },
  {
    key: 'monthly',
    label: 'Plan mensual',
    priceLabel: '$229 MXN',
    periodLabel: 'al mes',
    hint: 'IVA incluido · se renueva automáticamente cada mes · cancelable cuando quieras',
    highlight: false,
  },
];

export const ONBOARDING_FEE_LABEL = '$499 MXN';

export const STATUS_LABELS = {
  active: { text: 'Activa', tone: 'approved' },
  past_due: { text: 'Pago pendiente', tone: 'pending' },
  canceled: { text: 'Cancelada', tone: 'rejected' },
};
