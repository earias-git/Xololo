import { PERSON_TYPES } from './xololoPayout';
import {
  LISTING_CONDITIONS,
  SELLER_MODES,
  getSellerMode,
  getUsedGoodsNotice,
  isCasualReseller,
  resolveUsedGoodsOverride,
} from './xololoSellerMode';

const userWith = publicData => ({
  attributes: { profile: { publicData } },
});

describe('xololoSellerMode', () => {
  describe('getSellerMode', () => {
    it('returns STORE when nothing is declared', () => {
      expect(getSellerMode(null)).toBe(SELLER_MODES.STORE);
      expect(getSellerMode(undefined)).toBe(SELLER_MODES.STORE);
      expect(getSellerMode({})).toBe(SELLER_MODES.STORE);
      expect(getSellerMode(userWith({}))).toBe(SELLER_MODES.STORE);
    });

    it('returns CASUAL_RESELLER only for exact match', () => {
      expect(getSellerMode(userWith({ sellerMode: 'casual_reseller' }))).toBe(
        SELLER_MODES.CASUAL_RESELLER
      );
      expect(getSellerMode(userWith({ sellerMode: 'store' }))).toBe(SELLER_MODES.STORE);
      expect(getSellerMode(userWith({ sellerMode: 'anything_else' }))).toBe(SELLER_MODES.STORE);
    });
  });

  describe('isCasualReseller', () => {
    it('is true only when sellerMode === casual_reseller', () => {
      expect(isCasualReseller(userWith({ sellerMode: 'casual_reseller' }))).toBe(true);
      expect(isCasualReseller(userWith({ sellerMode: 'store' }))).toBe(false);
      expect(isCasualReseller(null)).toBe(false);
    });
  });

  describe('resolveUsedGoodsOverride', () => {
    it('returns an exempt override for USED + INDIVIDUAL (particular)', () => {
      const o = resolveUsedGoodsOverride({
        condition: LISTING_CONDITIONS.USED,
        personType: PERSON_TYPES.INDIVIDUAL,
      });
      expect(o).not.toBeNull();
      expect(o.ivaMode).toBe('exento');
      expect(o.ivaArticle).toMatch(/Art\.\s*9/);
      expect(o.source).toBe('auto_used_particular');
    });

    it('returns null for USED + PHYSICAL_BUSINESS (actividad empresarial excluye Art. 9 IV)', () => {
      const o = resolveUsedGoodsOverride({
        condition: LISTING_CONDITIONS.USED,
        personType: PERSON_TYPES.PHYSICAL_BUSINESS,
      });
      expect(o).toBeNull();
    });

    it('returns null for USED + MORAL', () => {
      const o = resolveUsedGoodsOverride({
        condition: LISTING_CONDITIONS.USED,
        personType: PERSON_TYPES.MORAL,
      });
      expect(o).toBeNull();
    });

    it('returns null for NEW regardless of personType', () => {
      expect(
        resolveUsedGoodsOverride({
          condition: LISTING_CONDITIONS.NEW,
          personType: PERSON_TYPES.INDIVIDUAL,
        })
      ).toBeNull();
    });

    it('returns null for missing or malformed input', () => {
      expect(resolveUsedGoodsOverride({})).toBeNull();
      expect(resolveUsedGoodsOverride({ condition: 'used' })).toBeNull();
      expect(resolveUsedGoodsOverride({ personType: 'individual' })).toBeNull();
    });
  });

  describe('getUsedGoodsNotice', () => {
    it('returns an exempt-kind notice for USED + INDIVIDUAL', () => {
      const n = getUsedGoodsNotice({
        condition: LISTING_CONDITIONS.USED,
        personType: PERSON_TYPES.INDIVIDUAL,
      });
      expect(n).not.toBeNull();
      expect(n.kind).toBe('exempt');
      expect(n.text).toMatch(/Art\.\s*9/);
    });

    it('returns a commercial-kind notice for USED + PHYSICAL_BUSINESS', () => {
      const n = getUsedGoodsNotice({
        condition: LISTING_CONDITIONS.USED,
        personType: PERSON_TYPES.PHYSICAL_BUSINESS,
      });
      expect(n).not.toBeNull();
      expect(n.kind).toBe('commercial');
    });

    it('returns a commercial-kind notice for USED + MORAL', () => {
      const n = getUsedGoodsNotice({
        condition: LISTING_CONDITIONS.USED,
        personType: PERSON_TYPES.MORAL,
      });
      expect(n).not.toBeNull();
      expect(n.kind).toBe('commercial');
    });

    it('returns null for NEW', () => {
      expect(
        getUsedGoodsNotice({
          condition: LISTING_CONDITIONS.NEW,
          personType: PERSON_TYPES.INDIVIDUAL,
        })
      ).toBeNull();
    });
  });
});
