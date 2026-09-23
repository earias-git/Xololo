// XOLOLO Track C (docs/SUBSCRIPTIONS_V1.md §3.1, §3.2): fuente única
// de verdad de los planes de suscripción y el cargo de onboarding.
// Referenciado por el script de setup (server/scripts/setup-stripe-billing.js)
// que crea/actualiza los Products/Prices en Stripe, y por el endpoint
// de checkout (próximo, roadmap #4) que resuelve el Price actual por
// `lookupKey` en vez de guardar IDs fijos — así cambiar un monto es
// crear una Price nueva con el mismo lookup_key (Stripe la vuelve la
// "activa" para ese lookup_key) sin tocar código ni env vars.

const CURRENCY = 'mxn';

const PLANS = {
  annual: {
    lookupKey: 'xololo-plan-anual',
    productName: 'Xololo · Suscripción anual',
    productDescription:
      'Suscripción anual de seller Xololo. Se renueva automáticamente cada año al mismo monto, salvo que se pause antes del aniversario.',
    unitAmount: 202800, // $2,028.00 MXN, IVA incluido
    currency: CURRENCY,
    recurring: { interval: 'year' },
  },
  monthly: {
    lookupKey: 'xololo-plan-mensual',
    productName: 'Xololo · Suscripción mensual',
    productDescription:
      'Suscripción mensual de seller Xololo. Se renueva automáticamente cada mes, cancelable en cualquier momento (pausar cuenta).',
    unitAmount: 22900, // $229.00 MXN, IVA incluido
    currency: CURRENCY,
    recurring: { interval: 'month' },
  },
};

const ONBOARDING_FEE = {
  lookupKey: 'xololo-onboarding-fee',
  productName: 'Xololo · Cuota de onboarding',
  productDescription:
    'Cargo único (no se repite en renovaciones) que cubre hasta 3 horas de asesoría con un consultor Xololo.',
  unitAmount: 49900, // $499.00 MXN, IVA incluido
  currency: CURRENCY,
  // Sin `recurring` — es un Price de una sola vez, se agrega como
  // segundo line_item en el Checkout Session (mode: 'subscription'),
  // Stripe lo cobra sólo en la primera invoice.
};

module.exports = { PLANS, ONBOARDING_FEE };
