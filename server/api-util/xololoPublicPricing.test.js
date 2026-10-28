const {
  applyPublicMargin,
  toBuyerFacing,
  XOLOLO_PUBLIC_MARGIN_PCT,
} = require('./xololoPublicPricing');

describe('xololoPublicPricing', () => {
  describe('applyPublicMargin', () => {
    it('aplica 12.5% al rate puro cuando no hay seguro', () => {
      const r = applyPublicMargin(100);
      expect(r.skydropxRate).toBe(100);
      expect(r.insurance).toBe(0);
      expect(r.bruto).toBe(100);
      expect(r.xololoMargin).toBe(12.5);
      expect(r.publicTotal).toBe(112.5);
      expect(r.marginPct).toBe(0.125);
    });

    it('aplica 12.5% al rate + seguro cuando el buyer lo elige', () => {
      const r = applyPublicMargin(200, 50);
      expect(r.bruto).toBe(250);
      expect(r.xololoMargin).toBe(31.25);
      expect(r.publicTotal).toBe(281.25);
    });

    it('redondea a dos decimales', () => {
      // 123.45 * 1.125 = 138.88125 → 138.88
      const r = applyPublicMargin(123.45);
      expect(r.publicTotal).toBe(138.88);
    });

    it('tolera entradas nulas o no-numéricas (devuelve 0)', () => {
      const r = applyPublicMargin(undefined, null);
      expect(r.publicTotal).toBe(0);
      expect(r.xololoMargin).toBe(0);
    });

    it('maneja rate=0 (regalo o cupón 100%) correctamente', () => {
      const r = applyPublicMargin(0, 10);
      expect(r.bruto).toBe(10);
      expect(r.publicTotal).toBe(11.25);
    });
  });

  describe('toBuyerFacing', () => {
    it('expone sólo publicTotal + currency; NO expone skydropxRate ni margin', () => {
      const breakdown = applyPublicMargin(100, 20);
      const facing = toBuyerFacing(breakdown);
      expect(facing).toEqual({ publicTotal: 135, currency: 'MXN' });
      expect(facing.skydropxRate).toBeUndefined();
      expect(facing.xololoMargin).toBeUndefined();
      expect(facing.insurance).toBeUndefined();
    });
  });

  it('exporta la constante del margen', () => {
    expect(XOLOLO_PUBLIC_MARGIN_PCT).toBe(0.125);
  });
});
