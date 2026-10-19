import {
  DEFAULT_TAX_PROFILE,
  PERSON_TYPES,
  buildTaxProfilePayload,
  getTaxProfile,
} from './xololoTaxProfile';

const userWith = protectedData => ({
  attributes: { profile: { protectedData } },
});

describe('xololoTaxProfile', () => {
  describe('getTaxProfile', () => {
    it('returns DEFAULT_TAX_PROFILE when the user has not declared', () => {
      expect(getTaxProfile(null)).toEqual(DEFAULT_TAX_PROFILE);
      expect(getTaxProfile(undefined)).toEqual(DEFAULT_TAX_PROFILE);
      expect(getTaxProfile({})).toEqual(DEFAULT_TAX_PROFILE);
      expect(getTaxProfile(userWith({}))).toEqual(DEFAULT_TAX_PROFILE);
    });

    it('reads a declared profile and preserves the fields', () => {
      const user = userWith({
        xololoTaxProfile: {
          personType: PERSON_TYPES.INDIVIDUAL,
          hasRfc: false,
          declaredAt: '2026-10-18T12:34:56.000Z',
        },
      });
      const p = getTaxProfile(user);
      expect(p.personType).toBe(PERSON_TYPES.INDIVIDUAL);
      expect(p.hasRfc).toBe(false);
      expect(p.declaredAt).toBe('2026-10-18T12:34:56.000Z');
    });

    it('falls back to defaults for missing fields in a partial profile', () => {
      const user = userWith({
        xololoTaxProfile: { personType: PERSON_TYPES.MORAL },
      });
      const p = getTaxProfile(user);
      expect(p.personType).toBe(PERSON_TYPES.MORAL);
      expect(p.hasRfc).toBe(DEFAULT_TAX_PROFILE.hasRfc);
    });

    it('defaults to physical_business + hasRfc=true as the conservative default', () => {
      // Rationale: a undeclared seller is treated as if they will owe
      // retentions so the preview does not under-promise.
      expect(DEFAULT_TAX_PROFILE.personType).toBe(PERSON_TYPES.PHYSICAL_BUSINESS);
      expect(DEFAULT_TAX_PROFILE.hasRfc).toBe(true);
    });
  });

  describe('buildTaxProfilePayload', () => {
    it('stamps declaredAt as an ISO timestamp', () => {
      const payload = buildTaxProfilePayload({
        personType: PERSON_TYPES.INDIVIDUAL,
        hasRfc: false,
      });
      // ISO yyyy-mm-ddThh:mm:ss...Z
      expect(payload.declaredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('passes through personType and coerces hasRfc to boolean', () => {
      const payload = buildTaxProfilePayload({
        personType: PERSON_TYPES.MORAL,
        hasRfc: 'yes',
      });
      expect(payload.personType).toBe(PERSON_TYPES.MORAL);
      expect(payload.hasRfc).toBe(true);
    });

    it('falls back to DEFAULT personType when missing', () => {
      const payload = buildTaxProfilePayload({});
      expect(payload.personType).toBe(DEFAULT_TAX_PROFILE.personType);
      expect(payload.hasRfc).toBe(false);
    });
  });
});
