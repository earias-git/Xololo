// XOLOLO 2026-10-27: rate limiting por tipo de endpoint.
//
// Antes del fix no había ningún límite en ninguno. Un atacante
// podía: enumerar listings/usuarios, scrapear catálogo entero,
// brute-force a /ops, abusar del endpoint IA (gasto Anthropic
// ilimitado), spam de email reset passwords, etc.
//
// Diseño:
//   - Clave de rate: user id si está autenticado, IP si no.
//     Esto previene que un atacante use un pool de IPs saltando
//     entre usuarios autenticados sin disparar el límite.
//   - Buckets separados por categoría — un endpoint de pago no
//     se bloquea porque alguien abusó del endpoint de cotización.
//   - standardHeaders=true: devuelve RateLimit-* headers legibles.
//   - trustProxy: Render pone la IP real en x-forwarded-for.
//
// Buckets:
//   generic   — endpoints normales (lecturas, cotizaciones públicas)
//   payment   — initiate, confirm, payouts (más estrictos)
//   ai        — endpoints que llaman a Anthropic (gasto $$)
//   auth      — login, reset password, signup (brute force defense)
//   ops       — /ops/* operator endpoints

const rateLimit = require('express-rate-limit');

// Clave de identificación: user id > ip. Si está autenticado (JWT en
// cookie que Sharetribe pone), su id viene en req.user. Caemos a la IP
// (que Render pone en x-forwarded-for cuando confiamos en el proxy).
const keyGenerator = req => {
  const userId =
    req.user?.id || req.user?.uuid || req.operator?.id || req.operatorId;
  if (userId) return `user:${userId}`;
  // El trustProxy del server/index.js hace que req.ip venga del XFF.
  return `ip:${req.ip || 'unknown'}`;
};

const buildLimiter = ({ windowMs, max, name }) =>
  rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7', // RateLimit-Policy + RateLimit headers
    legacyHeaders: false,
    keyGenerator,
    handler: (req, res) => {
      // eslint-disable-next-line no-console
      console.warn(`[rate-limit] bucket=${name} key=${keyGenerator(req)} path=${req.path}`);
      res.status(429).json({
        error: 'rate_limited',
        details: `Demasiadas solicitudes. Intenta de nuevo en unos segundos.`,
        bucket: name,
      });
    },
  });

// Generic: 60 req/min por clave. Para lecturas normales y endpoints
// públicos ligeros (geoip, postal-code, cotización pública con cache).
const generic = buildLimiter({
  windowMs: 60 * 1000,
  max: 60,
  name: 'generic',
});

// Payment: 10 req/min — initiate-privileged, confirm, transition.
// Un flujo normal usa 2-3 llamadas por tx. 10/min es generoso para
// humanos pero cierra automatización masiva.
const payment = buildLimiter({
  windowMs: 60 * 1000,
  max: 10,
  name: 'payment',
});

// AI: 20 req/5min por clave. Las calls a Anthropic cuestan ~$0.01 cada
// una. Un atacante sin límite gasta $500 USD/hora. Con esto, máximo
// ~$2.40 USD/hora por atacante.
const ai = buildLimiter({
  windowMs: 5 * 60 * 1000,
  max: 20,
  name: 'ai',
});

// Auth: 5 req/15min — password reset, signup. Brute force defense.
const auth = buildLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  name: 'auth',
});

// Ops: 30 req/min — endpoints operacionales. Operadores legítimos
// trabajan rápido pero no al nivel de un script.
const ops = buildLimiter({
  windowMs: 60 * 1000,
  max: 30,
  name: 'ops',
});

// Shipping quote: 30 req/min — el ShippingRateSelector cotiza al tipear
// cada letra tras debounce; permitimos holgura razonable para no
// bloquear usuarios reales que editan la dirección varias veces.
const shippingQuote = buildLimiter({
  windowMs: 60 * 1000,
  max: 30,
  name: 'shipping-quote',
});

module.exports = {
  generic,
  payment,
  ai,
  auth,
  ops,
  shippingQuote,
};
