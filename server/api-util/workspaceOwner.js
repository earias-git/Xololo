// XOLOLO · E9 helper — verifica si currentUser puede operar sobre
// un recurso del `targetUserId` (author/provider del listing/tx).
//
// Verdadero cuando:
//   1. currentUserId === targetUserId (owner directo), O
//   2. targetUserId === currentUser.publicData.xololoWorkspaces.currentWorkspace
//      (colaborador operando como el admin del workspace activo).
//
// Centraliza el patrón que repetían ai-suggest y ahora extendemos a los
// demás endpoints custom con gate `authorId !== currentUserId`.

const isActingAsAuthor = (currentUser, targetUserId) => {
  if (!currentUser || !targetUserId) return false;
  const currentUserId = currentUser.id?.uuid;
  if (currentUserId === targetUserId) return true;
  const currentWorkspaceSellerId =
    currentUser.attributes?.profile?.publicData?.xololoWorkspaces?.currentWorkspace;
  return !!currentWorkspaceSellerId && currentWorkspaceSellerId === targetUserId;
};

module.exports = { isActingAsAuthor };
