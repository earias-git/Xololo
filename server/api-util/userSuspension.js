// XOLOLO OPS Users 360 · Fase D (task #42) — gates reales de suspensión.
//
// Hoy la suspensión vive en metadata.xololoSuspension (invisible al
// cliente), pero necesitamos que BLOQUEE acciones del user suspendido.
// Para evitar un roundtrip extra via Integration SDK en cada initiate
// (lento) espejeamos el flag a publicData.xololoSuspended, que SÍ es
// visible al SDK normal del marketplace.
//
// Shape:
//   publicData.xololoSuspended = {
//     active: boolean,
//     reason: string,
//     at: ISO,
//   } | null
//
// metadata.xololoSuspension sigue teniendo el historial completo
// (quién, cuándo, history[]) para audit.

/**
 * Lee el estado de suspensión desde publicData (SDK normal — no requiere
 * Integration SDK). Acepta cualquier shape de user — listing.author,
 * currentUser, etc.
 */
const isUserSuspended = user => {
  const sus = user?.attributes?.profile?.publicData?.xololoSuspended;
  return !!(sus && sus.active === true);
};

/**
 * Devuelve { active, reason, at } o null si no está suspendido.
 */
const getSuspensionSummary = user => {
  const sus = user?.attributes?.profile?.publicData?.xololoSuspended;
  if (!sus || sus.active !== true) return null;
  return { active: true, reason: sus.reason || null, at: sus.at || null };
};

/**
 * Suspende un user: escribe a publicData (visible, para los gates) y
 * metadata (histórico, para audit). Idempotente.
 */
const markSuspended = async ({ isdk, userId, reason, operator }) => {
  if (!isdk) throw new Error('integration_api_missing');
  const now = new Date().toISOString();
  const prev = await isdk.users.show({ id: userId });
  const prevMd = prev.data.data?.attributes?.profile?.metadata || {};
  const prevSus = prevMd.xololoSuspension || {};
  const by = {
    operatorId: operator?.id || null,
    email: operator?.email || null,
    name: operator?.name || null,
  };
  await isdk.users.updateProfile({
    id: userId,
    publicData: {
      xololoSuspended: { active: true, reason, at: now },
    },
    metadata: {
      xololoSuspension: {
        suspended: true,
        reason,
        by,
        at: now,
        history: [
          ...(prevSus.history || []),
          { action: 'suspend', reason, at: now, by: operator?.email || null },
        ].slice(-20),
      },
    },
  });
  return { suspendedAt: now };
};

const markUnsuspended = async ({ isdk, userId, reason, operator }) => {
  if (!isdk) throw new Error('integration_api_missing');
  const now = new Date().toISOString();
  const prev = await isdk.users.show({ id: userId });
  const prevMd = prev.data.data?.attributes?.profile?.metadata || {};
  const prevSus = prevMd.xololoSuspension || {};
  const by = {
    operatorId: operator?.id || null,
    email: operator?.email || null,
    name: operator?.name || null,
  };
  await isdk.users.updateProfile({
    id: userId,
    publicData: {
      // Null borra el campo del publicData; el gate deja de aplicarse.
      xololoSuspended: null,
    },
    metadata: {
      xololoSuspension: {
        ...prevSus,
        suspended: false,
        unsuspendedAt: now,
        unsuspendedReason: reason,
        unsuspendedBy: by,
        history: [
          ...(prevSus.history || []),
          { action: 'unsuspend', reason, at: now, by: operator?.email || null },
        ].slice(-20),
      },
    },
  });
  return { unsuspendedAt: now };
};

module.exports = {
  isUserSuspended,
  getSuspensionSummary,
  markSuspended,
  markUnsuspended,
};
