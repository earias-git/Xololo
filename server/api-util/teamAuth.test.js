// XOLOLO Tier Empresarial · E1 — tests del middleware requirePermission.
//
// Mockea getSdk para controlar lo que `sdk.currentUser.show()` devuelve
// y testear las ramas sin red real.

jest.mock('./sdk', () => ({
  getSdk: jest.fn(),
}));

const { getSdk } = require('./sdk');
const { requirePermission, requireAnyWorkspace, resolveTargetSellerId } = require('./teamAuth');

const mockSdkForUser = user => {
  getSdk.mockReturnValue({
    currentUser: {
      show: jest.fn(() => Promise.resolve({ data: { data: user } })),
    },
  });
};

const makeRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const makeReq = (over = {}) => ({
  body: over.body || {},
  query: over.query || {},
  params: over.params || {},
  headers: over.headers || {},
});

const makeUser = ({ id, workspaces = null, currentWorkspace = null, email = 'u@x.mx' } = {}) => ({
  id: { uuid: id },
  attributes: {
    email,
    profile: {
      publicData: workspaces
        ? { xololoWorkspaces: { workspaces, currentWorkspace } }
        : {},
    },
  },
});

describe('resolveTargetSellerId precedencia', () => {
  it('body > query > header > currentWorkspace', () => {
    const user = makeUser({ id: 'u', workspaces: [], currentWorkspace: 'from-current' });
    expect(resolveTargetSellerId({ body: { targetSellerId: 'from-body' } }, user)).toBe('from-body');
    expect(
      resolveTargetSellerId({ body: {}, query: { targetSellerId: 'from-query' } }, user)
    ).toBe('from-query');
    expect(
      resolveTargetSellerId(
        { body: {}, query: {}, headers: { 'x-xololo-acting-as': 'from-header' } },
        user
      )
    ).toBe('from-header');
    expect(
      resolveTargetSellerId({ body: {}, query: {}, headers: {} }, user)
    ).toBe('from-current');
  });

  it('sin ninguna fuente → null', () => {
    const user = makeUser({ id: 'u', workspaces: [] });
    expect(resolveTargetSellerId({ body: {}, query: {}, headers: {} }, user)).toBe(null);
  });
});

describe('requirePermission', () => {
  afterEach(() => jest.clearAllMocks());

  it('admin del seller target → pasa (permiso implícito total)', async () => {
    mockSdkForUser(makeUser({ id: 'admin-1' }));
    const req = makeReq({ body: { targetSellerId: 'admin-1' } });
    const res = makeRes();
    const next = jest.fn();
    await requirePermission('finance')(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.actingAs).toEqual(
      expect.objectContaining({ adminId: 'admin-1', isAdmin: true, workspace: null })
    );
  });

  it('colaborador activo con el permiso → pasa', async () => {
    mockSdkForUser(
      makeUser({
        id: 'collab-1',
        workspaces: [
          {
            sellerId: 'admin-1',
            status: 'active',
            permissions: ['shipping', 'orders.view'],
            roleName: 'logistics',
          },
        ],
      })
    );
    const req = makeReq({ body: { targetSellerId: 'admin-1' } });
    const res = makeRes();
    const next = jest.fn();
    await requirePermission('shipping')(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.actingAs.isAdmin).toBe(false);
    expect(req.actingAs.workspace.roleName).toBe('logistics');
  });

  it('colaborador activo SIN el permiso → 403 permission_denied', async () => {
    mockSdkForUser(
      makeUser({
        id: 'collab-1',
        workspaces: [{ sellerId: 'admin-1', status: 'active', permissions: ['shipping'] }],
      })
    );
    const req = makeReq({ body: { targetSellerId: 'admin-1' } });
    const res = makeRes();
    const next = jest.fn();
    await requirePermission('finance')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'permission_denied', missing: 'finance' })
    );
  });

  it('colaborador paused → 403 not_a_collaborator', async () => {
    mockSdkForUser(
      makeUser({
        id: 'collab-1',
        workspaces: [{ sellerId: 'admin-1', status: 'paused', permissions: ['shipping'] }],
      })
    );
    const req = makeReq({ body: { targetSellerId: 'admin-1' } });
    const res = makeRes();
    const next = jest.fn();
    await requirePermission('shipping')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'not_a_collaborator' })
    );
  });

  it('no es admin ni colaborador → 403', async () => {
    mockSdkForUser(makeUser({ id: 'stranger' }));
    const req = makeReq({ body: { targetSellerId: 'admin-1' } });
    const res = makeRes();
    const next = jest.fn();
    await requirePermission('shipping')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('sin targetSellerId → 400', async () => {
    mockSdkForUser(makeUser({ id: 'collab-1', workspaces: [] }));
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();
    await requirePermission('shipping')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'target_seller_required' });
  });

  it('sin currentUser.show (sesión caída) → 401', async () => {
    getSdk.mockReturnValue({
      currentUser: { show: () => Promise.reject(new Error('nope')) },
    });
    const req = makeReq({ body: { targetSellerId: 'admin-1' } });
    const res = makeRes();
    const next = jest.fn();
    await requirePermission('shipping')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('sin permissionKey (misconfig) → 500', async () => {
    const req = makeReq({ body: { targetSellerId: 'admin-1' } });
    const res = makeRes();
    const next = jest.fn();
    await requirePermission(null)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('currentWorkspace del user implica el target (sin body)', async () => {
    mockSdkForUser(
      makeUser({
        id: 'collab-1',
        workspaces: [{ sellerId: 'admin-1', status: 'active', permissions: ['shipping'] }],
        currentWorkspace: 'admin-1',
      })
    );
    const req = makeReq(); // sin body/query/header
    const res = makeRes();
    const next = jest.fn();
    await requirePermission('shipping')(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

describe('requireAnyWorkspace', () => {
  afterEach(() => jest.clearAllMocks());

  it('admin → pasa sin exigir permiso específico', async () => {
    mockSdkForUser(makeUser({ id: 'admin-1' }));
    const req = makeReq({ body: { targetSellerId: 'admin-1' } });
    const res = makeRes();
    const next = jest.fn();
    await requireAnyWorkspace(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('colaborador active con cualquier permission → pasa', async () => {
    mockSdkForUser(
      makeUser({
        id: 'collab-1',
        workspaces: [{ sellerId: 'admin-1', status: 'active', permissions: [] }],
      })
    );
    const req = makeReq({ body: { targetSellerId: 'admin-1' } });
    const res = makeRes();
    const next = jest.fn();
    await requireAnyWorkspace(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('stranger → 403', async () => {
    mockSdkForUser(makeUser({ id: 'stranger' }));
    const req = makeReq({ body: { targetSellerId: 'admin-1' } });
    const res = makeRes();
    const next = jest.fn();
    await requireAnyWorkspace(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
