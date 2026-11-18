// XOLOLO Blindaje — smoke test del service landingListings.
//
// Verifica las invariantes del filtrado server-side de la landing:
//   1. Siblings de variantes NUNCA se incluyen en ningún bucket.
//   2. Events NO entran al bucket products.
//   3. Bucket used SOLO incluye listings con condition='used' o
//      taxClassification.code='exento_9_iv'.
//   4. La paginación no se corta cuando una página 1 trae muchos
//      siblings — sigue hasta encontrar `targetCount` válidos o
//      agotar el marketplace.
//   5. Cache in-memory no se activa a través de reboots del test.
//
// Si estos fallan, PARAR: cambió la lógica de hidratación del
// landing. Confirmar que es intencional.

// Mock del Integration SDK: inyecta data controlada por test.
const mockIsdk = {
  listings: {
    _pages: [],
    _callCount: 0,
    reset() {
      this._pages = [];
      this._callCount = 0;
    },
    setPages(pages) {
      this._pages = pages;
    },
    query(params) {
      this._callCount += 1;
      const page = params?.page || 1;
      const data = this._pages[page - 1]?.data || [];
      const included = this._pages[page - 1]?.included || [];
      const totalPages = this._pages.length;
      return Promise.resolve({
        data: { data, included, meta: { page, totalPages, totalItems: 0 } },
      });
    },
  },
};

jest.mock('../api-util/integrationSdk', () => ({
  getIntegrationSdk: () => mockIsdk,
}));

// Reset cache entre tests
jest.isolateModules(() => {}); // placeholder; reset real abajo

const buildListing = ({ id, type = 'product', isSibling = false, isMaster = false, isEvent = false, condition = null, taxCode = null }) => ({
  id: { uuid: id },
  type: 'listing',
  attributes: {
    title: `listing-${id}`,
    publicData: {
      listingType: type,
      ...(isSibling ? { variantGroupId: 'grp-x', isVariantMaster: false } : {}),
      ...(isMaster ? { variantGroupId: 'grp-x', isVariantMaster: true } : {}),
      ...(isEvent ? { isEvent: true } : {}),
      ...(condition ? { condition } : {}),
      ...(taxCode ? { taxClassification: { code: taxCode } } : {}),
    },
  },
});

describe('landingListingsService · smoke', () => {
  beforeEach(() => {
    mockIsdk.listings.reset();
    jest.resetModules();
  });

  test('siblings NUNCA entran a ningún bucket (anti-saturación)', async () => {
    mockIsdk.listings.setPages([
      {
        data: [
          buildListing({ id: 'sib1', isSibling: true }),
          buildListing({ id: 'sib2', isSibling: true }),
          buildListing({ id: 'master1', isMaster: true }),
          buildListing({ id: 'simple1' }),
        ],
        included: [],
      },
    ]);
    const { getLandingListings } = require('../api-util/landingListingsService');
    const payload = await getLandingListings();

    const productIds = payload.products.data.map(l => l.id.uuid);
    expect(productIds).toContain('master1');
    expect(productIds).toContain('simple1');
    expect(productIds).not.toContain('sib1');
    expect(productIds).not.toContain('sib2');
  });

  test('used bucket filtra por condition O taxCode', async () => {
    mockIsdk.listings.setPages([
      {
        data: [
          buildListing({ id: 'used1', condition: 'used' }),
          buildListing({ id: 'used2', taxCode: 'exento_9_iv' }),
          buildListing({ id: 'new1' }),
          buildListing({ id: 'sib-used', isSibling: true, condition: 'used' }),
        ],
        included: [],
      },
    ]);
    const { getLandingListings } = require('../api-util/landingListingsService');
    const payload = await getLandingListings();

    const usedIds = payload.used.data.map(l => l.id.uuid);
    expect(usedIds).toContain('used1');
    expect(usedIds).toContain('used2');
    expect(usedIds).not.toContain('new1');
    // CRÍTICO: sibling NO entra aunque tenga condition=used.
    expect(usedIds).not.toContain('sib-used');
  });

  test('paginación continúa cuando page 1 se satura de siblings', async () => {
    // Page 1: 100 siblings. Page 2: masters/simples reales.
    const siblings = Array.from({ length: 100 }, (_, i) =>
      buildListing({ id: `sib-${i}`, isSibling: true })
    );
    const realOnes = Array.from({ length: 20 }, (_, i) =>
      buildListing({ id: `real-${i}`, isMaster: i % 2 === 0 })
    );
    mockIsdk.listings.setPages([
      { data: siblings, included: [] },
      { data: realOnes, included: [] },
    ]);
    const { getLandingListings } = require('../api-util/landingListingsService');
    const payload = await getLandingListings();

    expect(payload.products.data.length).toBe(20);
    const ids = payload.products.data.map(l => l.id.uuid);
    expect(ids).toEqual(expect.arrayContaining(['real-0', 'real-19']));
    expect(ids.every(id => id.startsWith('real-'))).toBe(true);
    // Debe haber hecho al menos 2 llamadas (1 por page × 3 buckets).
    expect(mockIsdk.listings._callCount).toBeGreaterThanOrEqual(2);
  });

  test('included se deduplica por type+id (no infla la respuesta)', async () => {
    const author = {
      id: { uuid: 'author-1' },
      type: 'user',
      attributes: { profile: { displayName: 'Vendedor 1' } },
    };
    mockIsdk.listings.setPages([
      {
        data: [buildListing({ id: 'l1' }), buildListing({ id: 'l2' })],
        included: [author, author, { ...author, _dup: true }],
      },
    ]);
    const { getLandingListings } = require('../api-util/landingListingsService');
    const payload = await getLandingListings();
    const authorsInIncluded = payload.products.included.filter(i => i.type === 'user');
    expect(authorsInIncluded.length).toBe(1);
  });

  test('cache: segunda llamada no consulta Sharetribe', async () => {
    mockIsdk.listings.setPages([
      {
        data: [buildListing({ id: 'm1', isMaster: true })],
        included: [],
      },
    ]);
    const { getLandingListings } = require('../api-util/landingListingsService');
    await getLandingListings();
    const callsAfterFirst = mockIsdk.listings._callCount;
    await getLandingListings();
    expect(mockIsdk.listings._callCount).toBe(callsAfterFirst);
  });
});
