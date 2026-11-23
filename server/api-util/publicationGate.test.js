// XOLOLO ADR-007 PR 2 — tests del gate de publicación y de la frontera
// alineada con PUBLISHABLE_INTERNAL_STATUSES.

const {
  applyPublicationGate,
  isPublishableStatus,
  PUBLISHABLE_INTERNAL_STATUSES,
} = require('./publicationGate');

// ============================================================
// isPublishableStatus — frontera LOCKED por ADR-007
// ============================================================

describe('isPublishableStatus — frontera ADR-007', () => {
  test('active es publicable', () => {
    expect(isPublishableStatus('active')).toBe(true);
  });

  test('past_due es publicable (ventana de gracia)', () => {
    expect(isPublishableStatus('past_due')).toBe(true);
  });

  test('canceled NO es publicable', () => {
    expect(isPublishableStatus('canceled')).toBe(false);
  });

  test('none NO es publicable', () => {
    expect(isPublishableStatus('none')).toBe(false);
  });

  test('null NO es publicable', () => {
    expect(isPublishableStatus(null)).toBe(false);
  });

  test('status desconocido NO es publicable', () => {
    expect(isPublishableStatus('totally_new_status')).toBe(false);
  });

  test('PUBLISHABLE_INTERNAL_STATUSES contiene exactamente active + past_due', () => {
    expect(PUBLISHABLE_INTERNAL_STATUSES.sort()).toEqual(['active', 'past_due']);
  });
});

// ============================================================
// Mock Integration SDK
// ============================================================

const makeMockIsdk = ({ sellerMode, listings = [] }) => {
  const store = listings.map(l => ({ ...l }));
  const isdk = {
    users: {
      show: jest.fn(({ id }) =>
        Promise.resolve({
          data: {
            data: {
              id: { uuid: id },
              attributes: {
                profile: { publicData: sellerMode ? { sellerMode } : {} },
              },
            },
          },
        })
      ),
    },
    listings: {
      query: jest.fn(({ authorId, states }) => {
        const filtered = store.filter(l => states.includes(l.attributes.state));
        return Promise.resolve({
          data: {
            data: filtered.map(l => ({ ...l })),
            meta: { totalPages: 1 },
          },
        });
      }),
      close: jest.fn(({ id }) => {
        const l = store.find(x => x.id.uuid === id.uuid);
        if (l) l.attributes.state = 'closed';
        return Promise.resolve({ data: { data: l } });
      }),
      open: jest.fn(({ id }) => {
        const l = store.find(x => x.id.uuid === id.uuid);
        if (l) l.attributes.state = 'published';
        return Promise.resolve({ data: { data: l } });
      }),
      update: jest.fn(({ id, metadata }) => {
        const l = store.find(x => x.id.uuid === id.uuid);
        if (l) l.attributes.metadata = { ...(l.attributes.metadata || {}), ...metadata };
        return Promise.resolve({ data: { data: l } });
      }),
    },
    _store: store,
  };
  return isdk;
};

const uuid = v => ({ uuid: v });

const listing = (id, state, meta = {}) => ({
  id: uuid(id),
  attributes: { state, metadata: meta },
});

// ============================================================
// applyPublicationGate
// ============================================================

describe('applyPublicationGate — ADR-007 PR 2', () => {
  test('casual_reseller está exento — no toca nada', async () => {
    const isdk = makeMockIsdk({
      sellerMode: 'casual_reseller',
      listings: [listing('l1', 'published'), listing('l2', 'published')],
    });
    const result = await applyPublicationGate({
      isdk,
      sellerId: 'seller-A',
      shouldBeVisible: false,
    });
    expect(result.skipped).toBe('casual_reseller');
    expect(result.closedCount).toBe(0);
    expect(isdk.listings.close).not.toHaveBeenCalled();
  });

  test('store sin shouldBeVisible — cierra published y marca xololoGatedClosed', async () => {
    const isdk = makeMockIsdk({
      sellerMode: 'store',
      listings: [listing('l1', 'published'), listing('l2', 'published')],
    });
    const result = await applyPublicationGate({
      isdk,
      sellerId: 'seller-A',
      shouldBeVisible: false,
    });
    expect(result.closedCount).toBe(2);
    expect(result.reopenedCount).toBe(0);
    expect(isdk.listings.close).toHaveBeenCalledTimes(2);
    // marca xololoGatedClosed=true para distinguir de close manual
    expect(isdk.listings.update).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { xololoGatedClosed: true } })
    );
  });

  test('store con shouldBeVisible — reabre SOLO los que cerró Xololo', async () => {
    const isdk = makeMockIsdk({
      sellerMode: 'store',
      listings: [
        listing('l1', 'closed', { xololoGatedClosed: true }), // cerrado por Xololo → reabrir
        listing('l2', 'closed', {}), // cerrado por seller → NO tocar
      ],
    });
    const result = await applyPublicationGate({
      isdk,
      sellerId: 'seller-A',
      shouldBeVisible: true,
    });
    expect(result.reopenedCount).toBe(1);
    expect(result.closedCount).toBe(0);
    expect(isdk.listings.open).toHaveBeenCalledTimes(1);
    expect(isdk.listings.open).toHaveBeenCalledWith({ id: uuid('l1') });
  });

  test('store sin listings publicados — no hace nada pero no truena', async () => {
    const isdk = makeMockIsdk({ sellerMode: 'store', listings: [] });
    const result = await applyPublicationGate({
      isdk,
      sellerId: 'seller-A',
      shouldBeVisible: false,
    });
    expect(result.closedCount).toBe(0);
    expect(result.reopenedCount).toBe(0);
  });

  test('users.show truena — fail-close, sigue con el gate', async () => {
    const isdk = makeMockIsdk({
      sellerMode: 'store',
      listings: [listing('l1', 'published')],
    });
    isdk.users.show.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    const result = await applyPublicationGate({
      isdk,
      sellerId: 'seller-A',
      shouldBeVisible: false,
    });
    // fail-close: cierra pese a no poder verificar sellerMode
    expect(result.closedCount).toBe(1);
    expect(result.skipped).toBeUndefined();
  });
});
