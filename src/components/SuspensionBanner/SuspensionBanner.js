import React from 'react';
import { useSelector } from 'react-redux';

import css from './SuspensionBanner.module.css';

// XOLOLO OPS Users 360 · task #42 — banner global que avisa al propio
// user si fue suspendido por OPS. Lee publicData.xololoSuspended desde
// state.user.currentUser (ya hidratado por el shell de la app).
//
// Montado una sola vez en <ClientApp> (al mismo nivel que CartUserSync
// y HeartbeatBridge). Se renderiza como una tira roja arriba del
// contenido, no modal — el user puede seguir navegando (ver storefronts,
// etc.) pero las acciones críticas (publicar listings, pagar) van a
// rechazar server-side.

const SuspensionBanner = () => {
  const suspended = useSelector(
    state => state.user?.currentUser?.attributes?.profile?.publicData?.xololoSuspended || null
  );
  if (!suspended || suspended.active !== true) return null;
  return (
    <div className={css.root} role="alert">
      <div className={css.inner}>
        <span className={css.icon} aria-hidden="true">
          ⛔
        </span>
        <div className={css.body}>
          <strong className={css.title}>Tu cuenta está suspendida temporalmente</strong>
          <p className={css.reason}>
            {suspended.reason || 'Un operador de Xololo revisa tu caso.'}
          </p>
          <p className={css.hint}>
            Mientras tanto no podrás publicar productos nuevos ni completar compras. Escríbenos
            por WhatsApp si crees que es un error.
          </p>
        </div>
      </div>
    </div>
  );
};

export default SuspensionBanner;
