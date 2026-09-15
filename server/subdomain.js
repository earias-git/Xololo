// XOLOLO: extrae el subdominio de tienda ("slug") del Host header y
// determina si corresponde renderizar un storefront de seller o el
// marketplace general.
//
// Regla:
//  - Se ignora el puerto y "www".
//  - En prod: xololo.mx → null; kike.xololo.mx → "kike".
//  - En dev con Chrome: localhost → null; kike.localhost → "kike".
//    Chrome resuelve *.localhost sin necesidad de editar /etc/hosts.
//  - En Render y onrender.com (health checks + preview URL) → siempre null.
//  - Subdominios reservados (www, api, staging, admin...) → null.

const RESERVED_SUBDOMAINS = new Set([
  'www',
  'api',
  'app',
  'admin',
  'staging',
  'dev',
  'test',
  'mail',
  'email',
  'smtp',
  'ftp',
  'blog',
  'docs',
  'help',
  'support',
  'assets',
  'cdn',
  'static',
  'my',
  'account',
  'signup',
  'login',
  'auth',
  'oauth',
  'stripe',
  'webhook',
  'webhooks',
  'render',
]);

// Hosts que nunca corresponden a un storefront aunque parezcan tener
// subdominio (onrender.com sirve xololo-staging.onrender.com; localhost
// sin subdominio en Chrome; etc.).
const NON_STOREFRONT_ROOTS = ['onrender.com', 'render.com', 'ngrok.io', 'lvh.me'];

const isNonStorefrontHost = hostname => {
  return NON_STOREFRONT_ROOTS.some(root => hostname.endsWith(root));
};

// Slug válido: 2-40 chars, letras minúsculas, dígitos y guiones. Debe
// empezar y terminar con letra o dígito.
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

const isValidSlug = candidate => {
  if (!candidate || typeof candidate !== 'string') return false;
  if (RESERVED_SUBDOMAINS.has(candidate)) return false;
  return SLUG_PATTERN.test(candidate);
};

/**
 * @param {string} hostHeader — Ej: "kike.xololo.mx", "xololo.mx:3000",
 *   "kike.localhost:3000", "xololo-staging.onrender.com".
 * @returns {string|null} slug del storefront, o null si es el dominio raíz.
 */
const extractStorefrontSlug = hostHeader => {
  if (!hostHeader || typeof hostHeader !== 'string') return null;

  // Quita puerto si viene en el Host (localhost:3000, xololo.mx:443, etc.)
  const hostname = hostHeader.split(':')[0].toLowerCase().trim();

  if (!hostname) return null;
  if (isNonStorefrontHost(hostname)) return null;

  const parts = hostname.split('.');

  // Caso especial para dev: kike.localhost → parts = ['kike', 'localhost'].
  // Solo tiene 2 segmentos, pero el primero es el slug.
  if (parts.length === 2 && parts[1] === 'localhost') {
    return isValidSlug(parts[0]) ? parts[0] : null;
  }

  // localhost puro sin subdominio.
  if (parts.length === 1) return null;

  // Para xololo.mx (2 segmentos) el subdominio no existe.
  if (parts.length < 3) return null;

  // parts = ['kike', 'xololo', 'mx'] → subdominio = 'kike'.
  // Si hay más segmentos ('sub.kike.xololo.mx'), tomamos solo el primero
  // por ahora — casos anidados los ignoramos hasta que exista un uso real.
  const candidate = parts[0];
  return isValidSlug(candidate) ? candidate : null;
};

module.exports = {
  extractStorefrontSlug,
  // Exportado para tests o para uso desde otros módulos si aparece
  // necesidad de saber si algo es reservado sin duplicar la lista.
  RESERVED_SUBDOMAINS,
};
