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
    it('applies 6% to prices entirely in the first tier', () => {
      const r = computeMarginalCommission(50000); // $500
      expect(r.baseSubunits).toBe(3000); // 500 * 6% = 30
      expect(r.effectivePct).toBeCloseTo(0.06, 5);
      expect(r.breakdown).toHaveLength(1);
      expect(r.breakdown[0].pct).toBe(0.06);
    });

    it('is exactly 6% at the first-tier upper bound ($50,000)', () => {
      const r = computeMarginalCommission(5000000);
      expect(r.baseSubunits).toBe(300000);
      expect(r.effectivePct).toBeCloseTo(0.06, 5);
      expect(r.breakdown).toHaveLength(1);
    });

    it('splits across tiers 1 and 2 for a $75,000 price', () => {
      const r = computeMarginalCommission(7500000);
      // 50,000 * 6% + 25,000 * 4% = 3,000 + 1,000 = 4,000 (400,000 subunits)
      expect(r.baseSubunits).toBe(400000);
      expect(r.effectivePct).toBeCloseTo(0.0533333, 5);
      expect(r.breakdown).toHaveLength(2);
      expect(r.breakdown[0].pct).toBe(0.06);
      expect(r.breakdown[1].pct).toBe(0.04);
    });

    it('splits across all three tiers for a $150,000 price', () => {
      const r = computeMarginalCommission(15000000);
      // 50K*6% + 50K*4% + 50K*2% = 3,000 + 2,000 + 1,000 = 6,000 (600,000 subunits)
      expect(r.baseSubunits).toBe(600000);
      expect(r.effectivePct).toBeCloseTo(0.04, 5);
      expect(r.breakdown).toHaveLength(3);
      expect(r.breakdown.map(b => b.pct)).toEqual([0.06, 0.04, 0.02]);
    });

    it('is monotonically increasing in absolute pesos (no cliff at tier boundary)', () => {
      // Regresión del bug de la tabla plana: a $50,000 era menos que a $50,001.
      // Ahora marginal: $50,001 > $50,000 siempre.
      const at50k = computeMarginalCommission(5000000).baseSubunits;
      const at50001 = computeMarginalCommission(5000100).baseSubunits; // $50,001
      expect(at50001).toBeGreaterThan(at50k);
    });

    it('effective rate asymptotically approaches 2% for very large prices', () => {
      const r = computeMarginalCommission(100000000); // $1,000,000
      // 50K*6% + 50K*4% + 900K*2% = 3,000 + 2,000 + 18,000 = 23,000
      expect(r.baseSubunits).toBe(2300000);
      expect(r.effectivePct).toBeCloseTo(0.023, 4);
    });

    it('handles zero and negative prices gracefully', () => {
      expect(computeMarginalCommission(0).baseSubunits).toBe(0);
      expect(computeMarginalCommission(-100).baseSubunits).toBe(0);
      expect(computeMarginalCommission(null).baseSubunits).toBe(0);
      expect(computeMarginalCommission(undefined).baseSubunits).toBe(0);
    });

    it('exposes 3 tiers in COMMISSION_TIERS', () => {
      expect(COMMISSION_TIERS).toHaveLength(3);
      expect(COMMISSION_TIERS[0].pct).toBe(0.06);
      expect(COMMISSION_TIERS[1].pct).toBe(0.04);
      expect(COMMISSION_TIERS[2].pct).toBe(0.02);
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

  describe('computePayoutBreakdown — cargos según sellerMode', () => {
    // Modelo: todos pagan admin plano ($14+IVA=1624). Solo casual paga
    // además la comisión marginal 6/4/2 + IVA sobre el precio.

    it('store: solo cargo admin $14 + IVA; comisión 0', () => {
      const bdStore75k = computePayoutBreakdown({
        priceSubunits: 7500000,
        ivaMode: IVA_MODES.GRAVADO,
        sellerMode: 'store',
      });
      expect(bdStore75k.adminFlatSubunits).toBe(1624);
      expect(bdStore75k.commissionSubunits).toBe(0);
      expect(bdStore75k.xololoAdminSubunits).toBe(1624);

      const bdStore5k = computePayoutBreakdown({
        priceSubunits: 500000,
        ivaMode: IVA_MODES.GRAVADO,
        sellerMode: 'store',
      });
      expect(bdStore5k.adminFlatSubunits).toBe(1624);
      expect(bdStore5k.commissionSubunits).toBe(0);
      expect(bdStore5k.xololoAdminSubunits).toBe(1624);
    });

    it('defaults to store when sellerMode is omitted', () => {
      const bd = computePayoutBreakdown({
        priceSubunits: 500000,
        ivaMode: IVA_MODES.GRAVADO,
      });
      expect(bd.commissionSubunits).toBe(0);
      expect(bd.xololoAdminSubunits).toBe(1624);
    });

    it('casual_reseller @ $75,000: admin $14 + comisión escalonada', () => {
      const bd = computePayoutBreakdown({
        priceSubunits: 7500000,
        ivaMode: IVA_MODES.EXENTO,
        sellerMode: 'casual_reseller',
      });
      // admin: $14 + IVA = 1624
      // comisión: $4,000 + 16% IVA = $4,640 (464000)
      // total: 1624 + 464000 = 465624
      expect(bd.adminFlatSubunits).toBe(1624);
      expect(bd.commissionSubunits).toBe(464000);
      expect(bd.xololoAdminSubunits).toBe(465624);
      expect(bd.commissionEffectivePct).toBeCloseTo(0.0533333, 5);
      expect(bd.commissionBreakdown).toHaveLength(2);
    });

    it('casual_reseller @ $5,000: admin + 6% comisión + IVA', () => {
      const bd = computePayoutBreakdown({
        priceSubunits: 500000,
        ivaMode: IVA_MODES.EXENTO,
        sellerMode: 'casual_reseller',
      });
      // admin: 1624; comisión: 500000*6%=30000 + IVA 4800 = 34800
      // total: 1624 + 34800 = 36424
      expect(bd.adminFlatSubunits).toBe(1624);
      expect(bd.commissionSubunits).toBe(34800);
      expect(bd.xololoAdminSubunits).toBe(36424);
    });

    it('casual_reseller @ $0: admin igual se cobra, comisión 0', () => {
      // Edge case: aunque el precio sea 0, el admin plano aplica porque
      // es por transacción, no proporcional al precio.
      const bd = computePayoutBreakdown({
        priceSubunits: 0,
        ivaMode: IVA_MODES.EXENTO,
        sellerMode: 'casual_reseller',
      });
      expect(bd.adminFlatSubunits).toBe(1624);
      expect(bd.commissionSubunits).toBe(0);
    });
  });
});
