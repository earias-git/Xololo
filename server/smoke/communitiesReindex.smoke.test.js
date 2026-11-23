// XOLOLO 2026-11-23 — smoke test del reindex cron de comunidades.
//
// Verifica:
//   1. Detecta falsos positivos (mirror sin community, pero Sharetribe
//      los devolvió con has:<id>).
//   2. Cuenta correctamente realMembers / siblingsSkipped.
//   3. Dry-run NO escribe.
//   4. Apply hace nuke pattern (null → valor).
//   5. Scoping a una community específica via communityIds.

const uuid = v => ({ uuid: v });

const buildListing = (id, sellerCommunities, extra = {}) => ({
  id: uuid(id),
  type: 'listing',
  attributes: {
    title: `listing-${id}`,
    publicData: { ...extra, sellerCommunities },
  },
});

const makeMockSdk = (listingsByQuery = {}) => {
  const updates = [];
  return {
    _updates: updates,
    listings: {
      query: jest.fn(({ pub_sellerCommunities, page }) => {
        const data = listingsByQuery[pub_sellerCommunities] || [];
        return Promise.resolve({
          data: {
            data: page === 1 ? data : [],
            meta: { totalPages: 1, page },
          },
        });
      }),
      update: jest.fn(({ id, publicData }) => {
        updates.push({ id: id.uuid, publicData });
        return Promise.resolve({ data: { data: null } });
      }),
    },
  };
};

jest.mock('../api-util/integrationSdk', () => ({
  getIntegrationSdk: () => null,
}));

jest.mock('../api-util/communitiesService', () => ({
  listPublic: () => [
    { id: 'opf', slug: 'opf', isPublished: true },
    { id: 'other', slug: 'other', isPublished: true },
  ],
}));

const { reindexCommunities } = require('../cron/communitiesReindex');

describe('reindexCommunities · smoke', () => {
  test('detecta falsos positivos y cuenta realMembers correctamente', async () => {
    const sdk = makeMockSdk({
      'has:opf': [
        buildListing('real-1', ['opf']), // real member
        buildListing('fp-1', []), // falso positivo: []
        buildListing('fp-2', null), // falso positivo: null
        buildListing('fp-3', ['other']), // falso positivo: no incluye opf
        buildListing('sib-1', [], { variantGroupId: 'g1', isVariantMaster: false }),
      ],
      'has:other': [],
    });
    const stats = await reindexCommunities({
      dryRun: true,
      communityIds: ['opf'],
      isdk: sdk,
    });
    expect(stats.perCommunity[0]).toMatchObject({
      communityId: 'opf',
      raw: 5,
      realMembers: 1,
      siblingsSkipped: 1,
      falsePositives: 3,
      reindexed: 0, // dry-run
    });
    expect(sdk.listings.update).not.toHaveBeenCalled();
  });

  test('apply ejecuta nuke pattern (null → nextSc) por cada falso positivo', async () => {
    const sdk = makeMockSdk({
      'has:opf': [buildListing('fp-1', [])],
      'has:other': [],
    });
    const stats = await reindexCommunities({
      dryRun: false,
      communityIds: ['opf'],
      isdk: sdk,
    });
    expect(stats.totals.reindexed).toBe(1);
    // Dos updates por listing: null + value
    expect(sdk._updates).toHaveLength(2);
    expect(sdk._updates[0].publicData).toEqual({ sellerCommunities: null });
    expect(sdk._updates[1].publicData).toEqual({ sellerCommunities: [] });
  });

  test('preserva valores no-opf en el array (array sin el id es falso positivo pero mantiene other)', async () => {
    const sdk = makeMockSdk({
      'has:opf': [buildListing('fp', ['other-community'])],
      'has:other': [],
    });
    await reindexCommunities({
      dryRun: false,
      communityIds: ['opf'],
      isdk: sdk,
    });
    expect(sdk._updates[1].publicData).toEqual({
      sellerCommunities: ['other-community'],
    });
  });

  test('communityIds scope sólo corre sobre las nombradas', async () => {
    const sdk = makeMockSdk({
      'has:opf': [buildListing('real-opf', ['opf'])],
      'has:other': [buildListing('real-other', ['other'])],
    });
    const stats = await reindexCommunities({
      dryRun: true,
      communityIds: ['opf'],
      isdk: sdk,
    });
    expect(stats.perCommunity).toHaveLength(1);
    expect(stats.perCommunity[0].communityId).toBe('opf');
    expect(sdk.listings.query).toHaveBeenCalledTimes(1);
  });

  test('sin communityIds corre sobre todas las publicadas', async () => {
    const sdk = makeMockSdk({
      'has:opf': [],
      'has:other': [],
    });
    const stats = await reindexCommunities({ dryRun: true, isdk: sdk });
    expect(stats.perCommunity).toHaveLength(2);
    expect(stats.perCommunity.map(p => p.communityId).sort()).toEqual(['opf', 'other']);
  });

  test('errors incrementan sin tumbar la corrida', async () => {
    const sdk = makeMockSdk({
      'has:opf': [buildListing('fp-1', [])],
      'has:other': [],
    });
    sdk.listings.update.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    const stats = await reindexCommunities({
      dryRun: false,
      communityIds: ['opf'],
      isdk: sdk,
    });
    expect(stats.totals.errors).toBe(1);
    expect(stats.totals.reindexed).toBe(0);
  });
});
