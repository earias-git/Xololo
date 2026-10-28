// XOLOLO OPS Users 360 · Fase A — tracking de "última actividad" del user.
//
// Rationale: Sharetribe no expone `lastLoginAt` nativamente. Para la vista
// "OPS Users 360" necesitamos saber cuándo fue la última vez que un user
// estuvo en la app, con precisión de minutos. La solución es bump periódico
// de un campo en `metadata.xololoActivity` por cada user autenticado.
//
// Diseño:
//   - El cliente (useHeartbeat) llama POST /api/me/heartbeat al cargar la
//     app y cada 5 min + al volver a visible (focus).
//   - Este helper dedupe por userId con ventana de 60s in-memory — así
//     SPAs con varias pestañas abiertas o endpoints internos que llamen
//     recordUserActivity varias veces por minuto solo generan 1 call a
//     Integration API por minuto.
//   - La escritura es fire-and-forget (sin await en el caller) para no
//     frenar la respuesta. Logs de errores van a stdout pero NO rompen al
//     caller.
//
// Shape que escribimos:
//   metadata.xololoActivity = {
//     lastSeenAt: ISO string,
//     seenCount: int (incrementado por 1 por bump real),
//   }
//
// Por qué `metadata` y no `privateData`:
//   - metadata = visible solo al operator vía Integration API. Perfecto
//     para OPS, invisible al propio user. No contamina el perfil público.
//   - privateData = visible al propio user — innecesario y potencialmente
//     ruidoso para el user.

const DEDUPE_WINDOW_MS = 60 * 1000;

// Map<userId, lastBumpAt (ms)>. In-memory por proceso. Un deploy / restart
// pierde el estado — no importa, el peor caso es un extra call al despertar.
// Tamaño máximo acotado para evitar leak si hay muchos userIds únicos.
const MAX_CACHE_SIZE = 10_000;
const lastBumpByUser = new Map();

const bumpInCache = (userId, now) => {
  // Eviction simple: cuando llega al tope, borra el más viejo (hashmap
  // en Node preserva orden de inserción, así que el primer key es el
  // más antiguo).
  if (lastBumpByUser.size >= MAX_CACHE_SIZE) {
    const firstKey = lastBumpByUser.keys().next().value;
    if (firstKey) lastBumpByUser.delete(firstKey);
  }
  lastBumpByUser.set(userId, now);
};

/**
 * Marca al user como "visto ahora". Dedupe por 60s.
 *
 * No hace await de la escritura — devuelve inmediato con el bool que
 * dice si se disparó un bump real (true) o fue silenciado por dedupe
 * (false). Útil para tests.
 *
 * @param {Object} params
 * @param {Object} params.isdk — Integration SDK (desde getIntegrationSdk)
 * @param {string} params.userId — uuid del user
 * @returns {boolean} — true si se disparó un bump, false si dedupe
 */
const recordUserActivity = ({ isdk, userId }) => {
  if (!isdk || !userId) return false;
  const now = Date.now();
  const prev = lastBumpByUser.get(userId);
  if (prev && now - prev < DEDUPE_WINDOW_MS) {
    return false;
  }
  bumpInCache(userId, now);

  // Fire-and-forget. No await, no bloqueamos al caller.
  isdk.users
    .show({ id: userId })
    .then(resp => {
      const prevActivity = resp.data.data?.attributes?.profile?.metadata?.xololoActivity || {};
      const nextCount = (Number(prevActivity.seenCount) || 0) + 1;
      return isdk.users.updateProfile({
        id: userId,
        metadata: {
          xololoActivity: {
            lastSeenAt: new Date(now).toISOString(),
            seenCount: nextCount,
          },
        },
      });
    })
    .catch(e => {
      // eslint-disable-next-line no-console
      console.warn(`[userActivity] bump falló para ${userId}:`, e?.message || e);
      // No invalidamos el dedupe en caso de error — evitamos un bucle
      // ruidoso si la API está caída. El próximo bump legítimo (en 60s)
      // volverá a intentar.
    });

  return true;
};

/**
 * Para tests: limpia la cache in-memory.
 */
const _resetActivityCache = () => {
  lastBumpByUser.clear();
};

module.exports = {
  recordUserActivity,
  _resetActivityCache,
  DEDUPE_WINDOW_MS,
};
