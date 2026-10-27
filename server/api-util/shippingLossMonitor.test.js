const {
  detectShippingLoss,
  extractActualCost,
} = require('./shippingLossMonitor');

describe('detectShippingLoss', () => {
  it('no detecta si no hay actualSkydropxCostMxn (null)', () => {
    expect(
      detectShippingLoss({
        expectedShippingFeePublic: 150,
        actualSkydropxCostMxn: null,
      })
    ).toBeNull();
  });

  it('no detecta si la diferencia está dentro del umbral', () => {
    // expected=150 (buyer paid) → expectedSkydropxNet=133.33
    // actual=138 → diff=4.67, diffPct=3.5% → debajo del 10%
    const r = detectShippingLoss({
      expectedShippingFeePublic: 150,
      actualSkydropxCostMxn: 138,
    });
    expect(r).toBeNull();
  });

  it('detecta pérdida con diffPct > 10%', () => {
    // expected=150 → expectedSkydropxNet=133.33
    // actual=180 → diff=46.67 (positivo = pérdida)
    const r = detectShippingLoss({
      expectedShippingFeePublic: 150,
      actualSkydropxCostMxn: 180,
    });
    expect(r).not.toBeNull();
    expect(r.lossMxn).toBeGreaterThan(0);
    expect(r.diffPct).toBeGreaterThan(0.1);
  });

  it('detecta aunque diffPct < 10% si diff > $50', () => {
    // expected=800 → expectedSkydropxNet=711.11
    // actual=770 → diff=58.89 (<10% pero >$50)
    const r = detectShippingLoss({
      expectedShippingFeePublic: 800,
      actualSkydropxCostMxn: 770,
    });
    expect(r).not.toBeNull();
    expect(r.lossMxn).toBeGreaterThan(50);
  });

  it('lossMxn=0 cuando ganancia inesperada', () => {
    // expected=200 → expectedSkydropxNet=177.78
    // actual=100 → diff=-77.78 (ganancia)
    const r = detectShippingLoss({
      expectedShippingFeePublic: 200,
      actualSkydropxCostMxn: 100,
    });
    // Aquí sí reporta por umbral, pero lossMxn=0 (no pérdida).
    expect(r).not.toBeNull();
    expect(r.lossMxn).toBe(0);
    expect(r.diff).toBeLessThan(0);
  });

  it('incluye context en el reporte', () => {
    const r = detectShippingLoss({
      expectedShippingFeePublic: 150,
      actualSkydropxCostMxn: 180,
      context: { txId: 'tx-123', carrier: 'FedEx' },
    });
    expect(r.context).toEqual({ txId: 'tx-123', carrier: 'FedEx' });
  });

  it('ignora inputs inválidos', () => {
    expect(detectShippingLoss({})).toBeNull();
    expect(
      detectShippingLoss({ expectedShippingFeePublic: 0, actualSkydropxCostMxn: 100 })
    ).toBeNull();
    expect(
      detectShippingLoss({ expectedShippingFeePublic: 'oops', actualSkydropxCostMxn: 100 })
    ).toBeNull();
  });
});

describe('extractActualCost', () => {
  it('devuelve null si no hay shipAttrs', () => {
    expect(extractActualCost(null)).toBeNull();
    expect(extractActualCost(undefined)).toBeNull();
  });

  it('prioriza master_rate_price', () => {
    expect(
      extractActualCost({ master_rate_price: 100, rate_price: 50, price: 10 })
    ).toBe(100);
  });

  it('cae a rate_price si no hay master_rate_price', () => {
    expect(extractActualCost({ rate_price: 150 })).toBe(150);
  });

  it('cae a price si no hay rate_price', () => {
    expect(extractActualCost({ price: 200 })).toBe(200);
  });

  it('ignora valores inválidos (0, negativos, strings)', () => {
    expect(extractActualCost({ price: 0 })).toBeNull();
    expect(extractActualCost({ price: -50 })).toBeNull();
    expect(extractActualCost({ price: 'oops' })).toBeNull();
  });
});
