// XOLOLO: extracción del "slug" de storefront a partir de un hostname.
// En prod el server lo detecta en server/subdomain.js y lo inyecta vía
// SSR. Este archivo es el equivalente para el cliente — sirve para dev
// mode (webpack dev server no usa server/index.js) y como fallback si el
// server no pudo poblar el estado (hidratación desincronizada).
//
// La lógica DEBE quedar espejo de server/subdomain.js. Si cambias uno,
// cambia el otro.

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

const NON_STOREFRONT_ROOTS = ['onrender.com', 'render.com', 'ngrok.io', 'lvh.me'];

const isNonStorefrontHost = hostname => NON_STOREFRONT_ROOTS.some(root => hostname.endsWith(root));

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

const isValidSlug = candidate => {
  if (!candidate || typeof candidate !== 'string') return false;
  if (RESERVED_SUBDOMAINS.has(candidate)) return false;
  return SLUG_PATTERN.test(candidate);
};

export const extractStorefrontSlug = hostHeader => {
  if (!hostHeader || typeof hostHeader !== 'string') return null;
  const hostname = hostHeader.split(':')[0].toLowerCase().trim();
  if (!hostname) return null;
  if (isNonStorefrontHost(hostname)) return null;

  const parts = hostname.split('.');

  if (parts.length === 2 && parts[1] === 'localhost') {
    return isValidSlug(parts[0]) ? parts[0] : null;
  }

  if (parts.length === 1) return null;
  if (parts.length < 3) return null;

  const candidate = parts[0];
  return isValidSlug(candidate) ? candidate : null;
};
