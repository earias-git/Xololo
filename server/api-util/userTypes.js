// XOLOLO: mirror server-side del helper src/util/userTypes.js. Mismo
// contrato, mismos aliases. Duplicamos aquí porque el server (CommonJS)
// no puede importar módulos ES del frontend sin bundler.
//
// Si extiendes los aliases, actualiza AMBOS archivos.

const SELLER_USER_TYPE = 'provider';
const CUSTOMER_USER_TYPE = 'customer';

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

const isSellerUserType = userType => SELLER_ALIASES.has(normalize(userType));
const isCustomerUserType = userType => CUSTOMER_ALIASES.has(normalize(userType));

const canonicalizeUserType = userType => {
  if (isSellerUserType(userType)) return SELLER_USER_TYPE;
  if (isCustomerUserType(userType)) return CUSTOMER_USER_TYPE;
  return null;
};

module.exports = {
  SELLER_USER_TYPE,
  CUSTOMER_USER_TYPE,
  isSellerUserType,
  isCustomerUserType,
  canonicalizeUserType,
};
