// XOLOLO Blindaje — smoke test del overlay admin (ADR-006 PR-4).
//
// Verifica invariantes:
//   1. Sin overlay, service.listPublic refleja el seed tal cual.
//   2. Un setPublished(false) saca una community publicada.
//   3. Un setPublished(true) publica una community que estaba draft.
//   4. clear() restaura al valor del seed.
//   5. getBySlugPublic reacciona al overlay.
//   6. invalidateCache: tras el toggle, la siguiente llamada a
//      getCommunityPayload re-pega a Sharetribe (no sirve el cache
//      viejo).

const FAKE_SEED = [];
jest.mock('../../src/config/communities', () => ({
  get COMMUNITIES_SEED() {
    return FAKE_SEED;
  },
}));

const mockIsdk = {
  listings: {
    _callCount: 0,
    reset() {
      this._callCount = 0;
    },
    query() {
      this._callCount += 1;
      return Promise.resolve({
        data: { data: [], included: [], meta: { page: 1, totalPages: 1 } },
      });
    },
  },
};
jest.mock('../api-util/integrationSdk', () => ({
  getIntegrationSdk: () => mockIsdk,
}));

const setSeed = seed => {
  FAKE_SEED.length = 0;
  FAKE_SEED.push(...seed);
};

const makeCommunity = (id, isPublished = true) => ({
  id,
  type: 'sectorial',
  slug: id,
  name: `C${id}`,
  isPublished,
  isDeleted: false,
  admins: [],
  createdBy: 'seed',
});

describe('communitiesAdminOverlay · smoke', () => {
  beforeEach(() => {
    jest.resetModules();
    mockIsdk.listings.reset();
    // Reset del overlay entre tests.
    const overlay = require('../api-util/communitiesAdminOverlay');
    overlay.reset();
  });

  test('sin overlay, listPublic refleja el seed', () => {
    setSeed([makeCommunity('opf', true), makeCommunity('draft', false)]);
    const { listPublic } = require('../api-util/communitiesService');
    expect(listPublic().map(c => c.id)).toEqual(['opf']);
  });

  test('setPublished(false) saca una community publicada', () => {
    setSeed([makeCommunity('opf', true)]);
    const overlay = require('../api-util/communitiesAdminOverlay');
    const { listPublic, getBySlugPublic } = require('../api-util/communitiesService');

    expect(listPublic().map(c => c.id)).toEqual(['opf']);
    overlay.setPublished({ id: 'opf', isPublished: false, operatorEmail: 'op@x' });
    expect(listPublic()).toEqual([]);
    expect(getBySlugPublic('opf')).toBeNull();
  });

  test('setPublished(true) publica una community que estaba draft', () => {
    setSeed([makeCommunity('draft', false)]);
    const overlay = require('../api-util/communitiesAdminOverlay');
    const { listPublic, getBySlugPublic } = require('../api-util/communitiesService');

    expect(listPublic()).toEqual([]);
    overlay.setPublished({ id: 'draft', isPublished: true, operatorEmail: 'op@x' });
    expect(listPublic().map(c => c.id)).toEqual(['draft']);
    expect(getBySlugPublic('draft')).toMatchObject({ id: 'draft' });
  });

  test('clear() restaura al valor del seed', () => {
    setSeed([makeCommunity('opf', true)]);
    const overlay = require('../api-util/communitiesAdminOverlay');
    const { listPublic } = require('../api-util/communitiesService');

    overlay.setPublished({ id: 'opf', isPublished: false });
    expect(listPublic()).toEqual([]);
    overlay.clear('opf');
    expect(listPublic().map(c => c.id)).toEqual(['opf']);
  });

  test('registra operatorEmail y updatedAt en el overlay', () => {
    const overlay = require('../api-util/communitiesAdminOverlay');
    overlay.setPublished({ id: 'opf', isPublished: true, operatorEmail: 'earias@x' });
    const entry = overlay.get('opf');
    expect(entry.isPublished).toBe(true);
    expect(entry.updatedBy).toBe('earias@x');
    expect(typeof entry.updatedAt).toBe('string');
    expect(new Date(entry.updatedAt).toString()).not.toBe('Invalid Date');
  });

  test('invalidateCache: tras toggle, getCommunityPayload re-pega', async () => {
    setSeed([makeCommunity('opf', true)]);
    const overlay = require('../api-util/communitiesAdminOverlay');
    const { getCommunityPayload, invalidateCache } = require('../api-util/communitiesService');

    await getCommunityPayload('opf');
    const callsAfterFirst = mockIsdk.listings._callCount;
    // Cache hit — no re-pega.
    await getCommunityPayload('opf');
    expect(mockIsdk.listings._callCount).toBe(callsAfterFirst);
    // Toggle + invalidate + nueva llamada → re-pega.
    overlay.setPublished({ id: 'opf', isPublished: true }); // no-op lógicamente pero refresca
    invalidateCache();
    await getCommunityPayload('opf');
    expect(mockIsdk.listings._callCount).toBeGreaterThan(callsAfterFirst);
  });
});
