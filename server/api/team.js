// XOLOLO Tier Empresarial · E2 — endpoints de gestión del equipo.
//
// Rutas (todas montadas bajo /api/team/* en apiRouter):
//
//   POST /api/team/invite
//     Body: { targetSellerId, collaboratorEmail, roleName, permissions }
//     Gate: requirePermission('team') — admin solo (único con team).
//     200 → { collaborator, acceptUrl, email: { sent } }
//
//   POST /api/team/accept-invite
//     Body: { token }
//     Gate: sdk.currentUser.show (user autenticado — da igual quién).
//     200 → { workspace }
//     Validaciones: token válido, email del user coincide con el del token.
//
//   GET  /api/team/collaborators?targetSellerId=
//     Gate: requireAnyWorkspace — el propio admin o cualquier colaborador
//     active puede listar el equipo.
//     200 → { collaborators[] enriched (sin permissions.team si no es admin)}
//
//   POST /api/team/update-permissions
//     Body: { targetSellerId, collaboratorId, roleName, permissions }
//     Gate: requirePermission('team')
//     200 → { collaborator }
//
//   POST /api/team/pause   /resume   /remove
//     Body: { targetSellerId, collaboratorId }
//     Gate: requirePermission('team')
//     200 → { collaborator }
//
//   GET  /api/team/actions?targetSellerId=&limit=100
//     Gate: requirePermission('team') (admin audit).
//     200 → { actions[] }
//
//   POST /api/team/switch-workspace
//     Body: { sellerId: string|null }
//     Gate: usuario autenticado — endpoint lee el currentUser directamente.
//     Si sellerId=null → modo propio.
//     200 → { currentWorkspace }

const { getSdk } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const {
  readTeam,
  addInvite,
  acceptInvite,
  updatePermissions,
  pauseCollaborator,
  resumeCollaborator,
  removeCollaborator,
  switchWorkspace,
  recordTeamAction,
  ALL_PERMISSIONS,
  ROLES,
  ROLE_PRESETS,
  PERMISSIONS,
  getPermissionsForRole,
  validatePermissions,
} = require('../api-util/teamStore');
const {
  signInviteToken,
  verifyInviteToken,
} = require('../api-util/teamInviteToken');
const { sendTeamInviteEmail } = require('../api-util/teamInviteEmail');

const MARKETPLACE_ROOT_URL =
  process.env.REACT_APP_MARKETPLACE_ROOT_URL || 'https://xololo.mx';

// --------------- helpers ---------------

const sanitizeRoleAndPermissions = ({ roleName, permissions }) => {
  if (!Object.values(ROLES).includes(roleName)) {
    return { error: 'invalid_role' };
  }
  // Admin role solo lo tiene el dueño implícitamente — no se puede
  // asignar como colaborador.
  if (roleName === ROLES.ADMIN) {
    return { error: 'cannot_assign_admin_role' };
  }
  // Para presets no-custom, los permisos deben coincidir con el preset.
  // Para custom, aceptamos el array del body validado contra taxonomy.
  let finalPermissions;
  if (roleName === ROLES.CUSTOM) {
    const v = validatePermissions(permissions);
    if (!v.ok) return { error: 'invalid_permissions', invalid: v.invalid };
    finalPermissions = [...permissions];
  } else {
    finalPermissions = getPermissionsForRole(roleName);
  }
  // No importa qué rol — un colaborador NO puede tener el permiso team.
  // El admin es el único con `team`. Si viene en custom, lo quitamos.
  finalPermissions = finalPermissions.filter(p => p !== PERMISSIONS.TEAM);
  return { permissions: finalPermissions };
};

const buildAcceptUrl = token =>
  `${MARKETPLACE_ROOT_URL.replace(/\/$/, '')}/accept-invite?token=${encodeURIComponent(token)}`;

// Resuelve un userId por email usando el Integration SDK. Devuelve null
// si no existe. (Sharetribe no expone email→id en el SDK normal.)
const findUserIdByEmail = async (isdk, email) => {
  if (!isdk || !email) return null;
  try {
    const resp = await isdk.users.query({ email: String(email).trim() });
    const user = resp.data.data?.[0];
    return user?.id?.uuid || null;
  } catch (_e) {
    return null;
  }
};

// --------------- POST /invite ---------------

const invite = async (req, res) => {
  const { collaboratorEmail, roleName, permissions = [] } = req.body || {};
  if (!collaboratorEmail) {
    return res.status(400).json({ error: 'collaboratorEmail_required' });
  }
  const normalized = String(collaboratorEmail).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    return res.status(400).json({ error: 'invalid_email' });
  }
  const sanitized = sanitizeRoleAndPermissions({ roleName, permissions });
  if (sanitized.error) {
    return res.status(400).json({ error: sanitized.error, invalid: sanitized.invalid });
  }

  const adminId = req.actingAs.adminId;
  const adminEmail = req.actingAs.actorEmail;
  const adminName = req.actingAs.actorName;

  // El colaborador debe ser invitable: no puede ser el propio admin.
  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  const collaboratorId = await findUserIdByEmail(isdk, normalized);
  if (!collaboratorId) {
    // UX: devolvemos 404 explícito — el frontend indica "el colaborador
    // debe tener cuenta Xololo primero (puede registrarse y volver)".
    return res.status(404).json({ error: 'collaborator_not_registered' });
  }
  if (collaboratorId === adminId) {
    return res.status(400).json({ error: 'cannot_invite_self' });
  }

  // Añade al store (lanza si ya existe).
  let collaborator;
  try {
    collaborator = await addInvite({
      isdk,
      adminId,
      admin: { id: adminId, email: adminEmail, name: adminName },
      collaboratorId,
      collaboratorEmail: normalized,
      roleName,
      permissions: sanitized.permissions,
    });
  } catch (e) {
    if (e.message === 'collaborator_already_exists') {
      return res.status(409).json({ error: 'collaborator_already_exists' });
    }
    // eslint-disable-next-line no-console
    console.error('[team.invite] error:', e.message);
    return res.status(500).json({ error: 'internal' });
  }

  // Firma token + envía email.
  const token = signInviteToken({
    adminId,
    adminEmail,
    collaboratorEmail: normalized,
    roleName,
    permissions: sanitized.permissions,
  });
  const acceptUrl = buildAcceptUrl(token);
  const emailResult = await sendTeamInviteEmail({
    collaboratorEmail: normalized,
    adminDisplayName: adminName,
    adminEmail,
    roleName,
    permissionsCount: sanitized.permissions.length,
    acceptUrl,
  });

  recordTeamAction({
    isdk,
    adminId,
    actor: { userId: req.actingAs.actorUserId, email: adminEmail, name: adminName },
    action: 'team.invite',
    target: { collaboratorId, email: normalized, roleName },
  });

  return res.json({ collaborator, acceptUrl, email: emailResult });
};

// --------------- POST /accept-invite ---------------

const accept = async (req, res) => {
  const { token } = req.body || {};
  const check = verifyInviteToken(token);
  if (!check.ok) {
    return res.status(400).json({ error: check.error });
  }
  const { adminId, sub: tokenEmail } = check.payload;

  // Validar que el currentUser matchea el email del token.
  const sdk = getSdk(req, res);
  let currentUser;
  try {
    const resp = await sdk.currentUser.show();
    currentUser = resp.data.data;
  } catch (_e) {
    return res.status(401).json({ error: 'unauthenticated' });
  }
  if (!currentUser) return res.status(401).json({ error: 'unauthenticated' });
  const userEmail = String(currentUser.attributes?.email || '').toLowerCase();
  if (userEmail !== tokenEmail) {
    return res.status(403).json({ error: 'email_mismatch' });
  }
  const collaboratorId = currentUser.id?.uuid;

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  let collaborator;
  try {
    collaborator = await acceptInvite({ isdk, adminId, collaboratorId });
  } catch (e) {
    if (e.message === 'invite_not_found') return res.status(404).json({ error: 'invite_not_found' });
    if (e.message === 'invalid_state_for_accept') {
      return res.status(409).json({ error: 'already_accepted_or_revoked' });
    }
    // eslint-disable-next-line no-console
    console.error('[team.accept] error:', e.message);
    return res.status(500).json({ error: 'internal' });
  }

  recordTeamAction({
    isdk,
    adminId,
    actor: { userId: collaboratorId, email: userEmail },
    action: 'team.invite_accepted',
    target: { collaboratorId },
  });

  return res.json({ collaborator });
};

// --------------- GET /collaborators ---------------

const listCollaborators = async (req, res) => {
  const adminId = req.actingAs.adminId;
  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });
  try {
    const resp = await isdk.users.show({ id: adminId });
    const team = readTeam(resp.data.data);
    return res.json({
      collaborators: team.collaborators,
      seats: team.seats,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[team.list] error:', e.message);
    return res.status(500).json({ error: 'internal' });
  }
};

// --------------- POST /update-permissions ---------------

const updatePerms = async (req, res) => {
  const { collaboratorId, roleName, permissions = [] } = req.body || {};
  if (!collaboratorId) return res.status(400).json({ error: 'collaboratorId_required' });
  const sanitized = sanitizeRoleAndPermissions({ roleName, permissions });
  if (sanitized.error) {
    return res.status(400).json({ error: sanitized.error, invalid: sanitized.invalid });
  }
  const adminId = req.actingAs.adminId;
  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });
  try {
    const collaborator = await updatePermissions({
      isdk,
      adminId,
      collaboratorId,
      roleName,
      permissions: sanitized.permissions,
    });
    recordTeamAction({
      isdk,
      adminId,
      actor: {
        userId: req.actingAs.actorUserId,
        email: req.actingAs.actorEmail,
        name: req.actingAs.actorName,
      },
      action: 'team.permissions_updated',
      target: { collaboratorId, roleName },
    });
    return res.json({ collaborator });
  } catch (e) {
    if (e.message === 'collaborator_not_found') {
      return res.status(404).json({ error: 'collaborator_not_found' });
    }
    // eslint-disable-next-line no-console
    console.error('[team.updatePerms] error:', e.message);
    return res.status(500).json({ error: 'internal' });
  }
};

// --------------- POST /pause|resume|remove ---------------

const statusAction = (fn, actionName) => async (req, res) => {
  const { collaboratorId } = req.body || {};
  if (!collaboratorId) return res.status(400).json({ error: 'collaboratorId_required' });
  const adminId = req.actingAs.adminId;
  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });
  try {
    const collaborator = await fn({ isdk, adminId, collaboratorId });
    recordTeamAction({
      isdk,
      adminId,
      actor: {
        userId: req.actingAs.actorUserId,
        email: req.actingAs.actorEmail,
        name: req.actingAs.actorName,
      },
      action: `team.${actionName}`,
      target: { collaboratorId },
    });
    return res.json({ collaborator });
  } catch (e) {
    if (e.message === 'collaborator_not_found') {
      return res.status(404).json({ error: 'collaborator_not_found' });
    }
    // eslint-disable-next-line no-console
    console.error(`[team.${actionName}] error:`, e.message);
    return res.status(500).json({ error: 'internal' });
  }
};

const pause = statusAction(pauseCollaborator, 'pause');
const resume = statusAction(resumeCollaborator, 'resume');
const remove = statusAction(removeCollaborator, 'remove');

// --------------- GET /actions ---------------

const listActions = async (req, res) => {
  const adminId = req.actingAs.adminId;
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });
  try {
    const resp = await isdk.users.show({ id: adminId });
    const team = readTeam(resp.data.data);
    const actions = (team.actions || []).slice(0, limit);
    return res.json({ actions, total: team.actions?.length || 0 });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[team.listActions] error:', e.message);
    return res.status(500).json({ error: 'internal' });
  }
};

// --------------- POST /switch-workspace ---------------

const switchWs = async (req, res) => {
  const { sellerId } = req.body || {};
  // sellerId=null es válido (volver a modo propio).
  const sdk = getSdk(req, res);
  let currentUser;
  try {
    const resp = await sdk.currentUser.show();
    currentUser = resp.data.data;
  } catch (_e) {
    return res.status(401).json({ error: 'unauthenticated' });
  }
  if (!currentUser) return res.status(401).json({ error: 'unauthenticated' });
  const collaboratorId = currentUser.id?.uuid;

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    const r = await switchWorkspace({
      isdk,
      collaboratorId,
      sellerId: sellerId || null,
    });
    return res.json(r);
  } catch (e) {
    if (e.message === 'workspace_not_found') return res.status(404).json({ error: 'workspace_not_found' });
    if (e.message === 'workspace_not_active') return res.status(409).json({ error: 'workspace_not_active' });
    // eslint-disable-next-line no-console
    console.error('[team.switch] error:', e.message);
    return res.status(500).json({ error: 'internal' });
  }
};

// --------------- GET /meta ---------------

// Útil para que la UI pida el taxonomy (roles disponibles + permisos)
// sin tener que mantener dos copias en el bundle.
const meta = async (req, res) => {
  return res.json({
    permissions: ALL_PERMISSIONS,
    roles: Object.entries(ROLE_PRESETS).map(([key, preset]) => ({
      key,
      label: preset.label,
      hint: preset.hint,
      permissions: preset.permissions,
      editable: preset.editable,
    })),
  });
};

module.exports = {
  invite,
  accept,
  listCollaborators,
  updatePerms,
  pause,
  resume,
  remove,
  listActions,
  switchWs,
  meta,
};
