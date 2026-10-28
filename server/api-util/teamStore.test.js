// XOLOLO Tier Empresarial · E1 — tests del teamStore server-side.

const {
  STATUS,
  readTeam,
  readWorkspaces,
  recomputeSeats,
  addInvite,
  acceptInvite,
  updatePermissions,
  pauseCollaborator,
  resumeCollaborator,
  removeCollaborator,
  switchWorkspace,
  recordTeamAction,
  emptyTeamMetadata,
  emptyWorkspacesPublicData,
  PERMISSIONS,
  ALL_PERMISSIONS,
  ROLES,
  ROLE_PRESETS,
} = require('./teamStore');

// ============================================================
// Mock Integration SDK con dos "users" en memoria
// ============================================================

const makeMockIsdk = (initial = {}) => {
  // initial: { [userId]: { attributes: { email, profile: { displayName, publicData, metadata } } } }
  const store = { ...initial };
  return {
    _store: store,
    users: {
      show: jest.fn(({ id }) => {
        const u = store[id];
        if (!u) return Promise.resolve({ data: { data: null } });
        return Promise.resolve({ data: { data: { id: { uuid: id }, ...u } } });
      }),
      updateProfile: jest.fn(({ id, publicData, metadata }) => {
        if (!store[id]) {
          store[id] = { attributes: { email: null, profile: { publicData: {}, metadata: {} } } };
        }
        const prof = store[id].attributes.profile;
        if (publicData) prof.publicData = { ...prof.publicData, ...publicData };
        if (metadata) prof.metadata = { ...prof.metadata, ...metadata };
        return Promise.resolve({ data: {} });
      }),
    },
  };
};

const seedUser = (email, { displayName, slug } = {}) => ({
  attributes: {
    email,
    profile: {
      displayName: displayName || null,
      publicData: slug ? { slug } : {},
      metadata: {},
    },
  },
});

describe('taxonomy mirror (server vs src/util/xololoTeam)', () => {
  // Guardrails de drift. Si estos tests fallan es porque alguien tocó
  // uno de los dos stores (server/api-util/teamStore.js o
  // src/util/xololoTeam.js) sin tocar el otro.
  it('ALL_PERMISSIONS tiene exactamente 10 permisos y los esperados', () => {
    expect(ALL_PERMISSIONS.length).toBe(10);
    expect(ALL_PERMISSIONS).toEqual(
      expect.arrayContaining([
        'listings.create',
        'listings.edit',
        'listings.delete',
        'promote',
        'shipping',
        'orders.view',
        'orders.manage',
        'finance',
        'store.settings',
        'team',
      ])
    );
  });

  it('ROLE_PRESETS.admin es NO editable con todos los permisos', () => {
    expect(ROLE_PRESETS[ROLES.ADMIN].editable).toBe(false);
    expect([...ROLE_PRESETS[ROLES.ADMIN].permissions].sort()).toEqual(
      [...ALL_PERMISSIONS].sort()
    );
  });

  it('MANAGER excluye team y finance', () => {
    const perms = ROLE_PRESETS[ROLES.MANAGER].permissions;
    expect(perms).not.toContain(PERMISSIONS.TEAM);
    expect(perms).not.toContain(PERMISSIONS.FINANCE);
  });
});

describe('readTeam / readWorkspaces defaults', () => {
  it('readTeam con user vacío → emptyTeamMetadata', () => {
    expect(readTeam({})).toEqual(emptyTeamMetadata());
  });
  it('readWorkspaces con user vacío → emptyWorkspacesPublicData', () => {
    expect(readWorkspaces({})).toEqual(emptyWorkspacesPublicData());
  });
});

describe('recomputeSeats', () => {
  it('cuenta invited + active + paused, ignora removed', () => {
    const seats = { included: 2, extraPaid: 0 };
    const list = [
      { status: STATUS.INVITED },
      { status: STATUS.ACTIVE },
      { status: STATUS.PAUSED },
      { status: STATUS.REMOVED },
    ];
    expect(recomputeSeats(list, seats).used).toBe(3);
  });
});

// ============================================================
// Flujo completo invite → accept → update → pause → remove
// ============================================================

describe('addInvite + acceptInvite + lifecycle', () => {
  const adminId = 'admin-1';
  const collabId = 'collab-1';

  const seedBoth = () =>
    makeMockIsdk({
      [adminId]: seedUser('admin@xo.mx', { displayName: 'Mi Tienda SA', slug: 'mi-tienda' }),
      [collabId]: seedUser('logistica@xo.mx'),
    });

  it('addInvite crea entry invited en admin y workspace invited en colaborador', async () => {
    const isdk = seedBoth();
    await addInvite({
      isdk,
      adminId,
      collaboratorId: collabId,
      collaboratorEmail: 'logistica@xo.mx',
      roleName: 'logistics',
      permissions: ['shipping', 'orders.view'],
    });
    const adminTeam = readTeam({
      attributes: { profile: isdk._store[adminId].attributes.profile },
    });
    expect(adminTeam.collaborators).toHaveLength(1);
    expect(adminTeam.collaborators[0].status).toBe(STATUS.INVITED);
    expect(adminTeam.seats.used).toBe(1);

    const collabWs = readWorkspaces({
      attributes: { profile: isdk._store[collabId].attributes.profile },
    });
    expect(collabWs.workspaces).toHaveLength(1);
    expect(collabWs.workspaces[0].sellerId).toBe(adminId);
    expect(collabWs.workspaces[0].sellerDisplayName).toBe('Mi Tienda SA');
    expect(collabWs.workspaces[0].status).toBe(STATUS.INVITED);
  });

  it('addInvite rechaza duplicado', async () => {
    const isdk = seedBoth();
    await addInvite({
      isdk,
      adminId,
      collaboratorId: collabId,
      collaboratorEmail: 'logistica@xo.mx',
      roleName: 'logistics',
      permissions: ['shipping'],
    });
    await expect(
      addInvite({
        isdk,
        adminId,
        collaboratorId: collabId,
        collaboratorEmail: 'logistica@xo.mx',
        roleName: 'logistics',
        permissions: ['shipping'],
      })
    ).rejects.toThrow('collaborator_already_exists');
  });

  it('acceptInvite flipa a active en ambos', async () => {
    const isdk = seedBoth();
    await addInvite({
      isdk,
      adminId,
      collaboratorId: collabId,
      collaboratorEmail: 'logistica@xo.mx',
      roleName: 'logistics',
      permissions: ['shipping'],
    });
    const accepted = await acceptInvite({ isdk, adminId, collaboratorId: collabId });
    expect(accepted.status).toBe(STATUS.ACTIVE);
    expect(accepted.acceptedAt).toBeTruthy();

    const collabWs = isdk._store[collabId].attributes.profile.publicData.xololoWorkspaces;
    expect(collabWs.workspaces[0].status).toBe(STATUS.ACTIVE);
  });

  it('acceptInvite idempotente — segundo call no cambia nada', async () => {
    const isdk = seedBoth();
    await addInvite({
      isdk,
      adminId,
      collaboratorId: collabId,
      collaboratorEmail: 'x@x.mx',
      roleName: 'logistics',
      permissions: ['shipping'],
    });
    const first = await acceptInvite({ isdk, adminId, collaboratorId: collabId });
    const second = await acceptInvite({ isdk, adminId, collaboratorId: collabId });
    expect(second.acceptedAt).toBe(first.acceptedAt);
  });

  it('acceptInvite falla si no hay invite', async () => {
    const isdk = seedBoth();
    await expect(
      acceptInvite({ isdk, adminId, collaboratorId: collabId })
    ).rejects.toThrow('invite_not_found');
  });

  it('updatePermissions escribe el nuevo set en ambos', async () => {
    const isdk = seedBoth();
    await addInvite({
      isdk,
      adminId,
      collaboratorId: collabId,
      collaboratorEmail: 'x@x.mx',
      roleName: 'logistics',
      permissions: ['shipping'],
    });
    await updatePermissions({
      isdk,
      adminId,
      collaboratorId: collabId,
      roleName: 'manager',
      permissions: ['shipping', 'listings.create'],
    });
    const team = isdk._store[adminId].attributes.profile.metadata.xololoTeam;
    expect(team.collaborators[0].roleName).toBe('manager');
    expect(team.collaborators[0].permissions).toEqual(['shipping', 'listings.create']);
    const ws = isdk._store[collabId].attributes.profile.publicData.xololoWorkspaces.workspaces[0];
    expect(ws.permissions).toEqual(['shipping', 'listings.create']);
  });

  it('pauseCollaborator conserva el seat y limpia currentWorkspace si estaba apuntando ahí', async () => {
    const isdk = seedBoth();
    await addInvite({
      isdk,
      adminId,
      collaboratorId: collabId,
      collaboratorEmail: 'x@x.mx',
      roleName: 'logistics',
      permissions: ['shipping'],
    });
    await acceptInvite({ isdk, adminId, collaboratorId: collabId });
    await switchWorkspace({ isdk, collaboratorId: collabId, sellerId: adminId });
    expect(isdk._store[collabId].attributes.profile.publicData.xololoWorkspaces.currentWorkspace).toBe(adminId);

    await pauseCollaborator({ isdk, adminId, collaboratorId: collabId });
    const team = isdk._store[adminId].attributes.profile.metadata.xololoTeam;
    expect(team.collaborators[0].status).toBe(STATUS.PAUSED);
    expect(team.seats.used).toBe(1); // sigue contando

    const ws = isdk._store[collabId].attributes.profile.publicData.xololoWorkspaces;
    expect(ws.workspaces[0].status).toBe(STATUS.PAUSED);
    expect(ws.currentWorkspace).toBe(null); // limpio
  });

  it('resumeCollaborator vuelve a active', async () => {
    const isdk = seedBoth();
    await addInvite({
      isdk,
      adminId,
      collaboratorId: collabId,
      collaboratorEmail: 'x@x.mx',
      roleName: 'logistics',
      permissions: ['shipping'],
    });
    await acceptInvite({ isdk, adminId, collaboratorId: collabId });
    await pauseCollaborator({ isdk, adminId, collaboratorId: collabId });
    const resumed = await resumeCollaborator({ isdk, adminId, collaboratorId: collabId });
    expect(resumed.status).toBe(STATUS.ACTIVE);
    expect(resumed.pausedAt).toBe(null);
  });

  it('removeCollaborator saca el workspace del colaborador y reduce seats', async () => {
    const isdk = seedBoth();
    await addInvite({
      isdk,
      adminId,
      collaboratorId: collabId,
      collaboratorEmail: 'x@x.mx',
      roleName: 'logistics',
      permissions: ['shipping'],
    });
    await acceptInvite({ isdk, adminId, collaboratorId: collabId });
    await removeCollaborator({ isdk, adminId, collaboratorId: collabId });

    const team = isdk._store[adminId].attributes.profile.metadata.xololoTeam;
    expect(team.collaborators[0].status).toBe(STATUS.REMOVED);
    expect(team.seats.used).toBe(0);

    const ws = isdk._store[collabId].attributes.profile.publicData.xololoWorkspaces;
    expect(ws.workspaces).toHaveLength(0);
  });
});

describe('switchWorkspace', () => {
  const adminId = 'admin-1';
  const collabId = 'collab-1';
  const seedBoth = () =>
    makeMockIsdk({
      [adminId]: seedUser('admin@x.mx'),
      [collabId]: seedUser('c@x.mx'),
    });

  it('switch a sellerId activo → setea currentWorkspace', async () => {
    const isdk = seedBoth();
    await addInvite({
      isdk,
      adminId,
      collaboratorId: collabId,
      collaboratorEmail: 'c@x.mx',
      roleName: 'logistics',
      permissions: ['shipping'],
    });
    await acceptInvite({ isdk, adminId, collaboratorId: collabId });
    const r = await switchWorkspace({ isdk, collaboratorId: collabId, sellerId: adminId });
    expect(r.currentWorkspace).toBe(adminId);
  });

  it('switch a null → modo propio', async () => {
    const isdk = seedBoth();
    await addInvite({
      isdk,
      adminId,
      collaboratorId: collabId,
      collaboratorEmail: 'c@x.mx',
      roleName: 'logistics',
      permissions: ['shipping'],
    });
    await acceptInvite({ isdk, adminId, collaboratorId: collabId });
    await switchWorkspace({ isdk, collaboratorId: collabId, sellerId: adminId });
    const r = await switchWorkspace({ isdk, collaboratorId: collabId, sellerId: null });
    expect(r.currentWorkspace).toBe(null);
  });

  it('switch a sellerId no existente → workspace_not_found', async () => {
    const isdk = seedBoth();
    await expect(
      switchWorkspace({ isdk, collaboratorId: collabId, sellerId: 'otro' })
    ).rejects.toThrow('workspace_not_found');
  });

  it('switch a workspace invited (no active) → workspace_not_active', async () => {
    const isdk = seedBoth();
    await addInvite({
      isdk,
      adminId,
      collaboratorId: collabId,
      collaboratorEmail: 'c@x.mx',
      roleName: 'logistics',
      permissions: ['shipping'],
    });
    await expect(
      switchWorkspace({ isdk, collaboratorId: collabId, sellerId: adminId })
    ).rejects.toThrow('workspace_not_active');
  });
});

describe('recordTeamAction', () => {
  it('append al inicio y nunca lanza', async () => {
    const isdk = makeMockIsdk({
      'admin-1': seedUser('a@x.mx'),
    });
    const ok = await recordTeamAction({
      isdk,
      adminId: 'admin-1',
      actor: { userId: 'c-1', email: 'c@x.mx' },
      action: 'listing.create',
      target: { listingId: 'l-1' },
    });
    expect(ok).toBe(true);
    const actions = isdk._store['admin-1'].attributes.profile.metadata.xololoTeam.actions;
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('listing.create');
    expect(actions[0].actor.email).toBe('c@x.mx');
  });

  it('error en API no explota', async () => {
    const brokenIsdk = {
      users: {
        show: () => Promise.reject(new Error('down')),
        updateProfile: jest.fn(),
      },
    };
    const ok = await recordTeamAction({
      isdk: brokenIsdk,
      adminId: 'x',
      actor: {},
      action: 'test',
    });
    expect(ok).toBe(false);
  });
});
