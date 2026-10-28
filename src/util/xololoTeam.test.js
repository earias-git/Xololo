// XOLOLO Tier Empresarial · E1 — tests del taxonomy + checks puros.

import {
  PERMISSIONS,
  ALL_PERMISSIONS,
  ROLES,
  ROLE_PRESETS,
  COLLABORATOR_STATUS,
  getPermissionsForRole,
  inferRoleFromPermissions,
  validatePermissions,
  isAdminOfSeller,
  findWorkspace,
  canUserDoInSeller,
  hasAnyWorkspace,
  getCurrentWorkspace,
  emptyTeamMetadata,
  emptyWorkspacesPublicData,
} from './xololoTeam';

const makeUser = ({ id = 'user-1', workspaces = null } = {}) => ({
  id: { uuid: id },
  attributes: {
    profile: {
      publicData: workspaces ? { xololoWorkspaces: workspaces } : {},
    },
  },
});

const workspaceEntry = (sellerId, overrides = {}) => ({
  sellerId,
  sellerDisplayName: `Tienda ${sellerId}`,
  sellerSlug: `slug-${sellerId}`,
  roleName: ROLES.LOGISTICS,
  permissions: [PERMISSIONS.SHIPPING, PERMISSIONS.ORDERS_MANAGE, PERMISSIONS.ORDERS_VIEW],
  status: COLLABORATOR_STATUS.ACTIVE,
  addedAt: '2026-10-28T00:00:00.000Z',
  ...overrides,
});

describe('taxonomy integrity', () => {
  it('ALL_PERMISSIONS === Object.values(PERMISSIONS)', () => {
    expect(ALL_PERMISSIONS.sort()).toEqual(Object.values(PERMISSIONS).sort());
  });

  it('cada rol preset tiene permisos válidos (subset de ALL_PERMISSIONS)', () => {
    for (const [role, preset] of Object.entries(ROLE_PRESETS)) {
      for (const p of preset.permissions) {
        expect(ALL_PERMISSIONS).toContain(p);
      }
    }
  });

  it('ADMIN tiene todos los permisos y es NO editable', () => {
    expect(ROLE_PRESETS[ROLES.ADMIN].editable).toBe(false);
    expect([...ROLE_PRESETS[ROLES.ADMIN].permissions].sort()).toEqual(
      [...ALL_PERMISSIONS].sort()
    );
  });

  it('CUSTOM arranca con permisos vacíos', () => {
    expect(ROLE_PRESETS[ROLES.CUSTOM].permissions).toEqual([]);
  });

  it('MANAGER excluye team + finance', () => {
    const perms = ROLE_PRESETS[ROLES.MANAGER].permissions;
    expect(perms).not.toContain(PERMISSIONS.TEAM);
    expect(perms).not.toContain(PERMISSIONS.FINANCE);
    expect(perms).toContain(PERMISSIONS.LISTINGS_CREATE);
    expect(perms).toContain(PERMISSIONS.SHIPPING);
  });
});

describe('getPermissionsForRole', () => {
  it('devuelve una copia (no referencia)', () => {
    const p = getPermissionsForRole(ROLES.LOGISTICS);
    p.push('hack');
    expect(ROLE_PRESETS[ROLES.LOGISTICS].permissions).not.toContain('hack');
  });

  it('role inválido → []', () => {
    expect(getPermissionsForRole('nope')).toEqual([]);
  });
});

describe('inferRoleFromPermissions', () => {
  it('matchea preset exacto', () => {
    expect(inferRoleFromPermissions(ROLE_PRESETS[ROLES.LOGISTICS].permissions)).toBe(
      ROLES.LOGISTICS
    );
    expect(inferRoleFromPermissions(ROLE_PRESETS[ROLES.FINANCE].permissions)).toBe(
      ROLES.FINANCE
    );
  });

  it('insensible al orden', () => {
    const reversed = [...ROLE_PRESETS[ROLES.CATALOG].permissions].reverse();
    expect(inferRoleFromPermissions(reversed)).toBe(ROLES.CATALOG);
  });

  it('subset o superset → custom', () => {
    const partial = [PERMISSIONS.SHIPPING];
    expect(inferRoleFromPermissions(partial)).toBe(ROLES.CUSTOM);
    const superset = [...ROLE_PRESETS[ROLES.LOGISTICS].permissions, PERMISSIONS.FINANCE];
    expect(inferRoleFromPermissions(superset)).toBe(ROLES.CUSTOM);
  });
});

describe('validatePermissions', () => {
  it('no array → not_array', () => {
    expect(validatePermissions(null).ok).toBe(false);
    expect(validatePermissions('nope').ok).toBe(false);
  });
  it('todos válidos → ok', () => {
    expect(validatePermissions([PERMISSIONS.PROMOTE])).toEqual({ ok: true, invalid: [] });
  });
  it('detecta inválidos', () => {
    const r = validatePermissions([PERMISSIONS.PROMOTE, 'inventado']);
    expect(r.ok).toBe(false);
    expect(r.invalid).toEqual(['inventado']);
  });
  it('array vacío → ok (opción válida: colaborador sin permisos)', () => {
    // Aunque un colaborador sin permisos no sea útil, no es inválido
    // por sí mismo — la UI puede impedirlo pero el taxonomy lo acepta.
    expect(validatePermissions([])).toEqual({ ok: true, invalid: [] });
  });
});

describe('isAdminOfSeller', () => {
  it('user.id === sellerId → true', () => {
    expect(isAdminOfSeller(makeUser({ id: 'abc' }), 'abc')).toBe(true);
  });
  it('user.id !== sellerId → false', () => {
    expect(isAdminOfSeller(makeUser({ id: 'abc' }), 'other')).toBe(false);
  });
  it('args faltantes → false', () => {
    expect(isAdminOfSeller(null, 'x')).toBe(false);
    expect(isAdminOfSeller(makeUser(), null)).toBe(false);
  });
});

describe('findWorkspace', () => {
  it('user sin workspaces → null', () => {
    expect(findWorkspace(makeUser(), 'any')).toBe(null);
  });
  it('matchea por sellerId', () => {
    const user = makeUser({
      workspaces: { workspaces: [workspaceEntry('shop-a'), workspaceEntry('shop-b')] },
    });
    expect(findWorkspace(user, 'shop-b').sellerId).toBe('shop-b');
    expect(findWorkspace(user, 'shop-c')).toBe(null);
  });
});

describe('canUserDoInSeller', () => {
  it('admin del seller → true para cualquier permiso', () => {
    const u = makeUser({ id: 'admin-1' });
    for (const p of ALL_PERMISSIONS) {
      expect(canUserDoInSeller(u, 'admin-1', p)).toBe(true);
    }
  });

  it('colaborador activo con el permiso → true', () => {
    const u = makeUser({
      id: 'collab-1',
      workspaces: {
        workspaces: [workspaceEntry('shop-a')],
      },
    });
    expect(canUserDoInSeller(u, 'shop-a', PERMISSIONS.SHIPPING)).toBe(true);
  });

  it('colaborador activo SIN el permiso → false', () => {
    const u = makeUser({
      id: 'collab-1',
      workspaces: { workspaces: [workspaceEntry('shop-a')] },
    });
    expect(canUserDoInSeller(u, 'shop-a', PERMISSIONS.FINANCE)).toBe(false);
  });

  it('colaborador paused → false aunque tenga el permiso', () => {
    const u = makeUser({
      id: 'collab-1',
      workspaces: {
        workspaces: [workspaceEntry('shop-a', { status: COLLABORATOR_STATUS.PAUSED })],
      },
    });
    expect(canUserDoInSeller(u, 'shop-a', PERMISSIONS.SHIPPING)).toBe(false);
  });

  it('colaborador invited (aún no aceptó) → false', () => {
    const u = makeUser({
      id: 'collab-1',
      workspaces: {
        workspaces: [workspaceEntry('shop-a', { status: COLLABORATOR_STATUS.INVITED })],
      },
    });
    expect(canUserDoInSeller(u, 'shop-a', PERMISSIONS.SHIPPING)).toBe(false);
  });

  it('no es admin ni colaborador → false', () => {
    const u = makeUser({ id: 'stranger' });
    expect(canUserDoInSeller(u, 'shop-a', PERMISSIONS.SHIPPING)).toBe(false);
  });
});

describe('hasAnyWorkspace / getCurrentWorkspace', () => {
  it('hasAnyWorkspace false sin workspaces activos', () => {
    expect(hasAnyWorkspace(makeUser())).toBe(false);
    const paused = makeUser({
      workspaces: {
        workspaces: [workspaceEntry('x', { status: COLLABORATOR_STATUS.PAUSED })],
      },
    });
    expect(hasAnyWorkspace(paused)).toBe(false);
  });
  it('hasAnyWorkspace true con al menos uno active', () => {
    const u = makeUser({
      workspaces: { workspaces: [workspaceEntry('x')] },
    });
    expect(hasAnyWorkspace(u)).toBe(true);
  });

  it('getCurrentWorkspace null si currentWorkspace es null', () => {
    const u = makeUser({
      workspaces: { workspaces: [workspaceEntry('x')], currentWorkspace: null },
    });
    expect(getCurrentWorkspace(u)).toBe(null);
  });

  it('getCurrentWorkspace devuelve el workspace apuntado', () => {
    const u = makeUser({
      workspaces: {
        workspaces: [workspaceEntry('x')],
        currentWorkspace: 'x',
      },
    });
    expect(getCurrentWorkspace(u).sellerId).toBe('x');
  });

  it('getCurrentWorkspace null si el workspace apuntado está paused', () => {
    const u = makeUser({
      workspaces: {
        workspaces: [workspaceEntry('x', { status: COLLABORATOR_STATUS.PAUSED })],
        currentWorkspace: 'x',
      },
    });
    expect(getCurrentWorkspace(u)).toBe(null);
  });
});

describe('empty shapes', () => {
  it('emptyTeamMetadata tiene seats.included=2', () => {
    expect(emptyTeamMetadata().seats.included).toBe(2);
  });
  it('emptyWorkspacesPublicData', () => {
    expect(emptyWorkspacesPublicData()).toEqual({ workspaces: [], currentWorkspace: null });
  });
});
