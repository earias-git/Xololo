// XOLOLO OPS Users 360 · Fase A — hook cliente que llama a /api/me/heartbeat.
//
// Objetivo: medir "última actividad" del user para la vista OPS Users 360.
// El server deduplica llamadas por userId con ventana de 60s, así que
// podemos ser liberales con el ritmo del cliente.
//
// Cadencia:
//   - 1 llamada inmediata al autenticarse (mount con userId presente).
//   - Interval cada 5 minutos mientras la pestaña siga abierta.
//   - 1 llamada extra al volver a `visible` (focus de pestaña) si pasaron
//     > 60s desde el último bump client-side (otro dedupe local para
//     evitar spam en tab-switching rápido).
//
// El hook es idempotente — si no hay userId, no hace nada.

import { useEffect, useRef } from 'react';
import { apiBaseUrl } from './api';

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
const CLIENT_DEDUPE_MS = 60 * 1000;

const sendBeat = () =>
  fetch(`${apiBaseUrl()}/api/me/heartbeat`, {
    method: 'POST',
    credentials: 'include',
    // El endpoint ignora el body — mantenerlo sin JSON evita cost de parsing.
  }).catch(() => {
    // Silencioso: un heartbeat fallido no interrumpe la UX.
  });

/**
 * Dispara heartbeats contra /api/me/heartbeat mientras `userId` esté
 * presente. Pensado para montarse una sola vez en el app shell dentro
 * de un gate "si user logueado".
 *
 * @param {string|null|undefined} userId — uuid del user; null = guest, no-op.
 */
export const useHeartbeat = userId => {
  const lastSentRef = useRef(0);

  useEffect(() => {
    if (!userId) return undefined;

    const beat = () => {
      const now = Date.now();
      if (now - lastSentRef.current < CLIENT_DEDUPE_MS) return;
      lastSentRef.current = now;
      sendBeat();
    };

    // 1) inmediato al mount.
    beat();

    // 2) interval cada 5 min.
    const interval = setInterval(beat, HEARTBEAT_INTERVAL_MS);

    // 3) al volver a visible, re-beat.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') beat();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [userId]);
};
