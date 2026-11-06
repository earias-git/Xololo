import React, { useState } from 'react';
import { useSelector } from 'react-redux';

import { apiBaseUrl } from '../../util/api';
import { ROLE_PRESETS } from '../../util/xololoTeam';

import css from './PendingInvitesBanner.module.css';

// XOLOLO Tier Empresarial · UX fix post-feedback (2026-11-05): banner
// en /dashboard que detecta invitaciones de equipo pendientes para el
// currentUser y permite aceptarlas sin requerir el token del email.
//
// Lee de currentUser.publicData.xololoWorkspaces. Cada workspace con
// status=invited genera una card con nombre del Negocio invitador,
// rol, permisos y botón "Aceptar". Al aceptar llama a
// POST /api/team/accept-pending-invite { sellerId } y refresca para
// que la UI muestre el workspace en modo "Operar como".
//
// Si no hay invitaciones pendientes, no renderiza nada. Se monta
// arriba del PayoutGateBanner para que sea lo primero que vea el user.

const api = async (path, opts = {}) => {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method: opts.method || 'GET',
    credentials: 'include',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
};

const PendingInvitesBanner = () => {
  const workspaces = useSelector(
    state =>
      state.user?.currentUser?.attributes?.profile?.publicData?.xololoWorkspaces?.workspaces || []
  );
  const pending = workspaces.filter(w => w.status === 'invited');

  const [acceptingId, setAcceptingId] = useState(null);
  const [error, setError] = useState(null);

  if (pending.length === 0) return null;

  const acceptPending = async sellerId => {
    if (acceptingId) return;
    setAcceptingId(sellerId);
    setError(null);
    const r = await api('/api/team/accept-pending-invite', {
      method: 'POST',
      body: { sellerId },
    });
    if (r.ok) {
      window.location.reload();
      return;
    }
    setAcceptingId(null);
    setError(r.data?.error || 'no_pude_aceptar');
  };

  return (
    <div className={css.root} role="region" aria-label="Invitaciones de equipo pendientes">
      <div className={css.header}>
        <span className={css.icon} aria-hidden="true">
          📬
        </span>
        <div>
          <h3 className={css.title}>
            Tienes {pending.length} invitación{pending.length === 1 ? '' : 'es'} pendiente
            {pending.length === 1 ? '' : 's'}
          </h3>
          <p className={css.subtitle}>
            Un Negocio en Xololo te invitó a administrar su tienda en línea. Al aceptar podrás
            cambiar entre tu propia cuenta y la tienda desde el selector arriba a la derecha.
          </p>
        </div>
      </div>

      <ul className={css.list}>
        {pending.map(w => {
          const roleLabel = ROLE_PRESETS[w.roleName]?.label || w.roleName;
          const isAccepting = acceptingId === w.sellerId;
          return (
            <li key={w.sellerId} className={css.item}>
              <div className={css.itemBody}>
                <strong className={css.sellerName}>
                  {w.sellerDisplayName || w.sellerSlug || 'Un Negocio'}
                </strong>
                <span className={css.roleLine}>
                  Rol: <strong>{roleLabel}</strong> · {w.permissions?.length || 0} permiso
                  {w.permissions?.length === 1 ? '' : 's'}
                </span>
              </div>
              <button
                type="button"
                className={css.acceptBtn}
                onClick={() => acceptPending(w.sellerId)}
                disabled={!!acceptingId}
              >
                {isAccepting ? 'Aceptando…' : 'Aceptar invitación'}
              </button>
            </li>
          );
        })}
      </ul>

      {error ? (
        <p className={css.error}>
          No pudimos aceptar la invitación ({error}). Intenta de nuevo o pídele al administrador
          que te mande una nueva.
        </p>
      ) : null}
    </div>
  );
};

export default PendingInvitesBanner;
// trigger rebuild 1793909855
