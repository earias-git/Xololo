// XOLOLO OPS Users 360 · Fase A — tests del dedupe/bump de user activity.

const {
  recordUserActivity,
  _resetActivityCache,
  DEDUPE_WINDOW_MS,
} = require('./userActivity');

const makeMockIsdk = (overrides = {}) => {
  const calls = { show: [], updateProfile: [] };
  const defaultMetadata = overrides.initialMetadata || {};
  return {
    _calls: calls,
    users: {
      show: jest.fn(({ id }) => {
        calls.show.push(id);
        return Promise.resolve({
          data: {
            data: {
              id: { uuid: id },
              attributes: {
                profile: {
                  metadata: defaultMetadata,
                },
              },
            },
          },
        });
      }),
      updateProfile: jest.fn(args => {
        calls.updateProfile.push(args);
        return Promise.resolve({ data: {} });
      }),
    },
  };
};

describe('recordUserActivity', () => {
  beforeEach(() => {
    _resetActivityCache();
  });

  it('devuelve false si falta isdk o userId', () => {
    expect(recordUserActivity({ isdk: null, userId: 'abc' })).toBe(false);
    expect(recordUserActivity({ isdk: makeMockIsdk(), userId: null })).toBe(false);
  });

  it('primer bump devuelve true y dispara updateProfile async', async () => {
    const isdk = makeMockIsdk();
    const triggered = recordUserActivity({ isdk, userId: 'user-1' });
    expect(triggered).toBe(true);
    // Esperar al microtask queue para que la promesa termine
    await new Promise(r => setTimeout(r, 10));
    expect(isdk._calls.show).toEqual(['user-1']);
    expect(isdk._calls.updateProfile).toHaveLength(1);
    expect(isdk._calls.updateProfile[0].id).toBe('user-1');
    expect(isdk._calls.updateProfile[0].metadata.xololoActivity.seenCount).toBe(1);
    expect(typeof isdk._calls.updateProfile[0].metadata.xololoActivity.lastSeenAt).toBe('string');
  });

  it('segundo bump dentro de la ventana devuelve false y NO llama API', async () => {
    const isdk = makeMockIsdk();
    expect(recordUserActivity({ isdk, userId: 'user-1' })).toBe(true);
    expect(recordUserActivity({ isdk, userId: 'user-1' })).toBe(false);
    await new Promise(r => setTimeout(r, 10));
    expect(isdk._calls.show).toHaveLength(1);
    expect(isdk._calls.updateProfile).toHaveLength(1);
  });

  it('user distinto no está deduped', async () => {
    const isdk = makeMockIsdk();
    expect(recordUserActivity({ isdk, userId: 'user-1' })).toBe(true);
    expect(recordUserActivity({ isdk, userId: 'user-2' })).toBe(true);
    await new Promise(r => setTimeout(r, 10));
    expect(isdk._calls.show).toHaveLength(2);
    expect(isdk._calls.updateProfile).toHaveLength(2);
  });

  it('seenCount se incrementa sobre el valor previo del metadata', async () => {
    const isdk = makeMockIsdk({
      initialMetadata: { xololoActivity: { seenCount: 42, lastSeenAt: '2026-01-01T00:00:00.000Z' } },
    });
    recordUserActivity({ isdk, userId: 'user-1' });
    await new Promise(r => setTimeout(r, 10));
    expect(isdk._calls.updateProfile[0].metadata.xololoActivity.seenCount).toBe(43);
  });

  it('un error en Integration API no explota el caller y no corrompe la cache', async () => {
    const isdk = {
      users: {
        show: jest.fn(() => Promise.reject(new Error('API down'))),
        updateProfile: jest.fn(),
      },
    };
    const triggered = recordUserActivity({ isdk, userId: 'user-1' });
    expect(triggered).toBe(true);
    await new Promise(r => setTimeout(r, 10));
    // Cache conservó el bump → siguientes calls dentro de 60s dedupe.
    expect(recordUserActivity({ isdk, userId: 'user-1' })).toBe(false);
  });

  it('DEDUPE_WINDOW_MS es 60s', () => {
    expect(DEDUPE_WINDOW_MS).toBe(60_000);
  });
});
