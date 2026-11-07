import {
  MAX_VARIANT_AXES,
  getListingStock,
  getVariantGroupId,
  isVariantMaster,
  isVariantChild,
  isVariantListing,
  getVariantAxes,
  getVariantValues,
  siblingsOfGroup,
  findMaster,
  axisValuesWithStock,
  findSiblingBySelection,
  hasAnyStock,
  buildMatrix,
} from './variants';

const mkListing = ({ id, publicData = {}, stock = null } = {}) => ({
  id: { uuid: id || 'listing-id' },
  attributes: { publicData },
  currentStock: stock == null ? null : { attributes: { quantity: stock } },
});

const GROUP = 'group-abc';

const master = mkListing({
  id: 'master-id',
  stock: 2,
  publicData: {
    variantGroupId: GROUP,
    isVariantMaster: true,
    variantAxes: ['talla', 'color'],
    variantValues: { talla: 'S', color: 'azul' },
  },
});

const childM_azul = mkListing({
  id: 'child-M-azul',
  stock: 5,
  publicData: {
    variantGroupId: GROUP,
    variantAxes: ['talla', 'color'],
    variantValues: { talla: 'M', color: 'azul' },
  },
});

const childM_rojo = mkListing({
  id: 'child-M-rojo',
  stock: 0,
  publicData: {
    variantGroupId: GROUP,
    variantAxes: ['talla', 'color'],
    variantValues: { talla: 'M', color: 'rojo' },
  },
});

const childL_azul = mkListing({
  id: 'child-L-azul',
  stock: 3,
  publicData: {
    variantGroupId: GROUP,
    variantAxes: ['talla', 'color'],
    variantValues: { talla: 'L', color: 'azul' },
  },
});

const siblings = [master, childM_azul, childM_rojo, childL_azul];

const simpleListing = mkListing({ id: 'simple', stock: 1, publicData: {} });

describe('variants helpers', () => {
  describe('getListingStock', () => {
    it('reads currentStock.attributes.quantity', () => {
      expect(getListingStock(childM_azul)).toBe(5);
    });
    it('returns null when not loaded', () => {
      expect(getListingStock(mkListing({}))).toBeNull();
    });
    it('handles null listing', () => {
      expect(getListingStock(null)).toBeNull();
      expect(getListingStock(undefined)).toBeNull();
    });
  });

  describe('getVariantGroupId', () => {
    it('reads publicData.variantGroupId', () => {
      expect(getVariantGroupId(master)).toBe(GROUP);
    });
    it('returns null for simple listings', () => {
      expect(getVariantGroupId(simpleListing)).toBeNull();
    });
  });

  describe('isVariantMaster / isVariantChild / isVariantListing', () => {
    it('master is master and listing, not child', () => {
      expect(isVariantMaster(master)).toBe(true);
      expect(isVariantChild(master)).toBe(false);
      expect(isVariantListing(master)).toBe(true);
    });
    it('child is child and listing, not master', () => {
      expect(isVariantMaster(childM_azul)).toBe(false);
      expect(isVariantChild(childM_azul)).toBe(true);
      expect(isVariantListing(childM_azul)).toBe(true);
    });
    it('simple listing is none of them', () => {
      expect(isVariantMaster(simpleListing)).toBe(false);
      expect(isVariantChild(simpleListing)).toBe(false);
      expect(isVariantListing(simpleListing)).toBe(false);
    });
  });

  describe('getVariantAxes', () => {
    it('reads publicData.variantAxes', () => {
      expect(getVariantAxes(master)).toEqual(['talla', 'color']);
    });
    it('returns [] for simple listings', () => {
      expect(getVariantAxes(simpleListing)).toEqual([]);
    });
    it('caps at MAX_VARIANT_AXES', () => {
      const overflowed = mkListing({
        publicData: { variantAxes: ['a', 'b', 'c', 'd'] },
      });
      expect(getVariantAxes(overflowed)).toHaveLength(MAX_VARIANT_AXES);
    });
  });

  describe('getVariantValues', () => {
    it('reads publicData.variantValues', () => {
      expect(getVariantValues(childM_rojo)).toEqual({ talla: 'M', color: 'rojo' });
    });
    it('returns {} for simple listings', () => {
      expect(getVariantValues(simpleListing)).toEqual({});
    });
  });

  describe('siblingsOfGroup', () => {
    it('keeps only listings of the given group', () => {
      const result = siblingsOfGroup([...siblings, simpleListing], GROUP);
      expect(result).toHaveLength(4);
      expect(result).not.toContain(simpleListing);
    });
    it('returns [] for empty input', () => {
      expect(siblingsOfGroup([], GROUP)).toEqual([]);
      expect(siblingsOfGroup(null, GROUP)).toEqual([]);
    });
  });

  describe('findMaster', () => {
    it('finds the master in the group', () => {
      expect(findMaster(siblings)).toBe(master);
    });
    it('returns null when no master exists', () => {
      expect(findMaster([childM_azul, childL_azul])).toBeNull();
    });
    it('returns null for empty input', () => {
      expect(findMaster([])).toBeNull();
      expect(findMaster(null)).toBeNull();
    });
  });

  describe('axisValuesWithStock', () => {
    it('aggregates stock per value for axis talla', () => {
      const vals = axisValuesWithStock(siblings, 'talla');
      const m = vals.find(v => v.value === 'M');
      const s = vals.find(v => v.value === 'S');
      const l = vals.find(v => v.value === 'L');
      expect(m.stock).toBe(5); // 5 azul + 0 rojo
      expect(m.siblingCount).toBe(2);
      expect(s.stock).toBe(2); // master
      expect(l.stock).toBe(3);
    });
    it('marks value as out of stock when total is 0', () => {
      const onlyRojo = [
        mkListing({
          stock: 0,
          publicData: { variantGroupId: GROUP, variantValues: { color: 'rojo' } },
        }),
      ];
      const vals = axisValuesWithStock(onlyRojo, 'color');
      expect(vals[0].stock).toBe(0);
    });
    it('handles unloaded stock as 0', () => {
      const noStock = [
        mkListing({ publicData: { variantValues: { talla: 'X' } } }),
      ];
      expect(axisValuesWithStock(noStock, 'talla')[0].stock).toBe(0);
    });
    it('returns [] for empty input or missing axis', () => {
      expect(axisValuesWithStock([], 'talla')).toEqual([]);
      expect(axisValuesWithStock(siblings, '')).toEqual([]);
      expect(axisValuesWithStock(null, 'talla')).toEqual([]);
    });
  });

  describe('findSiblingBySelection', () => {
    it('finds exact match on full selection', () => {
      expect(findSiblingBySelection(siblings, { talla: 'M', color: 'azul' })).toBe(
        childM_azul
      );
    });
    it('finds first match on partial selection', () => {
      // talla: 'M' matches both M-azul and M-rojo → returns first
      const r = findSiblingBySelection(siblings, { talla: 'M' });
      expect([childM_azul, childM_rojo]).toContain(r);
    });
    it('returns null when no match', () => {
      expect(
        findSiblingBySelection(siblings, { talla: 'XXL', color: 'verde' })
      ).toBeNull();
    });
    it('returns null for empty selection', () => {
      expect(findSiblingBySelection(siblings, {})).toBeNull();
      expect(findSiblingBySelection(siblings, null)).toBeNull();
    });
  });

  describe('hasAnyStock', () => {
    it('true when at least one sibling has stock > 0', () => {
      expect(hasAnyStock(siblings)).toBe(true);
    });
    it('false when all out of stock', () => {
      const allZero = [
        mkListing({ stock: 0 }),
        mkListing({ stock: 0 }),
      ];
      expect(hasAnyStock(allZero)).toBe(false);
    });
    it('treats unloaded stock as 0', () => {
      const unloaded = [mkListing({}), mkListing({})];
      expect(hasAnyStock(unloaded)).toBe(false);
    });
  });

  describe('buildMatrix', () => {
    it('builds a 2-axis matrix', () => {
      const m = buildMatrix(siblings, ['talla', 'color']);
      expect(m.axes).toEqual(['talla', 'color']);
      expect(m.rows.sort()).toEqual(['L', 'M', 'S']);
      expect(m.cols.sort()).toEqual(['azul', 'rojo']);
      expect(m.cell('M', 'azul')).toBe(childM_azul);
      expect(m.cell('M', 'rojo')).toBe(childM_rojo);
      expect(m.cell('L', 'azul')).toBe(childL_azul);
      expect(m.cell('L', 'rojo')).toBeNull(); // no existe
    });
    it('builds a 1-axis matrix with no cols', () => {
      const oneAxis = [
        mkListing({
          id: 'a',
          stock: 1,
          publicData: { variantValues: { talla: 'S' } },
        }),
        mkListing({
          id: 'b',
          stock: 1,
          publicData: { variantValues: { talla: 'M' } },
        }),
      ];
      const m = buildMatrix(oneAxis, ['talla']);
      expect(m.cols).toEqual([]);
      expect(m.rows.sort()).toEqual(['M', 'S']);
      expect(m.cell('M')).toBe(oneAxis[1]);
    });
    it('caps at MAX_VARIANT_AXES', () => {
      const m = buildMatrix(siblings, ['talla', 'color', 'material']);
      expect(m.axes).toHaveLength(MAX_VARIANT_AXES);
    });
    it('handles empty input', () => {
      const m = buildMatrix([], ['talla', 'color']);
      expect(m.rows).toEqual([]);
      expect(m.cell('M', 'azul')).toBeNull();
    });
    it('handles missing axes', () => {
      const m = buildMatrix(siblings, []);
      expect(m.rows).toEqual([]);
      expect(m.cell('M', 'azul')).toBeNull();
    });
  });
});
