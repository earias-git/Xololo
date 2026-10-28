import {
  TAX_CLASSIFICATIONS,
  CLASSIFICATION_GROUPS,
  getClassificationByCode,
  resolveTaxOverride,
} from './xololoTaxClassification';

describe('xololoTaxClassification', () => {
  describe('getClassificationByCode', () => {
    it('returns null for empty, missing, or unknown codes', () => {
      expect(getClassificationByCode()).toBeNull();
      expect(getClassificationByCode(null)).toBeNull();
      expect(getClassificationByCode('')).toBeNull();
      expect(getClassificationByCode('does_not_exist')).toBeNull();
    });

    it('returns a well-formed entry for every known code', () => {
      Object.values(TAX_CLASSIFICATIONS).forEach(code => {
        const entry = getClassificationByCode(code);
        expect(entry).not.toBeNull();
        expect(typeof entry.label).toBe('string');
        expect(typeof entry.ivaMode).toBe('string');
        expect(typeof entry.taxActivity).toBe('string');
        expect(typeof entry.ivaArticle).toBe('string');
        expect(typeof entry.description).toBe('string');
      });
    });

    it('maps EXENTO_9_IV to exento Art. 9 fracc. IV LIVA', () => {
      const e = getClassificationByCode(TAX_CLASSIFICATIONS.EXENTO_9_IV);
      expect(e.ivaMode).toBe('exento');
      expect(e.ivaArticle).toMatch(/Art\.\s*9\s*fracc\.\s*IV/i);
    });
  });

  describe('CLASSIFICATION_GROUPS', () => {
    it('references only codes that resolve back to a known entry', () => {
      CLASSIFICATION_GROUPS.forEach(group => {
        expect(typeof group.label).toBe('string');
        expect(Array.isArray(group.items)).toBe(true);
        group.items.forEach(code => {
          expect(getClassificationByCode(code)).not.toBeNull();
        });
      });
    });

    it('covers every code in TAX_CLASSIFICATIONS exactly once', () => {
      const codes = CLASSIFICATION_GROUPS.flatMap(g => g.items);
      const expected = Object.values(TAX_CLASSIFICATIONS);
      expect(codes.sort()).toEqual(expected.sort());
    });
  });

  describe('resolveTaxOverride (gate antifraude #39)', () => {
    const anApprovedShape = {
      code: TAX_CLASSIFICATIONS.TASA_CERO_2A_I_B,
      declaredAt: '2026-10-18T00:00:00.000Z',
      reviewStatus: 'approved',
    };

    it('returns null when the field is missing', () => {
      expect(resolveTaxOverride(null)).toBeNull();
      expect(resolveTaxOverride(undefined)).toBeNull();
      expect(resolveTaxOverride({})).toBeNull();
    });

    it('returns null when reviewStatus is pending', () => {
      expect(resolveTaxOverride({ ...anApprovedShape, reviewStatus: 'pending' })).toBeNull();
    });

    it('returns null when reviewStatus is rejected', () => {
      expect(resolveTaxOverride({ ...anApprovedShape, reviewStatus: 'rejected' })).toBeNull();
    });

    it('returns the ivaMode/taxActivity/ivaArticle only when approved', () => {
      const o = resolveTaxOverride(anApprovedShape);
      expect(o).not.toBeNull();
      expect(o.ivaMode).toBe('0%');
      expect(o.ivaArticle).toMatch(/2-A/);
    });

    it('returns null when the code no longer exists in the catalog', () => {
      expect(resolveTaxOverride({ code: 'removed_code', reviewStatus: 'approved' })).toBeNull();
    });
  });
});
