// XOLOLO Blindaje — smoke test del service de comunidades (ADR-006).
//
// Verifica invariantes públicas:
//   1. 404 cuando isPublished=false.
//   2. listPublic sólo devuelve isPublished=true.
//   3. toPublic NO expone admins/createdBy/isPublished.
//   4. Siblings de variantes NUNCA aparecen en /listings.
//   5. Cache funciona (segunda llamada no re-pega a Sharetribe).
//
// Si estos fallan, PARAR. Cambio a la lógica = riesgo de exponer
// metadata privada o romper el filtro de publicación.

const buildListing = (id, extra = {}) => ({
  id: { uuid: id },
  type: 'listing',
  attributes: {
    title: `listing-${id}`,
    // `sellerCommunities: ['opf']` por default refleja un listing que
    // opt-in a OPF — necesario para pasar el post-filter defensivo
    // `inCommunity` que `communitiesService.fetchCommunityListings`
    // aplica para esquivar el índice stale de Sharetribe (ADR-006 §7
    // bis, hotfix 2026-11-23).
    publicData: { listingType: 'product', sellerCommunities: ['opf'], ...extra },
  },
});

const mockIsdk = {
  listings: {
    _lastQuery: null,
    _callCount: 0,
    _data: [],
    reset() {
      this._lastQuery = null;
      this._callCount = 0;
      this._data = [];
    },
    setData(data) {
      this._data = data;
    },
    query(params) {
      this._callCount += 1;
      this._lastQuery = params;
      return Promise.resolve({
        data: {
          data: this._data,
          included: [],
          meta: { page: 1, totalPages: 1, totalItems: this._data.length },
        },
      });
    },
  },
};

jest.mock('../api-util/integrationSdk', () => ({
  getIntegrationSdk: () => mockIsdk,
}));

// Mock del catálogo seed para controlar isPublished y comunidades
// de prueba. Reasignable antes de cada test vía setSeed().
const FAKE_SEED = [];
jest.mock('../../src/config/communities', () => ({
  get COMMUNITIES_SEED() {
    return FAKE_SEED;
  },
}));

const setSeed = seed => {
  FAKE_SEED.length = 0;
  FAKE_SEED.push(...seed);
};

const makeCommunity = (id, isPublished = true, extra = {}) => ({
  id,
  type: 'sectorial',
  slug: id,
  name: `Comunidad ${id}`,
  tagline: 't',
  description: 'd',
  bylaws: 'b',
  branding: { logoUrl: null, heroUrl: null },
  admins: ['admin-1'], // privado, NO debe exponerse
  membership: 'open',
  requiresCertification: false,
  primaryFacets: {},
  seoKeywords: [],
  isPublished,
  sellerCount: 0,
  createdAt: '2026-11-18T00:00:00Z',
  createdBy: 'seed', // privado, NO debe exponerse
  ...extra,
});

describe('communitiesService · smoke', () => {
  beforeEach(() => {
    mockIsdk.listings.reset();
    jest.resetModules();
    setSeed([]);
  });

  describe('listPublic', () => {
    test('solo devuelve isPublished=true', () => {
      setSeed([
        makeCommunity('opf', true),
        makeCommunity('draft', false),
        makeCommunity('alimentos', true),
      ]);
      const { listPublic } = require('../api-util/communitiesService');
      const out = listPublic();
      const ids = out.map(c => c.id).sort();
      expect(ids).toEqual(['alimentos', 'opf']);
    });

    test('filtra isDeleted=true', () => {
      setSeed([
        makeCommunity('opf', true),
        makeCommunity('vieja', true, { isDeleted: true }),
      ]);
      const { listPublic } = require('../api-util/communitiesService');
      expect(listPublic().map(c => c.id)).toEqual(['opf']);
    });
  });

  describe('toPublic (proyección)', () => {
    test('NUNCA expone admins, createdBy o isPublished', () => {
      setSeed([makeCommunity('opf', true)]);
      const { getBySlugPublic } = require('../api-util/communitiesService');
      const out = getBySlugPublic('opf');
      expect(out).not.toHaveProperty('admins');
      expect(out).not.toHaveProperty('createdBy');
      expect(out).not.toHaveProperty('isPublished');
    });

    test('incluye campos públicos esperados', () => {
      setSeed([makeCommunity('opf', true)]);
      const { getBySlugPublic } = require('../api-util/communitiesService');
      const out = getBySlugPublic('opf');
      expect(out).toMatchObject({
        id: 'opf',
        type: 'sectorial',
        slug: 'opf',
        name: 'Comunidad opf',
        membership: 'open',
      });
    });
  });

  describe('getBySlugPublic', () => {
    test('404 (null) cuando isPublished=false', () => {
      setSeed([makeCommunity('draft', false)]);
      const { getBySlugPublic } = require('../api-util/communitiesService');
      expect(getBySlugPublic('draft')).toBeNull();
    });

    test('200 cuando isPublished=true', () => {
      setSeed([makeCommunity('opf', true)]);
      const { getBySlugPublic } = require('../api-util/communitiesService');
      expect(getBySlugPublic('opf')).not.toBeNull();
    });

    test('null cuando el slug no existe', () => {
      setSeed([makeCommunity('opf', true)]);
      const { getBySlugPublic } = require('../api-util/communitiesService');
      expect(getBySlugPublic('inexistente')).toBeNull();
    });
  });

  describe('getCommunityListings', () => {
    test('404 (null) cuando la comunidad no está publicada', async () => {
      setSeed([makeCommunity('draft', false)]);
      const { getCommunityListings } = require('../api-util/communitiesService');
      const out = await getCommunityListings({ slug: 'draft', page: 1, perPage: 24 });
      expect(out).toBeNull();
    });

    test('filtra siblings de variantes (no deben aparecer en /listings)', async () => {
      setSeed([makeCommunity('opf', true)]);
      mockIsdk.listings.setData([
        buildListing('normal-1'),
        buildListing('master-1', { variantGroupId: 'g1', isVariantMaster: true }),
        buildListing('sib-1', { variantGroupId: 'g1', isVariantMaster: false }),
        buildListing('sib-2', { variantGroupId: 'g2', isVariantMaster: false }),
      ]);
      const { getCommunityListings } = require('../api-util/communitiesService');
      const out = await getCommunityListings({ slug: 'opf', page: 1, perPage: 24 });
      const ids = out.listings.data.map(l => l.id.uuid).sort();
      expect(ids).toEqual(['master-1', 'normal-1']);
    });

    test('el query a Sharetribe pasa pub_sellerCommunities:has:<id>', async () => {
      setSeed([makeCommunity('opf', true)]);
      mockIsdk.listings.setData([buildListing('x')]);
      const { getCommunityListings } = require('../api-util/communitiesService');
      await getCommunityListings({ slug: 'opf', page: 1, perPage: 24 });
      expect(mockIsdk.listings._lastQuery?.pub_sellerCommunities).toBe('has:opf');
    });

    test('cache: segunda llamada a page 1 sin filtros no re-pega', async () => {
      setSeed([makeCommunity('opf', true)]);
      mockIsdk.listings.setData([buildListing('x')]);
      const { getCommunityListings } = require('../api-util/communitiesService');
      await getCommunityListings({ slug: 'opf', page: 1, perPage: 24 });
      const callsAfterFirst = mockIsdk.listings._callCount;
      await getCommunityListings({ slug: 'opf', page: 1, perPage: 24 });
      expect(mockIsdk.listings._callCount).toBe(callsAfterFirst);
    });

    test('sin cache cuando hay filtros o page > 1', async () => {
      setSeed([makeCommunity('opf', true)]);
      mockIsdk.listings.setData([buildListing('x')]);
      const { getCommunityListings } = require('../api-util/communitiesService');
      await getCommunityListings({
        slug: 'opf',
        page: 1,
        perPage: 24,
        pubFilters: { pub_categoryLevel1: 'moda' },
      });
      await getCommunityListings({
        slug: 'opf',
        page: 1,
        perPage: 24,
        pubFilters: { pub_categoryLevel1: 'moda' },
      });
      expect(mockIsdk.listings._callCount).toBe(2);
    });
  });

  describe('fail-open', () => {
    test('si Sharetribe falla, devuelve listings vacío en vez de romper', async () => {
      setSeed([makeCommunity('opf', true)]);
      mockIsdk.listings.query = () => Promise.reject(new Error('sharetribe down'));
      jest.resetModules();
      const { getCommunityListings } = require('../api-util/communitiesService');
      const out = await getCommunityListings({ slug: 'opf', page: 1, perPage: 24 });
      expect(out).not.toBeNull();
      expect(out.listings.data).toEqual([]);
    });
  });
});
