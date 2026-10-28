// XOLOLO Cart #21: cobertura del helper que decide si un nuevo item
// forzaría a crear un segundo "grupo de compatibilidad" en el carrito.

import {
  wouldCreateNewGroup,
  enabledMethodKeys,
  METHOD_PICKUP,
  METHOD_LOCAL_DELIVERY,
  METHOD_SKYDROPX,
  METHOD_FREIGHT,
} from './xololoShippingMethods';

const makeMethods = (overrides = {}) => ({
  pickup: { enabled: false, instructions: '' },
  localDelivery: {
    enabled: false,
    priceSubunits: 0,
    zoneDescription: '',
    coverageStates: [],
    coverageMunicipios: {},
  },
  skydropxCarrier: {
    enabled: false,
    sellerCoversShipping: false,
    weightGrams: null,
    dimensionLengthCm: null,
    dimensionWidthCm: null,
    dimensionHeightCm: null,
  },
  freight: { enabled: false },
  ...overrides,
});

const withEnabled = keys => {
  const m = makeMethods();
  keys.forEach(k => {
    m[k].enabled = true;
  });
  return m;
};

describe('enabledMethodKeys', () => {
  it('null → []', () => {
    expect(enabledMethodKeys(null)).toEqual([]);
  });

  it('ninguno habilitado → []', () => {
    expect(enabledMethodKeys(makeMethods())).toEqual([]);
  });

  it('pickup + skydropx → ambas keys', () => {
    const m = withEnabled([METHOD_PICKUP, METHOD_SKYDROPX]);
    expect(enabledMethodKeys(m)).toEqual([METHOD_PICKUP, METHOD_SKYDROPX]);
  });
});

describe('wouldCreateNewGroup', () => {
  it('carrito vacío → nunca split', () => {
    const res = wouldCreateNewGroup([], withEnabled([METHOD_SKYDROPX]));
    expect(res.wouldSplit).toBe(false);
    expect(res.currentGroupKeys).toEqual([]);
  });

  it('todos los items legacy sin snapshot → no split (no podemos juzgar)', () => {
    const res = wouldCreateNewGroup(
      [{ listingId: 'a' }, { listingId: 'b' }],
      withEnabled([METHOD_PICKUP])
    );
    expect(res.wouldSplit).toBe(false);
  });

  it('item existente con pickup+skydropx + nuevo con skydropx → NO split (comparten skydropx)', () => {
    const res = wouldCreateNewGroup(
      [{ listingId: 'a', shippingMethods: withEnabled([METHOD_PICKUP, METHOD_SKYDROPX]) }],
      withEnabled([METHOD_SKYDROPX])
    );
    expect(res.wouldSplit).toBe(false);
    expect(res.sharedKeys).toEqual([METHOD_SKYDROPX]);
  });

  it('item existente con pickup + nuevo con skydropx → SÍ split (no comparten)', () => {
    const res = wouldCreateNewGroup(
      [{ listingId: 'a', shippingMethods: withEnabled([METHOD_PICKUP]) }],
      withEnabled([METHOD_SKYDROPX])
    );
    expect(res.wouldSplit).toBe(true);
    expect(res.currentGroupKeys).toEqual([METHOD_PICKUP]);
    expect(res.newItemKeys).toEqual([METHOD_SKYDROPX]);
    expect(res.sharedKeys).toEqual([]);
  });

  it('2 items existentes con intersección pickup + nuevo con freight → SÍ split', () => {
    const res = wouldCreateNewGroup(
      [
        { listingId: 'a', shippingMethods: withEnabled([METHOD_PICKUP, METHOD_SKYDROPX]) },
        { listingId: 'b', shippingMethods: withEnabled([METHOD_PICKUP, METHOD_LOCAL_DELIVERY]) },
      ],
      withEnabled([METHOD_FREIGHT])
    );
    expect(res.wouldSplit).toBe(true);
    expect(res.currentGroupKeys).toEqual([METHOD_PICKUP]);
    expect(res.newItemKeys).toEqual([METHOD_FREIGHT]);
  });

  it('nuevo item sin ningún método habilitado → SÍ split', () => {
    const res = wouldCreateNewGroup(
      [{ listingId: 'a', shippingMethods: withEnabled([METHOD_PICKUP]) }],
      makeMethods()
    );
    expect(res.wouldSplit).toBe(true);
    expect(res.newItemKeys).toEqual([]);
  });

  it('mezcla: 1 legacy + 1 con pickup + nuevo con skydropx → split (los legacy se ignoran)', () => {
    const res = wouldCreateNewGroup(
      [
        { listingId: 'legacy' }, // sin shippingMethods
        { listingId: 'a', shippingMethods: withEnabled([METHOD_PICKUP]) },
      ],
      withEnabled([METHOD_SKYDROPX])
    );
    expect(res.wouldSplit).toBe(true);
    expect(res.currentGroupKeys).toEqual([METHOD_PICKUP]);
  });
});
