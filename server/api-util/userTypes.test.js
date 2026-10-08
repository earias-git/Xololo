const {
  SELLER_USER_TYPE,
  CUSTOMER_USER_TYPE,
  isSellerUserType,
  isCustomerUserType,
  canonicalizeUserType,
} = require('./userTypes');

describe('userTypes helper', () => {
  describe('isSellerUserType', () => {
    test('acepta valor canónico', () => {
      expect(isSellerUserType('provider')).toBe(true);
    });

    test('acepta variantes históricas en español e inglés', () => {
      ['Proveedor', 'proveedor', 'PROVEEDOR', 'Provider', 'seller', 'Vendedor', 'merchant'].forEach(
        v => expect(isSellerUserType(v)).toBe(true)
      );
    });

    test('trim antes de comparar', () => {
      expect(isSellerUserType('  provider  ')).toBe(true);
      expect(isSellerUserType('\tProveedor\n')).toBe(true);
    });

    test('rechaza customers y valores desconocidos', () => {
      expect(isSellerUserType('customer')).toBe(false);
      expect(isSellerUserType('Comprador')).toBe(false);
      expect(isSellerUserType('admin')).toBe(false);
      expect(isSellerUserType('')).toBe(false);
      expect(isSellerUserType(null)).toBe(false);
      expect(isSellerUserType(undefined)).toBe(false);
      expect(isSellerUserType(123)).toBe(false);
    });
  });

  describe('isCustomerUserType', () => {
    test('acepta valor canónico y variantes', () => {
      ['customer', 'Comprador', 'COMPRADOR', 'buyer', 'Cliente', 'consumer'].forEach(v =>
        expect(isCustomerUserType(v)).toBe(true)
      );
    });

    test('rechaza sellers y valores desconocidos', () => {
      expect(isCustomerUserType('provider')).toBe(false);
      expect(isCustomerUserType('Proveedor')).toBe(false);
      expect(isCustomerUserType(null)).toBe(false);
    });
  });

  describe('canonicalizeUserType', () => {
    test('normaliza variantes de seller a "provider"', () => {
      expect(canonicalizeUserType('Proveedor')).toBe(SELLER_USER_TYPE);
      expect(canonicalizeUserType('seller')).toBe('provider');
      expect(canonicalizeUserType('Vendedor')).toBe('provider');
    });

    test('normaliza variantes de customer a "customer"', () => {
      expect(canonicalizeUserType('Comprador')).toBe(CUSTOMER_USER_TYPE);
      expect(canonicalizeUserType('buyer')).toBe('customer');
    });

    test('devuelve null para valores desconocidos', () => {
      expect(canonicalizeUserType('admin')).toBe(null);
      expect(canonicalizeUserType('')).toBe(null);
      expect(canonicalizeUserType(null)).toBe(null);
    });
  });
});
