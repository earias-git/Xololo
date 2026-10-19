import {
  COMMISSION_TIERS,
  IVA_MODES,
  PERSON_TYPES,
  TAX_ACTIVITIES,
  computeMarginalCommission,
  computePayoutBreakdown,
} from './xololoPayout';

describe('xololoPayout', () => {
  // All amounts in centavos (subunits). $100 = 10000 subunits.

  describe('computeMarginalCommission', () => {
    it('applies 9% to prices entirely in the first tier', () => {
      const r = computeMarginalCommission(50000); // $500
      expect(r.baseSubunits).toBe(4500); // 500 * 9% = 45
      expect(r.effectivePct).toBeCloseTo(0.09, 5);
      expect(r.breakdown).toHaveLength(1);
      expect(r.breakdown[0].pct).toBe(0.09);
    });

    it('is exactly 9% at the first-tier upper bound ($50,000)', () => {
      const r = computeMarginalCommission(5000000);
      expect(r.baseSubunits).toBe(450000);
      expect(r.effectivePct).toBeCloseTo(0.09, 5);
      expect(r.breakdown).toHaveLength(1);
    });

    it('splits across tiers 1 and 2 for a $75,000 price', () => {
      const r = computeMarginalCommission(7500000);
      // 50,000 * 9% + 25,000 * 6% = 4,500 + 1,500 = 6,000 (600,000 subunits)
      expect(r.baseSubunits).toBe(600000);
      expect(r.effectivePct).toBeCloseTo(0.08, 5);
      expect(r.breakdown).toHaveLength(2);
      expect(r.breakdown[0].pct).toBe(0.09);
      expect(r.breakdown[1].pct).toBe(0.06);
    });

    it('splits across all three tiers for a $150,000 price', () => {
      const r = computeMarginalCommission(15000000);
      // 50K*9% + 50K*6% + 50K*3% = 4,500 + 3,000 + 1,500 = 9,000 (900,000 subunits)
      expect(r.baseSubunits).toBe(900000);
      expect(r.effectivePct).toBeCloseTo(0.06, 5);
      expect(r.breakdown).toHaveLength(3);
      expect(r.breakdown.map(b => b.pct)).toEqual([0.09, 0.06, 0.03]);
    });

    it('is monotonically increasing in absolute pesos (no cliff at tier boundary)', () => {
      // Regresión del bug de la tabla plana: a $50,000 era $4,500 y a $50,001
      // era $3,000. Ahora marginal: $50,001 > $50,000 siempre.
      const at50k = computeMarginalCommission(5000000).baseSubunits;
      const at50001 = computeMarginalCommission(5000100).baseSubunits; // $50,001
      expect(at50001).toBeGreaterThan(at50k);
    });

    it('effective rate asymptotically approaches 3% for very large prices', () => {
      const r = computeMarginalCommission(100000000); // $1,000,000
      // 50K*9% + 50K*6% + 900K*3% = 4,500 + 3,000 + 27,000 = 34,500
      expect(r.baseSubunits).toBe(3450000);
      expect(r.effectivePct).toBeCloseTo(0.0345, 4);
    });

    it('handles zero and negative prices gracefully', () => {
      expect(computeMarginalCommission(0).baseSubunits).toBe(0);
      expect(computeMarginalCommission(-100).baseSubunits).toBe(0);
      expect(computeMarginalCommission(null).baseSubunits).toBe(0);
      expect(computeMarginalCommission(undefined).baseSubunits).toBe(0);
    });

    it('exposes 3 tiers in COMMISSION_TIERS', () => {
      expect(COMMISSION_TIERS).toHaveLength(3);
      expect(COMMISSION_TIERS[0].pct).toBe(0.09);
      expect(COMMISSION_TIERS[1].pct).toBe(0.06);
      expect(COMMISSION_TIERS[2].pct).toBe(0.03);
    });
  });

  describe('computePayoutBreakdown — IVA modes', () => {
    it('splits 16% IVA out of the price when GRAVADO', () => {
      // Precio total $1,160 → subtotal $1,000, IVA $160
      const bd = computePayoutBreakdown({
        priceSubunits: 116000,
        ivaMode: IVA_MODES.GRAVADO,
      });
      expect(bd.subtotalSubunits).toBe(100000);
      expect(bd.ivaSubunits).toBe(16000);
    });

    it('leaves subtotal equal to price when EXENTO', () => {
      const bd = computePayoutBreakdown({
        priceSubunits: 150000,
        ivaMode: IVA_MODES.EXENTO,
      });
      expect(bd.subtotalSubunits).toBe(150000);
      expect(bd.ivaSubunits).toBe(0);
    });

    it('leaves subtotal equal to price when TASA_CERO', () => {
      const bd = computePayoutBreakdown({
        priceSubunits: 150000,
        ivaMode: IVA_MODES.TASA_CERO,
      });
      expect(bd.subtotalSubunits).toBe(150000);
      expect(bd.ivaSubunits).toBe(0);
    });
  });

  describe('computePayoutBreakdown — retenciones', () => {
    const base = {
      priceSubunits: 100000, // $1,000
      ivaMode: IVA_MODES.EXENTO,
      applyWithholdings: true,
    };

    it('does not retain ISR for INDIVIDUAL (particular)', () => {
      const bd = computePayoutBreakdown({
        ...base,
        personType: PERSON_TYPES.INDIVIDUAL,
      });
      expect(bd.retIsrSubunits).toBe(0);
      expect(bd.retIsrPct).toBe(0);
    });

    it('does not retain ISR for MORAL (persona moral) today', () => {
      const bd = computePayoutBreakdown({
        ...base,
        personType: PERSON_TYPES.MORAL,
      });
      expect(bd.retIsrSubunits).toBe(0);
    });

    it('retains 1% ISR for PF empresarial con RFC vendiendo bien general', () => {
      const bd = computePayoutBreakdown({
        ...base,
        personType: PERSON_TYPES.PHYSICAL_BUSINESS,
        hasRfc: true,
        taxActivity: TAX_ACTIVITIES.ENAJENACION_SERVICIOS,
      });
      expect(bd.retIsrPct).toBeCloseTo(0.01, 5);
      expect(bd.retIsrSubunits).toBe(1000); // $10
    });

    it('retains 2.1% ISR for transporte/entrega', () => {
      const bd = computePayoutBreakdown({
        ...base,
        personType: PERSON_TYPES.PHYSICAL_BUSINESS,
        hasRfc: true,
        taxActivity: TAX_ACTIVITIES.TRANSPORTE_ENTREGA,
      });
      expect(bd.retIsrPct).toBeCloseTo(0.021, 5);
    });

    it('retains 4% ISR for hospedaje', () => {
      const bd = computePayoutBreakdown({
        ...base,
        personType: PERSON_TYPES.PHYSICAL_BUSINESS,
        hasRfc: true,
        taxActivity: TAX_ACTIVITIES.HOSPEDAJE,
      });
      expect(bd.retIsrPct).toBeCloseTo(0.04, 5);
    });

    it('retains 20% ISR for PF empresarial sin RFC', () => {
      const bd = computePayoutBreakdown({
        ...base,
        personType: PERSON_TYPES.PHYSICAL_BUSINESS,
        hasRfc: false,
      });
      expect(bd.retIsrPct).toBeCloseTo(0.2, 5);
    });

    it('no retiene IVA cuando el bien es exento aunque sea PF empresarial', () => {
      const bd = computePayoutBreakdown({
        priceSubunits: 100000,
        ivaMode: IVA_MODES.EXENTO,
        personType: PERSON_TYPES.PHYSICAL_BUSINESS,
        hasRfc: true,
        applyWithholdings: true,
      });
      expect(bd.retIvaSubunits).toBe(0);
    });

    it('skips withholdings entirely when applyWithholdings=false (default)', () => {
      const bd = computePayoutBreakdown({
        priceSubunits: 100000,
        ivaMode: IVA_MODES.GRAVADO,
        personType: PERSON_TYPES.PHYSICAL_BUSINESS,
        hasRfc: true,
      });
      expect(bd.appliedWithholdings).toBe(false);
      expect(bd.retIsrSubunits).toBe(0);
      expect(bd.retIvaSubunits).toBe(0);
    });
  });

  describe('computePayoutBreakdown — comisión marginal', () => {
    it('applies the marginal commission to xololoAdminSubunits', () => {
      const bd = computePayoutBreakdown({
        priceSubunits: 7500000, // $75,000
        ivaMode: IVA_MODES.EXENTO,
      });
      // base: $6,000 → + 16% IVA = $6,960 (696,000 subunits)
      expect(bd.xololoAdminSubunits).toBe(696000);
      expect(bd.xololoAdminEffectivePct).toBeCloseTo(0.08, 5);
      expect(bd.xololoAdminBreakdown).toHaveLength(2);
    });
  });
});
