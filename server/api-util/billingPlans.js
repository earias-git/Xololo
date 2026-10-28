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

// XOLOLO Tier Empresarial · E6 — planes Empresarial + seats add-on.
// Mismo patrón que PLANS: lookupKey + yarn setup-stripe-billing crea
// los Prices en Stripe automáticamente.
//
// Pricing acordado:
//   Enterprise mensual: $499 MXN/mes
//   Enterprise anual: $399 MXN/mes = $4,788/año
//   Seat extra mensual: $99 MXN/mes
//   Seat extra anual: $69 MXN/mes = $828/año
//
// En el Checkout, el plan base va con quantity=1 y el seat Price va
// con quantity=0 inicialmente — se bumpea con /api/team/buy-seat.
// Al tener 2 colaboradores "included" (seats.included=2), nunca se
// cobran los dos primeros extras.
const ENTERPRISE_PLANS = {
  enterprise_annual: {
    lookupKey: 'xololo-enterprise-plan-anual',
    productName: 'Xololo Empresarial · Suscripción anual',
    productDescription:
      'Suscripción Empresarial anual: hasta 2 colaboradores incluidos + permisos granulares + audit log cross-user. Se renueva automáticamente.',
    unitAmount: 478800, // $4,788.00 MXN (= $399/mes anual)
    currency: CURRENCY,
    recurring: { interval: 'year' },
    tier: 'enterprise',
    billing: 'annual',
  },
  enterprise_monthly: {
    lookupKey: 'xololo-enterprise-plan-mensual',
    productName: 'Xololo Empresarial · Suscripción mensual',
    productDescription:
      'Suscripción Empresarial mensual: hasta 2 colaboradores incluidos + permisos granulares. Cancelable en cualquier momento.',
    unitAmount: 49900, // $499.00 MXN
    currency: CURRENCY,
    recurring: { interval: 'month' },
    tier: 'enterprise',
    billing: 'monthly',
  },
};

const ENTERPRISE_SEATS = {
  enterprise_annual: {
    lookupKey: 'xololo-enterprise-seat-anual',
    productName: 'Xololo Empresarial · Asiento adicional (anual)',
    productDescription:
      'Asiento adicional de colaborador para una suscripción Empresarial anual.',
    unitAmount: 82800, // $828.00 MXN (= $69/mes anual)
    currency: CURRENCY,
    recurring: { interval: 'year' },
    pairedPlan: 'enterprise_annual',
  },
  enterprise_monthly: {
    lookupKey: 'xololo-enterprise-seat-mensual',
    productName: 'Xololo Empresarial · Asiento adicional (mensual)',
    productDescription:
      'Asiento adicional de colaborador para una suscripción Empresarial mensual.',
    unitAmount: 9900, // $99.00 MXN
    currency: CURRENCY,
    recurring: { interval: 'month' },
    pairedPlan: 'enterprise_monthly',
  },
};

// Lookup inverso: dado un lookupKey, decir si es un plan y de qué tier.
// Usado por el webhook / confirm checkout para setear
// metadata.xololoSubscription.tier.
const TIER_BY_LOOKUP_KEY = {
  [PLANS.annual.lookupKey]: { tier: 'starter', billing: 'annual' },
  [PLANS.monthly.lookupKey]: { tier: 'starter', billing: 'monthly' },
  [ENTERPRISE_PLANS.enterprise_annual.lookupKey]: {
    tier: 'enterprise',
    billing: 'annual',
  },
  [ENTERPRISE_PLANS.enterprise_monthly.lookupKey]: {
    tier: 'enterprise',
    billing: 'monthly',
  },
};

const ENTERPRISE_SEATS_INCLUDED_DEFAULT = 2;

module.exports = {
  PLANS,
  ONBOARDING_FEE,
  ENTERPRISE_PLANS,
  ENTERPRISE_SEATS,
  TIER_BY_LOOKUP_KEY,
  ENTERPRISE_SEATS_INCLUDED_DEFAULT,
};
