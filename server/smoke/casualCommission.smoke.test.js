// XOLOLO Nov 2026 — blindaje contra regresiones del cálculo de comisión
// por venta del casual_reseller.
//
// Qué protege:
//   - store (Starter/Empresarial): SOLO línea $14+IVA, NUNCA casual-commission
//   - casual_reseller: línea $14+IVA + línea xololo-casual-commission con
//     cálculo marginal 6/4/2
//   - Sin authorPublicData → default store (no agrega casual commission)
//
// Esta prueba es CRÍTICA: si alguien baja/sube los %, mete un bug de signo
// en la quantity, o se olvida de propagar authorPublicData desde los
// callers, se detecta aquí.

const {
  computeCasualCommissionSubunits,
  computeCasualCommissionWithIvaSubunits,
  LINE_ITEM_XOLOLO_CASUAL_COMMISSION,
  LINE_ITEM_XOLOLO_SERVICE_FEE,
} = require('../api-util/xololoFees');
const { transactionLineItems } = require('../api-util/lineItems');
const { types } = require('sharetribe-flex-sdk');
const { Money } = types;

// Mínimo listing stub que lineItems acepta.
const makeListing = (priceSubunits = 150000) => ({
  attributes: {
    publicData: { unitType: 'item' },
    price: new Money(priceSubunits, 'MXN'),
  },
});

const orderData = { stockReservationQuantity: 1 };

describe('casual commission — xololoFees helpers', () => {
  it('6% hasta $50,000 (ejemplo $500)', () => {
    expect(computeCasualCommissionSubunits(50000)).toBe(3000); // $30
  });

  it('6% exactamente en $50,000', () => {
    expect(computeCasualCommissionSubunits(5000000)).toBe(300000); // $3,000
  });

  it('6% + 4% para $75,000 → $4,000 base', () => {
    expect(computeCasualCommissionSubunits(7500000)).toBe(400000);
  });

  it('6+4+2 para $150,000 → $6,000 base', () => {
    expect(computeCasualCommissionSubunits(15000000)).toBe(600000);
  });

  it('withIva añade 16% exacto', () => {
    // $500 → base 3000 + IVA 480 = 3480
    expect(computeCasualCommissionWithIvaSubunits(50000, 'casual_reseller')).toBe(3480);
  });

  it('withIva devuelve 0 para store', () => {
    expect(computeCasualCommissionWithIvaSubunits(50000, 'store')).toBe(0);
    expect(computeCasualCommissionWithIvaSubunits(50000, undefined)).toBe(0);
  });
});

describe('transactionLineItems — casual commission integration', () => {
  it('store: NO agrega línea xololo-casual-commission', () => {
    const items = transactionLineItems(makeListing(150000), orderData, null, null, {
      sellerMode: 'store',
    });
    const casualLine = items.find(li => li.code === LINE_ITEM_XOLOLO_CASUAL_COMMISSION);
    expect(casualLine).toBeUndefined();
    const adminLine = items.find(li => li.code === LINE_ITEM_XOLOLO_SERVICE_FEE);
    expect(adminLine).toBeDefined();
    expect(adminLine.unitPrice.amount).toBe(1624);
  });

  it('authorPublicData ausente: default store, no casual-commission', () => {
    const items = transactionLineItems(makeListing(150000), orderData, null, null);
    const casualLine = items.find(li => li.code === LINE_ITEM_XOLOLO_CASUAL_COMMISSION);
    expect(casualLine).toBeUndefined();
  });

  it('casual_reseller @ $1,500: admin + casual commission $90+IVA', () => {
    const items = transactionLineItems(makeListing(150000), orderData, null, null, {
      sellerMode: 'casual_reseller',
    });
    const adminLine = items.find(li => li.code === LINE_ITEM_XOLOLO_SERVICE_FEE);
    const casualLine = items.find(li => li.code === LINE_ITEM_XOLOLO_CASUAL_COMMISSION);
    expect(adminLine.unitPrice.amount).toBe(1624);
    expect(casualLine).toBeDefined();
    // 150000 * 6% = 9000 base + 16% IVA = 10440
    expect(casualLine.unitPrice.amount).toBe(10440);
    // quantity -1 porque es descuento del payout, igual que el service fee
    expect(casualLine.quantity).toBe(-1);
    expect(casualLine.includeFor).toEqual(['provider']);
  });

  it('casual @ $0: NO agrega línea casual-commission (0 base)', () => {
    const items = transactionLineItems(makeListing(0), orderData, null, null, {
      sellerMode: 'casual_reseller',
    });
    const casualLine = items.find(li => li.code === LINE_ITEM_XOLOLO_CASUAL_COMMISSION);
    expect(casualLine).toBeUndefined();
  });

  it('casual @ $75,000: aplica tramos 1+2 → $4,640', () => {
    const items = transactionLineItems(makeListing(7500000), orderData, null, null, {
      sellerMode: 'casual_reseller',
    });
    const casualLine = items.find(li => li.code === LINE_ITEM_XOLOLO_CASUAL_COMMISSION);
    expect(casualLine.unitPrice.amount).toBe(464000); // 400000 base + 64000 IVA
  });
});
