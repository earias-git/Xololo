// XOLOLO Tier Empresarial · E1 — read/write simétrico del team store.
//
// La fuente de verdad server-side es:
//   admin.metadata.xololoTeam = { collaborators[], seats, actions }
//
// Se replica a:
//   collaborator.publicData.xololoWorkspaces = { workspaces[], currentWorkspace }
//
// Por qué doble:
//   - admin consulta su equipo sin recorrer N users.
//   - colaborador consulta sus workspaces sin requerir Integration SDK.
//
// Todas las mutaciones de este módulo tocan AMBOS stores en una
// secuencia definida (admin primero, colaborador después). Si el
// segundo write falla, dejamos un flag en logs — el reconciler diario
// (futuro cron) puede detectar inconsistencias.
//
// Taxonomy + validación de permisos vive en src/util/xololoTeam.js
// (ESM cliente). Aquí duplicamos la constante mínima (status enum y
// shape vacío) a propósito, igual que hicimos con xololoShippingMethods
// server mirror.

const { randomUUID } = require('crypto');

const STATUS = {
  INVITED: 'invited',
  ACTIVE: 'active',
  PAUSED: 'paused',
  REMOVED: 'removed',
};

const MAX_ACTIONS = 500;

const emptyTeamMetadata = () => ({
  collaborators: [],
  seats: { used: 0, included: 2, extraPaid: 0 },
  actions: [],
  updatedAt: null,
});

const emptyWorkspacesPublicData = () => ({
  workspaces: [],
  currentWorkspace: null,
});

const readTeam = user => {
  const md = user?.attributes?.profile?.metadata || {};
  return md.xololoTeam || emptyTeamMetadata();
};

const readWorkspaces = user => {
  const pd = user?.attributes?.profile?.publicData || {};
  return pd.xololoWorkspaces || emptyWorkspacesPublicData();
};

// Status "activo" para contar un seat (incluye invited — pagas seat
// desde que mandas la invitación para evitar gaming "invito y cancelo").
const countsAsSeat = status =>
  status === STATUS.INVITED || status === STATUS.ACTIVE || status === STATUS.PAUSED;

const recomputeSeats = (collaborators, seats) => {
  const used = collaborators.filter(c => countsAsSeat(c.status)).length;
  return { ...seats, used };
};

/**
 * Agrega un colaborador con status 'invited' al admin y crea el
 * workspace en status 'invited' en el collaborator. Idempotente por
 * email: si ya existe, lanza.
 */
const addInvite = async ({ isdk, adminId, admin, collaboratorId, collaboratorEmail, roleName, permissions, invitedByOperator }) => {
  if (!isdk) throw new Error('integration_api_missing');

  // 1. Leer admin + collaborator.
  const [adminResp, collabResp] = await Promise.all([
    isdk.users.show({ id: adminId }),
    isdk.users.show({ id: collaboratorId }),
  ]);
  const adminUser = adminResp.data.data;
  const collabUser = collabResp.data.data;
  const prevTeam = readTeam(adminUser);
  const prevWs = readWorkspaces(collabUser);

  if (prevTeam.collaborators.some(c => c.collaboratorId === collaboratorId && c.status !== STATUS.REMOVED)) {
    throw new Error('collaborator_already_exists');
  }

  const now = new Date().toISOString();
  const invitedBy = admin
    ? { userId: adminId, email: admin.email || adminUser.attributes?.email }
    : invitedByOperator
    ? { operatorId: invitedByOperator.id, email: invitedByOperator.email }
    : { userId: adminId };

  const nextCollaborator = {
    collaboratorId,
    email: collaboratorEmail,
    roleName,
    permissions: [...permissions],
    invitedBy,
    invitedAt: now,
    acceptedAt: null,
    status: STATUS.INVITED,
    pausedAt: null,
  };

  const nextCollaborators = [...prevTeam.collaborators, nextCollaborator];
  const nextSeats = recomputeSeats(nextCollaborators, prevTeam.seats);

  const sellerDisplayName = adminUser.attributes?.profile?.displayName || null;
  const sellerSlug = adminUser.attributes?.profile?.publicData?.slug || null;
  const nextWorkspace = {
    sellerId: adminId,
    sellerDisplayName,
    sellerSlug,
    roleName,
    permissions: [...permissions],
    status: STATUS.INVITED,
    addedAt: now,
  };
  // Si ya existía un workspace para este seller (ej. previamente removed),
  // lo reemplazamos. Si no, append.
  const prevWorkspaces = (prevWs.workspaces || []).filter(w => w.sellerId !== adminId);
  const nextWorkspaces = [...prevWorkspaces, nextWorkspace];

  // 2. Escribir admin primero.
  await isdk.users.updateProfile({
    id: adminId,
    metadata: {
      xololoTeam: {
        ...prevTeam,
        collaborators: nextCollaborators,
        seats: nextSeats,
        updatedAt: now,
      },
    },
  });

  // 3. Escribir colaborador después.
  await isdk.users.updateProfile({
    id: collaboratorId,
    publicData: {
      xololoWorkspaces: {
        ...prevWs,
        workspaces: nextWorkspaces,
      },
    },
  });

  return nextCollaborator;
};

/**
 * Marca un invite como aceptado (status: active). Idempotente — si ya
 * estaba 'active', es noop. Rechaza si no está 'invited'.
 */
const acceptInvite = async ({ isdk, adminId, collaboratorId }) => {
  if (!isdk) throw new Error('integration_api_missing');
  const [adminResp, collabResp] = await Promise.all([
    isdk.users.show({ id: adminId }),
    isdk.users.show({ id: collaboratorId }),
  ]);
  const prevTeam = readTeam(adminResp.data.data);
  const prevWs = readWorkspaces(collabResp.data.data);
  const target = prevTeam.collaborators.find(c => c.collaboratorId === collaboratorId);
  if (!target) throw new Error('invite_not_found');
  if (target.status === STATUS.ACTIVE) return target;
  if (target.status !== STATUS.INVITED) throw new Error('invalid_state_for_accept');

  const now = new Date().toISOString();
  const nextCollaborators = prevTeam.collaborators.map(c =>
    c.collaboratorId === collaboratorId ? { ...c, status: STATUS.ACTIVE, acceptedAt: now } : c
  );
  const nextWorkspaces = (prevWs.workspaces || []).map(w =>
    w.sellerId === adminId ? { ...w, status: STATUS.ACTIVE } : w
  );

  await isdk.users.updateProfile({
    id: adminId,
    metadata: {
      xololoTeam: {
        ...prevTeam,
        collaborators: nextCollaborators,
        updatedAt: now,
      },
    },
  });
  await isdk.users.updateProfile({
    id: collaboratorId,
    publicData: {
      xololoWorkspaces: { ...prevWs, workspaces: nextWorkspaces },
    },
  });
  return nextCollaborators.find(c => c.collaboratorId === collaboratorId);
};

/**
 * Actualiza role + permissions de un colaborador existente. No cambia
 * status — para pausar/remover, usar helpers específicos.
 */
const updatePermissions = async ({ isdk, adminId, collaboratorId, roleName, permissions }) => {
  if (!isdk) throw new Error('integration_api_missing');
  const [adminResp, collabResp] = await Promise.all([
    isdk.users.show({ id: adminId }),
    isdk.users.show({ id: collaboratorId }),
  ]);
  const prevTeam = readTeam(adminResp.data.data);
  const prevWs = readWorkspaces(collabResp.data.data);
  if (!prevTeam.collaborators.some(c => c.collaboratorId === collaboratorId)) {
    throw new Error('collaborator_not_found');
  }
  const now = new Date().toISOString();
  const nextCollaborators = prevTeam.collaborators.map(c =>
    c.collaboratorId === collaboratorId
      ? { ...c, roleName, permissions: [...permissions] }
      : c
  );
  const nextWorkspaces = (prevWs.workspaces || []).map(w =>
    w.sellerId === adminId ? { ...w, roleName, permissions: [...permissions] } : w
  );
  await isdk.users.updateProfile({
    id: adminId,
    metadata: { xololoTeam: { ...prevTeam, collaborators: nextCollaborators, updatedAt: now } },
  });
  await isdk.users.updateProfile({
    id: collaboratorId,
    publicData: { xololoWorkspaces: { ...prevWs, workspaces: nextWorkspaces } },
  });
  return nextCollaborators.find(c => c.collaboratorId === collaboratorId);
};

const setCollaboratorStatus = async ({ isdk, adminId, collaboratorId, nextStatus }) => {
  if (!isdk) throw new Error('integration_api_missing');
  if (!Object.values(STATUS).includes(nextStatus)) {
    throw new Error('invalid_status');
  }
  const [adminResp, collabResp] = await Promise.all([
    isdk.users.show({ id: adminId }),
    isdk.users.show({ id: collaboratorId }),
  ]);
  const prevTeam = readTeam(adminResp.data.data);
  const prevWs = readWorkspaces(collabResp.data.data);
  if (!prevTeam.collaborators.some(c => c.collaboratorId === collaboratorId)) {
    throw new Error('collaborator_not_found');
  }
  const now = new Date().toISOString();
  const nextCollaborators = prevTeam.collaborators.map(c => {
    if (c.collaboratorId !== collaboratorId) return c;
    const patch = { status: nextStatus };
    if (nextStatus === STATUS.PAUSED) patch.pausedAt = now;
    if (nextStatus === STATUS.ACTIVE) patch.pausedAt = null;
    return { ...c, ...patch };
  });
  const nextSeats = recomputeSeats(nextCollaborators, prevTeam.seats);
  // Si lo removemos, el workspace sale de la lista del colaborador.
  // Si pause → status refleja.
  const nextWorkspaces =
    nextStatus === STATUS.REMOVED
      ? (prevWs.workspaces || []).filter(w => w.sellerId !== adminId)
      : (prevWs.workspaces || []).map(w =>
          w.sellerId === adminId ? { ...w, status: nextStatus } : w
        );
  // Si estaba usando ese workspace activamente, limpiar currentWorkspace.
  const nextCurrent =
    prevWs.currentWorkspace === adminId && nextStatus !== STATUS.ACTIVE
      ? null
      : prevWs.currentWorkspace;

  await isdk.users.updateProfile({
    id: adminId,
    metadata: {
      xololoTeam: {
        ...prevTeam,
        collaborators: nextCollaborators,
        seats: nextSeats,
        updatedAt: now,
      },
    },
  });
  await isdk.users.updateProfile({
    id: collaboratorId,
    publicData: {
      xololoWorkspaces: {
        ...prevWs,
        workspaces: nextWorkspaces,
        currentWorkspace: nextCurrent,
      },
    },
  });
  return nextCollaborators.find(c => c.collaboratorId === collaboratorId);
};

const pauseCollaborator = ({ isdk, adminId, collaboratorId }) =>
  setCollaboratorStatus({ isdk, adminId, collaboratorId, nextStatus: STATUS.PAUSED });

const resumeCollaborator = ({ isdk, adminId, collaboratorId }) =>
  setCollaboratorStatus({ isdk, adminId, collaboratorId, nextStatus: STATUS.ACTIVE });

const removeCollaborator = ({ isdk, adminId, collaboratorId }) =>
  setCollaboratorStatus({ isdk, adminId, collaboratorId, nextStatus: STATUS.REMOVED });

/**
 * Setea el workspace actual del colaborador. null = modo propio.
 * Valida que el workspace exista y esté active.
 */
const switchWorkspace = async ({ isdk, collaboratorId, sellerId }) => {
  if (!isdk) throw new Error('integration_api_missing');
  const resp = await isdk.users.show({ id: collaboratorId });
  const prevWs = readWorkspaces(resp.data.data);
  if (sellerId !== null) {
    const ws = (prevWs.workspaces || []).find(w => w.sellerId === sellerId);
    if (!ws) throw new Error('workspace_not_found');
    if (ws.status !== STATUS.ACTIVE) throw new Error('workspace_not_active');
  }
  await isdk.users.updateProfile({
    id: collaboratorId,
    publicData: {
      xololoWorkspaces: { ...prevWs, currentWorkspace: sellerId },
    },
  });
  return { currentWorkspace: sellerId };
};

/**
 * Agrega una entrada al audit log del team del admin. Append al inicio,
 * trunca a MAX_ACTIONS. Fire-and-forget — nunca lanza; devuelve bool.
 */
const recordTeamAction = async ({ isdk, adminId, actor, action, target, result }) => {
  if (!isdk || !adminId) return false;
  try {
    const resp = await isdk.users.show({ id: adminId });
    const prevTeam = readTeam(resp.data.data);
    const entry = {
      id: randomUUID(),
      at: new Date().toISOString(),
      actor: {
        userId: actor?.userId || null,
        email: actor?.email || null,
        name: actor?.name || null,
      },
      action,
      target: target || null,
      result: result || 'ok',
    };
    const nextActions = [entry, ...(prevTeam.actions || [])].slice(0, MAX_ACTIONS);
    await isdk.users.updateProfile({
      id: adminId,
      metadata: {
        xololoTeam: { ...prevTeam, actions: nextActions },
      },
    });
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[teamStore] recordTeamAction falló para ${adminId}:`, e?.message);
    return false;
  }
};

module.exports = {
  STATUS,
  MAX_ACTIONS,
  emptyTeamMetadata,
  emptyWorkspacesPublicData,
  readTeam,
  readWorkspaces,
  recomputeSeats,
  addInvite,
  acceptInvite,
  updatePermissions,
  setCollaboratorStatus,
  pauseCollaborator,
  resumeCollaborator,
  removeCollaborator,
  switchWorkspace,
  recordTeamAction,
};
