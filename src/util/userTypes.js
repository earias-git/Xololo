// XOLOLO: valores canónicos del campo `publicData.userType` en el user
// profile de Sharetribe. Internamente SIEMPRE se compara contra el valor
// canónico (seguir el estándar inglés que usa el core).
//
// Problema que resuelve: la hosted config de User types en Console puede
// definir keys en español (p.ej. "Proveedor", "Comprador"), y los users
// registrados con esos keys quedan con `publicData.userType = "Proveedor"`.
// Los filtros server-side (featured-stores, admin-metrics, etc.) requieren
// comparaciones estrictas y dejaban fuera a esos sellers.
//
// Este helper acepta todas las variantes conocidas (histórico + futuro) y
// canonicaliza. El Sub-commit 2 incluye un script de backfill para
// re-escribir publicData.userType al valor canónico en todos los users.
//
// Si en el futuro Console agrega otra key legítima (p.ej. "agency"),
// extiende SELLER_ALIASES / CUSTOMER_ALIASES aquí sin tocar el resto.

export const SELLER_USER_TYPE = 'provider';
export const CUSTOMER_USER_TYPE = 'customer';

// Variantes conocidas (lowercase para comparar case-insensitive).
// Incluimos español/inglés y sinónimos razonables.
const SELLER_ALIASES = new Set([
  'provider',
  'proveedor',
  'seller',
  'vendor',
  'vendedor',
  'merchant',
]);

const CUSTOMER_ALIASES = new Set([
  'customer',
  'comprador',
  'buyer',
  'client',
  'cliente',
  'consumer',
]);

const normalize = raw => (typeof raw === 'string' ? raw.trim().toLowerCase() : '');

/**
 * ¿El valor representa a un seller? Acepta todas las variantes conocidas.
 * @param {string} userType - valor crudo de publicData.userType
 * @returns {boolean}
 */
export const isSellerUserType = userType => SELLER_ALIASES.has(normalize(userType));

/**
 * ¿El valor representa a un customer? Acepta todas las variantes conocidas.
 * @param {string} userType - valor crudo de publicData.userType
 * @returns {boolean}
 */
export const isCustomerUserType = userType => CUSTOMER_ALIASES.has(normalize(userType));

/**
 * Devuelve el valor canónico ('provider' o 'customer') o null si no se
 * reconoce. Útil para persistir normalizado antes de enviar al backend.
 * @param {string} userType - valor crudo
 * @returns {string|null} 'provider' | 'customer' | null
 */
export const canonicalizeUserType = userType => {
  if (isSellerUserType(userType)) return SELLER_USER_TYPE;
  if (isCustomerUserType(userType)) return CUSTOMER_USER_TYPE;
  return null;
};
