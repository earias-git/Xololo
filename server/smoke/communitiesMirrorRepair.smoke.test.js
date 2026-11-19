// XOLOLO Blindaje — smoke test del cron de mirror repair (ADR-006 PR-5).
//
// Verifica invariantes:
//   1. Idempotencia: run 2 veces consecutivas no cambia nada la 2a.
//   2. Un listing con mirror distinto al expected se actualiza con
//      el flat del profile.
//   3. Un listing con mirror en el orden correcto NO se re-escribe.
//   4. Dry-run NO escribe, pero cuenta el drift.
//   5. Users sin memberships se saltan (no escanea sus listings).
//   6. Errors por listings.update individual no abortan el run.

// XOLOLO 2026-11-19: mock del service de comunidades para controlar
// el catalog que ve el computeMirrorForListing. Por default [] →
// opt-out para todas las comunidades (shape legacy de estos tests).
// Tests nuevos del opt-in setean FAKE_CATALOG antes del run.
let FAKE_CATALOG = [];
jest.mock('../api-util/communitiesService', () => ({
  getAllRaw: () => FAKE_CATALOG,
  invalidateCache: jest.fn(),
}));
const setCatalog = c => {
  FAKE_CATALOG.length = 0;
  FAKE_CATALOG.push(...c);
};

const { repairMirror, sameSet } = require('../cron/communitiesMirrorRepair');

const makeUser = (id, communities = null) => ({
  id: { uuid: id },
  type: 'user',
  attributes: {
    profile: {
      publicData: communities ? { communities } : {},
    },
  },
});

const makeListing = (id, sellerCommunities = []) => ({
  id: { uuid: id },
  type: 'listing',
  attributes: {
    publicData: { sellerCommunities },
  },
});

const buildSdk = ({ users, listingsBySeller, failUpdateIds = new Set() }) => ({
  users: {
    query: jest.fn(({ page }) =>
      Promise.resolve({
        data: {
          data: page === 1 ? users : [],
          meta: { page, totalPages: 1 },
        },
      })
    ),
  },
  listings: {
    query: jest.fn(({ authorId, page }) =>
      Promise.resolve({
        data: {
          data: page === 1 ? listingsBySeller[authorId] || [] : [],
          meta: { page, totalPages: 1 },
        },
      })
    ),
    update: jest.fn(({ id }) => {
      if (failUpdateIds.has(id)) {
        return Promise.reject(new Error('conflict'));
      }
      return Promise.resolve({});
    }),
  },
});

describe('sameSet', () => {
  test('igual contenido, orden distinto → true', () => {
    expect(sameSet(['a', 'b'], ['b', 'a'])).toBe(true);
  });
  test('diferente longitud → false', () => {
    expect(sameSet(['a'], ['a', 'b'])).toBe(false);
  });
  test('diferente contenido → false', () => {
    expect(sameSet(['a', 'b'], ['a', 'c'])).toBe(false);
  });
  test('ambos vacíos → true', () => {
    expect(sameSet([], [])).toBe(true);
  });
});

describe('repairMirror · smoke', () => {
  test('actualiza listing con mirror desactualizado', async () => {
    const sdk = buildSdk({
      users: [makeUser('u1', { sectorial: ['opf'] })],
      listingsBySeller: {
        u1: [makeListing('l1', []), makeListing('l2', ['vieja'])],
      },
    });
    const stats = await repairMirror({ dryRun: false, isdk: sdk });
    expect(stats.usersScanned).toBe(1);
    expect(stats.usersWithMemberships).toBe(1);
    expect(stats.listingsScanned).toBe(2);
    expect(stats.listingsUpdated).toBe(2);
    expect(stats.listingsSkipped).toBe(0);
    expect(sdk.listings.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'l1', publicData: { sellerCommunities: ['opf'] } })
    );
    expect(sdk.listings.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'l2', publicData: { sellerCommunities: ['opf'] } })
    );
  });

  test('idempotencia: run 2 veces, la 2a no escribe', async () => {
    const sdk = buildSdk({
      users: [makeUser('u1', { sectorial: ['opf'] })],
      listingsBySeller: {
        u1: [makeListing('l1', ['opf'])],
      },
    });
    const stats = await repairMirror({ dryRun: false, isdk: sdk });
    expect(stats.listingsUpdated).toBe(0);
    expect(stats.listingsSkipped).toBe(1);
    expect(sdk.listings.update).not.toHaveBeenCalled();
  });

  test('mirror en orden distinto → NO se re-escribe (sameSet)', async () => {
    const sdk = buildSdk({
      users: [makeUser('u1', { sectorial: ['opf'], geografica: ['morelos'] })],
      listingsBySeller: {
        u1: [makeListing('l1', ['morelos', 'opf'])], // orden inverso
      },
    });
    const stats = await repairMirror({ dryRun: false, isdk: sdk });
    expect(stats.listingsUpdated).toBe(0);
    expect(stats.listingsSkipped).toBe(1);
    expect(sdk.listings.update).not.toHaveBeenCalled();
  });

  test('dry-run NO escribe pero cuenta drift', async () => {
    const sdk = buildSdk({
      users: [makeUser('u1', { sectorial: ['opf'] })],
      listingsBySeller: {
        u1: [makeListing('l1', [])],
      },
    });
    const stats = await repairMirror({ dryRun: true, isdk: sdk });
    expect(stats.dryRun).toBe(true);
    expect(stats.listingsUpdated).toBe(1); // "sería actualizado"
    expect(sdk.listings.update).not.toHaveBeenCalled();
    expect(stats.drift).toHaveLength(1);
    expect(stats.drift[0]).toEqual({ listingId: 'l1', from: [], to: ['opf'] });
  });

  test('salta users sin memberships', async () => {
    const sdk = buildSdk({
      users: [makeUser('u1'), makeUser('u2', { sectorial: [] })],
      listingsBySeller: {
        u1: [makeListing('l1', ['legacy'])],
        u2: [makeListing('l2', ['legacy'])],
      },
    });
    const stats = await repairMirror({ dryRun: false, isdk: sdk });
    expect(stats.usersScanned).toBe(2);
    expect(stats.usersWithMemberships).toBe(0);
    expect(stats.listingsScanned).toBe(0);
    expect(stats.listingsUpdated).toBe(0);
    expect(sdk.listings.query).not.toHaveBeenCalled();
  });

  test('respeta excludeFromCommunities del listing', async () => {
    // Seller con 2 comunidades. Un listing tiene exclude de opf.
    // El mirror esperado para ese listing es solo ['morelos'].
    const listing1 = {
      id: { uuid: 'nochebuena' },
      attributes: { publicData: { sellerCommunities: [] } },
    };
    const listing2 = {
      id: { uuid: 'escritorio' },
      attributes: {
        publicData: {
          sellerCommunities: ['opf', 'morelos'], // drift que hay que corregir
          excludeFromCommunities: ['opf'],
        },
      },
    };
    const sdk = buildSdk({
      users: [makeUser('u1', { sectorial: ['opf'], geografica: ['morelos'] })],
      listingsBySeller: {
        u1: [listing1, listing2],
      },
    });
    const stats = await repairMirror({ dryRun: false, isdk: sdk });
    // Ambos listings tienen drift y se corrigen.
    expect(stats.listingsUpdated).toBe(2);
    // nochebuena: ambos ids.
    expect(sdk.listings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'nochebuena',
        publicData: { sellerCommunities: expect.arrayContaining(['opf', 'morelos']) },
      })
    );
    // escritorio: sin opf (respeta exclude).
    expect(sdk.listings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'escritorio',
        publicData: { sellerCommunities: ['morelos'] },
      })
    );
  });

  test('error en listings.update no aborta el run', async () => {
    const sdk = buildSdk({
      users: [makeUser('u1', { sectorial: ['opf'] })],
      listingsBySeller: {
        u1: [makeListing('l1', []), makeListing('l2', []), makeListing('l3', [])],
      },
      failUpdateIds: new Set(['l2']),
    });
    const stats = await repairMirror({ dryRun: false, isdk: sdk });
    expect(stats.listingsUpdated).toBe(2);
    expect(stats.errors).toBe(1);
  });
});
