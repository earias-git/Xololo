// XOLOLO Tier Empresarial · E1 — taxonomía de permisos y roles.
//
// Esta es la fuente única de verdad para:
//   - qué permisos atómicos existen,
//   - qué permisos trae cada rol preset,
//   - cómo decidir si un workspace tiene un permiso dado.
//
// Un workspace es la relación `publicData.xololoWorkspaces[i]` del
// colaborador — su "membresía" en la tienda de un admin. Shape:
//   {
//     sellerId, sellerDisplayName, sellerSlug,
//     roleName, permissions: string[],
//     status: 'invited'|'active'|'paused',
//     addedAt
//   }
//
// Admin ≠ workspace: el admin es el user "dueño" de la tienda. Para
// detectar admin, nos basamos en sellerId === user.id. Un admin tiene
// implícitamente todos los permisos — no se guardan en workspaces (el
// admin no es colaborador de sí mismo).
//
// Reglas de diseño:
//   - PERMISSIONS es cerrado. Agregar un permiso nuevo requiere también
//     agregar enforcement en el endpoint que lo consume. Nada de permisos
//     "comodín".
//   - ROLE_PRESETS son azúcar UX. El shape persistido es siempre
//     permissions: string[] para que el enforcement no tenga que
//     resolver nombres de rol en tiempo de runtime (más auditable).

// ============================================================
// Permisos atómicos
// ============================================================

export const PERMISSIONS = {
  LISTINGS_CREATE: 'listings.create',
  LISTINGS_EDIT: 'listings.edit',
  LISTINGS_DELETE: 'listings.delete',
  PROMOTE: 'promote',
  SHIPPING: 'shipping',
  ORDERS_VIEW: 'orders.view',
  ORDERS_MANAGE: 'orders.manage',
  FINANCE: 'finance',
  STORE_SETTINGS: 'store.settings',
  TEAM: 'team',
};

export const ALL_PERMISSIONS = Object.values(PERMISSIONS);

// Metadata para UI (etiquetas en es-MX + nivel de riesgo).
export const PERMISSION_META = {
  [PERMISSIONS.LISTINGS_CREATE]: {
    label: 'Publicar productos',
    hint: 'Crear listings nuevos (fotos, precio, categoría)',
    risk: 'medium',
  },
  [PERMISSIONS.LISTINGS_EDIT]: {
    label: 'Editar productos',
    hint: 'Modificar precio, fotos, stock de listings existentes',
    risk: 'medium-high',
  },
  [PERMISSIONS.LISTINGS_DELETE]: {
    label: 'Dar de baja productos',
    hint: 'Cerrar o eliminar listings',
    risk: 'high',
  },
  [PERMISSIONS.PROMOTE]: {
    label: 'Promoción y social',
    hint: 'Xololear, QR, link profesional, descuentos, bio',
    risk: 'low',
  },
  [PERMISSIONS.SHIPPING]: {
    label: 'Paquetería',
    hint: 'Generar guías, fotos SOS, recolección',
    risk: 'medium',
  },
  [PERMISSIONS.ORDERS_VIEW]: {
    label: 'Ver órdenes',
    hint: 'Consultar órdenes y sus detalles (buyer, monto, estado)',
    risk: 'low',
  },
  [PERMISSIONS.ORDERS_MANAGE]: {
    label: 'Gestionar órdenes',
    hint: 'Confirmar, cancelar, mensajear al buyer, agendar entregas',
    risk: 'medium-high',
  },
  [PERMISSIONS.FINANCE]: {
    label: 'Finanzas',
    hint: 'Ver cobros, payouts, Stripe balance, descargar CFDI',
    risk: 'high',
  },
  [PERMISSIONS.STORE_SETTINGS]: {
    label: 'Configuración de tienda',
    hint: 'Nombre, logo, direcciones, horarios, categorías',
    risk: 'high',
  },
  [PERMISSIONS.TEAM]: {
    label: 'Gestión de equipo',
    hint: 'Invitar/remover colaboradores, cambiar permisos',
    risk: 'high',
  },
};

// ============================================================
// Roles preset
// ============================================================

export const ROLES = {
  ADMIN: 'admin',
  MANAGER: 'manager',
  CATALOG: 'catalog',
  LOGISTICS: 'logistics',
  FINANCE: 'finance',
  CUSTOM: 'custom',
};

// ADMIN es un rol implícito del dueño — no se persiste como colaborador.
// Su definición vive aquí solo para que la UI pueda mostrarlo como "todos
// los permisos" en el drawer de equipo.
export const ROLE_PRESETS = {
  [ROLES.ADMIN]: {
    label: 'Admin (dueño)',
    hint: 'Acceso completo. No se puede cambiar — es el titular de la cuenta.',
    permissions: ALL_PERMISSIONS,
    editable: false,
  },
  [ROLES.MANAGER]: {
    label: 'Manager',
    hint: 'Opera todo salvo gestión de equipo y finanzas.',
    permissions: ALL_PERMISSIONS.filter(
      p => p !== PERMISSIONS.TEAM && p !== PERMISSIONS.FINANCE
    ),
    editable: true,
  },
  [ROLES.CATALOG]: {
    label: 'Catálogo / Vendedor',
    hint: 'Publicar y editar productos, promover la tienda, ver órdenes.',
    permissions: [
      PERMISSIONS.LISTINGS_CREATE,
      PERMISSIONS.LISTINGS_EDIT,
      PERMISSIONS.LISTINGS_DELETE,
      PERMISSIONS.PROMOTE,
      PERMISSIONS.ORDERS_VIEW,
    ],
    editable: true,
  },
  [ROLES.LOGISTICS]: {
    label: 'Logística',
    hint: 'Paquetería, generar guías, gestionar órdenes.',
    permissions: [
      PERMISSIONS.SHIPPING,
      PERMISSIONS.ORDERS_MANAGE,
      PERMISSIONS.ORDERS_VIEW,
    ],
    editable: true,
  },
  [ROLES.FINANCE]: {
    label: 'Finanzas',
    hint: 'Payouts, cobros y facturación. Lectura de órdenes.',
    permissions: [PERMISSIONS.FINANCE, PERMISSIONS.ORDERS_VIEW],
    editable: true,
  },
  [ROLES.CUSTOM]: {
    label: 'Custom',
    hint: 'Permisos personalizados elegidos uno por uno.',
    permissions: [], // se llenan desde el form
    editable: true,
  },
};

/**
 * Dado un roleName preset, devuelve los permisos que incluye. Para
 * 'custom' devuelve [] — el caller completa con los checkboxes.
 */
export const getPermissionsForRole = roleName => {
  const preset = ROLE_PRESETS[roleName];
  if (!preset) return [];
  return [...preset.permissions];
};

/**
 * Dado un set de permisos, infiere el rol que mejor matchea (por
 * igualdad exacta); si ninguno matchea, retorna 'custom'. Útil al
 * cargar un colaborador existente para pre-seleccionar el dropdown.
 */
export const inferRoleFromPermissions = permissions => {
  const sorted = [...(permissions || [])].sort();
  for (const [role, preset] of Object.entries(ROLE_PRESETS)) {
    if (role === ROLES.ADMIN || role === ROLES.CUSTOM) continue;
    const presetSorted = [...preset.permissions].sort();
    if (
      presetSorted.length === sorted.length &&
      presetSorted.every((p, i) => p === sorted[i])
    ) {
      return role;
    }
  }
  return ROLES.CUSTOM;
};

/**
 * Valida que todos los permisos dados existan en el taxonomy. Devuelve
 * los inválidos. Usado para rechazar invitaciones con permisos vacíos
 * o inventados por el cliente.
 */
export const validatePermissions = permissions => {
  if (!Array.isArray(permissions)) return { ok: false, invalid: [], reason: 'not_array' };
  const invalid = permissions.filter(p => !ALL_PERMISSIONS.includes(p));
  return { ok: invalid.length === 0, invalid };
};

// ============================================================
// Membership + permission checks
// ============================================================

/**
 * ¿El user es admin de la tienda cuyo sellerId se pasa? Admin = dueño =
 * user.id === sellerId. No hay otro admin posible (hasta transfer-admin
 * en v1 que literalmente mueve el dueño).
 */
export const isAdminOfSeller = (user, sellerId) => {
  if (!user || !sellerId) return false;
  const uid = user.id?.uuid || user.id;
  return uid === sellerId;
};

/**
 * Encuentra el workspace del user para una tienda dada. null si no es
 * colaborador. 'active' es el único status que habilita acciones.
 */
export const findWorkspace = (user, sellerId) => {
  const workspaces = user?.attributes?.profile?.publicData?.xololoWorkspaces?.workspaces;
  if (!Array.isArray(workspaces)) return null;
  return workspaces.find(w => w.sellerId === sellerId) || null;
};

/**
 * ¿El user puede ejecutar la acción `permissionKey` en la tienda dada?
 *
 * Reglas:
 *  1. Si es admin de esa tienda → true (todos los permisos).
 *  2. Si no hay workspace → false.
 *  3. Si status !== 'active' → false (invited/paused no actúan).
 *  4. Si el permiso no está en workspace.permissions → false.
 *
 * No consulta la red. Trabaja sobre el currentUser ya hidratado.
 */
export const canUserDoInSeller = (user, sellerId, permissionKey) => {
  if (!user || !sellerId || !permissionKey) return false;
  if (isAdminOfSeller(user, sellerId)) return true;
  const ws = findWorkspace(user, sellerId);
  if (!ws) return false;
  if (ws.status !== 'active') return false;
  return Array.isArray(ws.permissions) && ws.permissions.includes(permissionKey);
};

/**
 * ¿El user tiene algún workspace activo (más allá del propio)?
 * Útil para decidir si mostrar el WorkspaceSwitcher.
 */
export const hasAnyWorkspace = user => {
  const workspaces = user?.attributes?.profile?.publicData?.xololoWorkspaces?.workspaces;
  return Array.isArray(workspaces) && workspaces.some(w => w.status === 'active');
};

/**
 * Workspace activo actualmente (lo que el user eligió en el switcher).
 * null = modo propio. Si `currentWorkspace` apunta a un workspace que
 * dejó de estar activo (paused/removed), lo tratamos como null — el
 * ribbon no debe engañar.
 */
export const getCurrentWorkspace = user => {
  const data = user?.attributes?.profile?.publicData?.xololoWorkspaces;
  const current = data?.currentWorkspace;
  if (!current) return null;
  const ws = (data?.workspaces || []).find(w => w.sellerId === current);
  if (!ws || ws.status !== 'active') return null;
  return ws;
};

// Status de colaborador — fuente única.
export const COLLABORATOR_STATUS = {
  INVITED: 'invited',
  ACTIVE: 'active',
  PAUSED: 'paused',
  REMOVED: 'removed',
};

// Shape vacío de team metadata (admin perspective). Útil para seedear.
export const emptyTeamMetadata = () => ({
  collaborators: [],
  seats: { used: 0, included: 2, extraPaid: 0 },
  actions: [],
  updatedAt: null,
});

// Shape vacío de workspaces (collaborator perspective).
export const emptyWorkspacesPublicData = () => ({
  workspaces: [],
  currentWorkspace: null,
});
