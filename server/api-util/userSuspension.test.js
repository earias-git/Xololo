// XOLOLO task #42 — tests de los helpers de suspensión.

const {
  isUserSuspended,
  getSuspensionSummary,
  markSuspended,
  markUnsuspended,
} = require('./userSuspension');

const makeUser = overrides => ({
  attributes: {
    profile: {
      publicData: overrides?.publicData || {},
      metadata: overrides?.metadata || {},
    },
  },
});

describe('isUserSuspended', () => {
  it('user sin publicData → false', () => {
    expect(isUserSuspended({})).toBe(false);
    expect(isUserSuspended(null)).toBe(false);
  });

  it('publicData.xololoSuspended.active=true → true', () => {
    const u = makeUser({ publicData: { xololoSuspended: { active: true, reason: 'x' } } });
    expect(isUserSuspended(u)).toBe(true);
  });

  it('publicData.xololoSuspended existe pero active=false → false', () => {
    const u = makeUser({ publicData: { xololoSuspended: { active: false } } });
    expect(isUserSuspended(u)).toBe(false);
  });

  it('publicData.xololoSuspended null → false', () => {
    const u = makeUser({ publicData: { xololoSuspended: null } });
    expect(isUserSuspended(u)).toBe(false);
  });
});

describe('getSuspensionSummary', () => {
  it('user no suspendido → null', () => {
    expect(getSuspensionSummary({})).toBe(null);
    expect(getSuspensionSummary(makeUser({ publicData: { xololoSuspended: { active: false } } }))).toBe(null);
  });
  it('user suspendido → objeto con reason/at', () => {
    const u = makeUser({
      publicData: {
        xololoSuspended: { active: true, reason: 'spam', at: '2026-10-28T00:00:00.000Z' },
      },
    });
    expect(getSuspensionSummary(u)).toEqual({
      active: true,
      reason: 'spam',
      at: '2026-10-28T00:00:00.000Z',
    });
  });
});

const makeMockIsdk = (initial = {}) => {
  const stored = { publicData: { ...(initial.publicData || {}) }, metadata: { ...(initial.metadata || {}) } };
  return {
    _stored: stored,
    users: {
      show: jest.fn(() =>
        Promise.resolve({
          data: {
            data: {
              attributes: {
                profile: {
                  publicData: stored.publicData,
                  metadata: stored.metadata,
                },
              },
            },
          },
        })
      ),
      updateProfile: jest.fn(({ publicData, metadata }) => {
        if (publicData) stored.publicData = { ...stored.publicData, ...publicData };
        if (metadata) stored.metadata = { ...stored.metadata, ...metadata };
        return Promise.resolve({ data: {} });
      }),
    },
  };
};

describe('markSuspended', () => {
  it('escribe publicData.xololoSuspended + metadata.xololoSuspension con history', async () => {
    const isdk = makeMockIsdk();
    await markSuspended({
      isdk,
      userId: 'u1',
      reason: 'spam reiterado',
      operator: { id: 'op-1', email: 'kike@xo.mx', name: 'Kike' },
    });
    expect(isdk._stored.publicData.xololoSuspended.active).toBe(true);
    expect(isdk._stored.publicData.xololoSuspended.reason).toBe('spam reiterado');
    const sus = isdk._stored.metadata.xololoSuspension;
    expect(sus.suspended).toBe(true);
    expect(sus.by.email).toBe('kike@xo.mx');
    expect(sus.history).toHaveLength(1);
    expect(sus.history[0].action).toBe('suspend');
  });

  it('append al history preservando los previos', async () => {
    const isdk = makeMockIsdk({
      metadata: {
        xololoSuspension: {
          history: [{ action: 'suspend', reason: 'viejo', at: '2026-01-01', by: 'otro' }],
        },
      },
    });
    await markSuspended({
      isdk,
      userId: 'u1',
      reason: 'nuevo',
      operator: { id: 'op-2', email: 'ana@xo.mx' },
    });
    const h = isdk._stored.metadata.xololoSuspension.history;
    expect(h).toHaveLength(2);
    expect(h[0].reason).toBe('viejo');
    expect(h[1].reason).toBe('nuevo');
  });
});

describe('markUnsuspended', () => {
  it('setea publicData.xololoSuspended=null y marca metadata.suspended=false', async () => {
    const isdk = makeMockIsdk({
      publicData: { xololoSuspended: { active: true, reason: 'x', at: '2026-01-01' } },
      metadata: {
        xololoSuspension: {
          suspended: true,
          reason: 'x',
          at: '2026-01-01',
          history: [{ action: 'suspend', reason: 'x', at: '2026-01-01', by: 'op' }],
        },
      },
    });
    await markUnsuspended({
      isdk,
      userId: 'u1',
      reason: 'resolvio',
      operator: { email: 'ana@xo.mx' },
    });
    expect(isdk._stored.publicData.xololoSuspended).toBe(null);
    expect(isdk._stored.metadata.xololoSuspension.suspended).toBe(false);
    expect(isdk._stored.metadata.xololoSuspension.unsuspendedReason).toBe('resolvio');
    const h = isdk._stored.metadata.xololoSuspension.history;
    expect(h).toHaveLength(2);
    expect(h[1].action).toBe('unsuspend');
  });
});
