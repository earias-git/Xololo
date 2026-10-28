// XOLOLO OPS Users 360 · Fase A — tests de la lógica pura (filters,
// sort, facets, clasificación). El fetch del snapshot se mockea en
// tests del endpoint; aquí verificamos las transformaciones puras.

const {
  applyFilters,
  applySortAndPagination,
  computeFacets,
  classifyListingSegment,
  classifyUserType,
  legalDocsSummary,
  buildUserRosterEntry,
} = require('./opsUsersRoster');

const makeListing = (overrides = {}) => ({
  id: { uuid: overrides.id || 'listing-1' },
  attributes: {
    state: overrides.state || 'published',
    publicData: overrides.publicData || {},
  },
});

const makeUser = (overrides = {}) => ({
  id: { uuid: overrides.id || 'user-1' },
  attributes: {
    email: overrides.email || 'u@e.com',
    createdAt: overrides.createdAt || '2026-01-01T00:00:00.000Z',
    stripeConnected: overrides.stripeConnected || false,
    profile: {
      displayName: overrides.displayName || 'User One',
      firstName: overrides.firstName || 'User',
      lastName: overrides.lastName || 'One',
      publicData: overrides.publicData || {},
      metadata: overrides.metadata || {},
    },
  },
});

describe('classifyListingSegment', () => {
  it('unitType service → service', () => {
    expect(classifyListingSegment(makeListing({ publicData: { unitType: 'hour' } }))).toBe(
      'service'
    );
    expect(classifyListingSegment(makeListing({ publicData: { unitType: 'fixed' } }))).toBe(
      'service'
    );
  });
  it('condition used → used', () => {
    expect(
      classifyListingSegment(makeListing({ publicData: { unitType: 'item', condition: 'used' } }))
    ).toBe('used');
  });
  it('default → new', () => {
    expect(classifyListingSegment(makeListing({ publicData: { unitType: 'item' } }))).toBe('new');
    expect(classifyListingSegment(makeListing({ publicData: {} }))).toBe('new');
  });
});

describe('classifyUserType', () => {
  const adminEmails = new Set(['admin@xololo.mx']);

  it('email en adminEmails → admin', () => {
    const u = makeUser({ email: 'admin@xololo.mx' });
    expect(classifyUserType(u, { adminEmails, listingCount: 0, hasPurchases: false })).toBe(
      'admin'
    );
  });

  it('sellerMode=casual_reseller → casual_reseller', () => {
    const u = makeUser({ publicData: { sellerMode: 'casual_reseller' } });
    expect(classifyUserType(u, { adminEmails, listingCount: 0, hasPurchases: false })).toBe(
      'casual_reseller'
    );
  });

  it('sellerMode=store → store', () => {
    const u = makeUser({ publicData: { sellerMode: 'store' } });
    expect(classifyUserType(u, { adminEmails, listingCount: 0, hasPurchases: false })).toBe(
      'store'
    );
  });

  it('sin sellerMode pero con listings → store (inferido)', () => {
    const u = makeUser();
    expect(classifyUserType(u, { adminEmails, listingCount: 2, hasPurchases: false })).toBe(
      'store'
    );
  });

  it('sin listings pero con compras → buyer_only', () => {
    const u = makeUser();
    expect(classifyUserType(u, { adminEmails, listingCount: 0, hasPurchases: true })).toBe(
      'buyer_only'
    );
  });

  it('sin nada → lead', () => {
    const u = makeUser();
    expect(classifyUserType(u, { adminEmails, listingCount: 0, hasPurchases: false })).toBe('lead');
  });
});

describe('legalDocsSummary', () => {
  it('metadata vacía → zeros', () => {
    expect(legalDocsSummary({})).toEqual({
      personType: null,
      approved: 0,
      pending: 0,
      rejected: 0,
      total: 0,
    });
  });

  it('cuenta aprobados / pendientes / rechazados', () => {
    const md = {
      xololoLegalDocs: {
        personType: 'individual',
        docs: {
          a: { status: 'approved' },
          b: { status: 'approved' },
          c: { status: 'pending' },
          d: { status: 'rejected' },
        },
      },
    };
    expect(legalDocsSummary(md)).toEqual({
      personType: 'individual',
      approved: 2,
      pending: 1,
      rejected: 1,
      total: 4,
    });
  });
});

describe('buildUserRosterEntry', () => {
  const adminEmails = new Set(['admin@xololo.mx']);
  const baseCtx = {
    listingsByAuthor: new Map(),
    salesByProvider: new Map(),
    purchasesByCustomer: new Map(),
    adminEmails,
  };

  it('user sin listings ni ventas → lead con totals 0', () => {
    const u = makeUser();
    const entry = buildUserRosterEntry(u, baseCtx);
    expect(entry.type).toBe('lead');
    expect(entry.listings.total).toBe(0);
    expect(entry.sales.count).toBe(0);
    expect(entry.purchases.count).toBe(0);
  });

  it('seller con listings mixtos clasifica cada segmento', () => {
    const ctx = {
      ...baseCtx,
      listingsByAuthor: new Map([
        [
          'user-1',
          [
            makeListing({ publicData: { unitType: 'item' } }),
            makeListing({ publicData: { unitType: 'item', condition: 'used' } }),
            makeListing({ publicData: { unitType: 'hour' } }),
          ],
        ],
      ]),
    };
    const u = makeUser({ id: 'user-1' });
    const entry = buildUserRosterEntry(u, ctx);
    expect(entry.listings).toEqual({ total: 3, published: 3, new: 1, used: 1, service: 1 });
    expect(entry.type).toBe('store');
  });

  it('lastActivityAt usa el max de todos los candidates', () => {
    const u = makeUser({
      createdAt: '2026-01-01T00:00:00.000Z',
      metadata: { xololoActivity: { lastSeenAt: '2026-10-20T00:00:00.000Z' } },
    });
    const ctx = {
      ...baseCtx,
      salesByProvider: new Map([
        ['user-1', { count: 1, gmvYTD: 100, lastAt: '2026-10-25T00:00:00.000Z' }],
      ]),
    };
    const entry = buildUserRosterEntry(u, ctx);
    expect(entry.lastActivityAt).toBe('2026-10-25T00:00:00.000Z');
    expect(entry.lastSeenAt).toBe('2026-10-20T00:00:00.000Z');
  });
});

describe('applyFilters', () => {
  const seller = buildUserRosterEntry(
    makeUser({
      id: 's1',
      email: 'seller@xo.mx',
      displayName: 'Kike Agri',
      publicData: {
        sellerMode: 'store',
        xololoVerified: true,
        slug: 'kike-agri',
        pickupAddress: { area_level1: 'MX-MOR', area_level2: 'Cuernavaca' },
      },
      metadata: {
        xololoSubscription: { status: 'active' },
        xololoLegalDocs: {
          personType: 'individual',
          docs: { a: { status: 'approved' }, b: { status: 'approved' } },
        },
      },
      stripeConnected: true,
    }),
    {
      listingsByAuthor: new Map([['s1', [makeListing({ publicData: { unitType: 'item' } })]]]),
      salesByProvider: new Map(),
      purchasesByCustomer: new Map(),
      adminEmails: new Set(),
    }
  );

  const buyer = buildUserRosterEntry(
    makeUser({
      id: 'b1',
      email: 'buyer@g.com',
      displayName: 'Ana Buyer',
      publicData: { address: { area_level1: 'MX-CDMX' } },
    }),
    {
      listingsByAuthor: new Map(),
      salesByProvider: new Map(),
      purchasesByCustomer: new Map([['b1', { count: 2, lastAt: '2026-10-20T00:00:00.000Z' }]]),
      adminEmails: new Set(),
    }
  );

  const entries = [seller, buyer];

  it('q filtra por email/nombre/slug (case-insensitive)', () => {
    expect(applyFilters(entries, { q: 'kike' })).toEqual([seller]);
    expect(applyFilters(entries, { q: 'BUYER' })).toEqual([buyer]);
    expect(applyFilters(entries, { q: 'nothing' })).toEqual([]);
  });

  it('type filtra', () => {
    expect(applyFilters(entries, { type: 'store' })).toEqual([seller]);
    expect(applyFilters(entries, { type: 'buyer_only' })).toEqual([buyer]);
    expect(applyFilters(entries, { type: 'store,buyer_only' })).toHaveLength(2);
  });

  it('verified yes/no', () => {
    expect(applyFilters(entries, { verified: 'yes' })).toEqual([seller]);
    expect(applyFilters(entries, { verified: 'no' })).toEqual([buyer]);
  });

  it('sub filtra', () => {
    expect(applyFilters(entries, { sub: 'active' })).toEqual([seller]);
    expect(applyFilters(entries, { sub: 'none' })).toEqual([buyer]);
  });

  it('state filtra', () => {
    expect(applyFilters(entries, { state: 'MX-MOR' })).toEqual([seller]);
    expect(applyFilters(entries, { state: 'MX-CDMX' })).toEqual([buyer]);
    // State inválido → se ignora (filtro no se aplica, pasa todo)
    expect(applyFilters(entries, { state: 'INVALID' })).toHaveLength(2);
  });

  it('legal complete/partial/none', () => {
    expect(applyFilters(entries, { legal: 'complete' })).toEqual([seller]);
    expect(applyFilters(entries, { legal: 'none' })).toEqual([buyer]);
  });
});

describe('applySortAndPagination', () => {
  const mk = (id, days) =>
    buildUserRosterEntry(
      makeUser({
        id,
        createdAt: new Date(Date.now() - days * 86_400_000).toISOString(),
      }),
      {
        listingsByAuthor: new Map(),
        salesByProvider: new Map(),
        purchasesByCustomer: new Map(),
        adminEmails: new Set(),
      }
    );

  const entries = [mk('a', 10), mk('b', 1), mk('c', 30), mk('d', 5)];

  it('sort createdAt desc por default', () => {
    const r = applySortAndPagination(entries, { sort: 'createdAt' });
    expect(r.map(e => e.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('sort asc respeta dir', () => {
    const r = applySortAndPagination(entries, { sort: 'createdAt', dir: 'asc' });
    expect(r.map(e => e.id)).toEqual(['c', 'a', 'd', 'b']);
  });

  it('pagina correctamente', () => {
    const r = applySortAndPagination(entries, { sort: 'createdAt', page: 2, pageSize: 2 });
    expect(r.map(e => e.id)).toEqual(['a', 'c']);
  });
});

describe('computeFacets', () => {
  const base = {
    listingsByAuthor: new Map(),
    salesByProvider: new Map(),
    purchasesByCustomer: new Map(),
    adminEmails: new Set(['admin@xololo.mx']),
  };

  it('cuenta por type / verified / sub / stripe / state', () => {
    const entries = [
      buildUserRosterEntry(
        makeUser({
          id: 'a',
          publicData: {
            sellerMode: 'store',
            xololoVerified: true,
            pickupAddress: { area_level1: 'MX-MOR' },
          },
          metadata: { xololoSubscription: { status: 'active' } },
          stripeConnected: true,
        }),
        base
      ),
      buildUserRosterEntry(
        makeUser({
          id: 'b',
          publicData: { sellerMode: 'casual_reseller', address: { area_level1: 'MX-MOR' } },
        }),
        base
      ),
      buildUserRosterEntry(makeUser({ id: 'c', email: 'admin@xololo.mx' }), base),
    ];
    const f = computeFacets(entries);
    expect(f.byType).toEqual({ store: 1, casual_reseller: 1, admin: 1 });
    expect(f.byVerified).toEqual({ yes: 1, no: 2 });
    expect(f.bySub.active).toBe(1);
    expect(f.bySub.none).toBe(2);
    expect(f.byStripe).toEqual({ yes: 1, no: 2 });
    expect(f.byState['MX-MOR']).toBe(2);
  });
});
