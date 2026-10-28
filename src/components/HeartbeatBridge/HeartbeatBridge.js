import { useSelector } from 'react-redux';

import { useHeartbeat } from '../../util/useHeartbeat';

// XOLOLO OPS Users 360 · Fase A — bridge entre Redux (currentUser) y el
// hook useHeartbeat. Montarse una sola vez dentro de <ClientApp>, bajo
// <Provider>, para que exista acceso al store.
//
// Dispara POST /api/me/heartbeat al autenticarse + cada 5min + al focus
// de pestaña. Sirve para la columna "última actividad" en OPS Users 360.
//
// No renderiza nada.

const HeartbeatBridge = () => {
  const currentUserId = useSelector(
    state => state.user?.currentUser?.id?.uuid || null
  );
  useHeartbeat(currentUserId);
  return null;
};

export default HeartbeatBridge;
