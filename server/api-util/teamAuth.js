// XOLOLO Tier Empresarial · E1 — middleware de enforcement de permisos.
//
// Uso:
//   const { requirePermission } = require('../api-util/teamAuth');
//   router.post('/team/as/listing/create',
//     requirePermission('listings.create'),
//     handler);
//
// Flujo:
//   1. Lee currentUser con el SDK normal (sdk.currentUser.show).
//   2. Lee targetSellerId del body (preferido) o params.
//   3. Si currentUser.id === targetSellerId → admin, pasa (todos
//      los permisos implícitos).
//   4. Si no, busca workspace activo en
//      currentUser.publicData.xololoWorkspaces.workspaces matcheando
//      sellerId + status==='active' y permiso en permissions[].
//   5. Si pasa, adjunta req.actingAs = { adminId, actorUserId, workspace }
//      y continúa. Si no, 403.
//
// Nunca llama Integration SDK — todo lo que necesita está en publicData
// (visible al SDK normal gracias a la simetría del teamStore).
//
// Para la auditoría del team action, los handlers deben llamar
// teamStore.recordTeamAction al final del flow — este middleware NO
// audita por sí mismo (no sabe si la acción tuvo éxito).

const { getSdk } = require('./sdk');

const WORKSPACE_HEADER = 'x-xololo-acting-as';

const findActiveWorkspace = (currentUser, sellerId) => {
  const workspaces = currentUser?.attributes?.profile?.publicData?.xololoWorkspaces?.workspaces;
  if (!Array.isArray(workspaces)) return null;
  const ws = workspaces.find(w => w.sellerId === sellerId);
  if (!ws) return null;
  if (ws.status !== 'active') return null;
  return ws;
};

/**
 * Resuelve el `targetSellerId` desde la request:
 *   1. body.targetSellerId (JSON POST).
 *   2. query.targetSellerId (GET).
 *   3. header `x-xololo-acting-as` (fallback para interceptores client).
 *   4. publicData.xololoWorkspaces.currentWorkspace (si el user eligió
 *      un workspace activo, lo asumimos como target). Esto permite que
 *      la UI no tenga que pasar el targetSellerId en cada payload.
 */
const resolveTargetSellerId = (req, currentUser) => {
  const fromBody = req.body?.targetSellerId;
  if (fromBody) return String(fromBody);
  const fromQuery = req.query?.targetSellerId;
  if (fromQuery) return String(fromQuery);
  const fromHeader = req.headers?.[WORKSPACE_HEADER];
  if (fromHeader) return String(fromHeader);
  const current = currentUser?.attributes?.profile?.publicData?.xololoWorkspaces?.currentWorkspace;
  if (current) return String(current);
  return null;
};

/**
 * Middleware factory. permissionKey debe ser uno de los permisos
 * atómicos definidos en src/util/xololoTeam.js (no se valida aquí
 * contra el taxonomy — lo haría acoplado al ESM; el enforcement
 * efectivo es que el workspace lo tenga en permissions[]).
 */
const requirePermission = permissionKey => async (req, res, next) => {
  if (!permissionKey) {
    return res.status(500).json({ error: 'misconfigured_require_permission' });
  }
  const sdk = getSdk(req, res);
  let currentUser;
  try {
    const resp = await sdk.currentUser.show({
      'fields.user': ['profile.publicData'],
    });
    currentUser = resp.data.data;
  } catch (_e) {
    return res.status(401).json({ error: 'unauthenticated' });
  }
  if (!currentUser) return res.status(401).json({ error: 'unauthenticated' });

  const targetSellerId = resolveTargetSellerId(req, currentUser);
  if (!targetSellerId) {
    return res.status(400).json({ error: 'target_seller_required' });
  }
  const currentUserId = currentUser.id?.uuid;

  // Admin del seller target → pasa (permiso implícito total).
  if (currentUserId === targetSellerId) {
    req.actingAs = {
      adminId: targetSellerId,
      actorUserId: currentUserId,
      actorEmail: currentUser.attributes?.email || null,
      actorName: currentUser.attributes?.profile?.displayName || null,
      workspace: null, // admin no tiene workspace propio en SU tienda
      isAdmin: true,
    };
    return next();
  }

  // Colaborador — verificar workspace activo + permiso.
  const ws = findActiveWorkspace(currentUser, targetSellerId);
  if (!ws) {
    return res.status(403).json({ error: 'not_a_collaborator' });
  }
  if (!Array.isArray(ws.permissions) || !ws.permissions.includes(permissionKey)) {
    return res.status(403).json({ error: 'permission_denied', missing: permissionKey });
  }

  req.actingAs = {
    adminId: targetSellerId,
    actorUserId: currentUserId,
    actorEmail: currentUser.attributes?.email || null,
    actorName: currentUser.attributes?.profile?.displayName || null,
    workspace: ws,
    isAdmin: false,
  };
  return next();
};

/**
 * Igual que requirePermission, pero NO exige permiso específico —
 * solo que sea admin o un workspace active. Útil para endpoints
 * "cualquiera del equipo puede llamar esto" (ej. ver el dashboard,
 * leer la lista de órdenes read-only).
 */
const requireAnyWorkspace = async (req, res, next) => {
  const sdk = getSdk(req, res);
  let currentUser;
  try {
    const resp = await sdk.currentUser.show({
      'fields.user': ['profile.publicData'],
    });
    currentUser = resp.data.data;
  } catch (_e) {
    return res.status(401).json({ error: 'unauthenticated' });
  }
  if (!currentUser) return res.status(401).json({ error: 'unauthenticated' });
  const targetSellerId = resolveTargetSellerId(req, currentUser);
  if (!targetSellerId) return res.status(400).json({ error: 'target_seller_required' });
  const currentUserId = currentUser.id?.uuid;
  if (currentUserId === targetSellerId) {
    req.actingAs = {
      adminId: targetSellerId,
      actorUserId: currentUserId,
      actorEmail: currentUser.attributes?.email || null,
      actorName: currentUser.attributes?.profile?.displayName || null,
      workspace: null,
      isAdmin: true,
    };
    return next();
  }
  const ws = findActiveWorkspace(currentUser, targetSellerId);
  if (!ws) return res.status(403).json({ error: 'not_a_collaborator' });
  req.actingAs = {
    adminId: targetSellerId,
    actorUserId: currentUserId,
    actorEmail: currentUser.attributes?.email || null,
    actorName: currentUser.attributes?.profile?.displayName || null,
    workspace: ws,
    isAdmin: false,
  };
  return next();
};

module.exports = {
  requirePermission,
  requireAnyWorkspace,
  resolveTargetSellerId,
  findActiveWorkspace,
  WORKSPACE_HEADER,
};
