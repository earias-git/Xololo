import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import { apiBaseUrl } from '../../util/api';
import { ROLE_PRESETS } from '../../util/xololoTeam';

import css from './WorkspaceSwitcher.module.css';

// XOLOLO Tier Empresarial · E4 — selector de workspace.
//
// Lee del currentUser:
//   publicData.xololoWorkspaces.workspaces[] + currentWorkspace
//
// Muestra:
//   - Un botón con el nombre del contexto actual ("Mi cuenta" o la tienda).
//   - Al hacer click, dropdown con "Mi cuenta" + N tiendas donde el user
//     tiene membresía active.
//
// Al cambiar, POST /api/team/switch-workspace { sellerId: null | adminId }
// y refresca la página para que todas las UIs vean el nuevo contexto.
// (Un refresh es más robusto que invalidar los selectors — el user
// probablemente estaba en una vista específica de su cuenta que ya no
// aplica en modo tienda.)
//
// Si el user no tiene workspaces activos, el componente retorna null
// (no renderiza nada).

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

const WorkspaceSwitcher = () => {
  const data = useSelector(
    state => state.user?.currentUser?.attributes?.profile?.publicData?.xololoWorkspaces
  );
  const workspaces = (data?.workspaces || []).filter(w => w.status === 'active');
  const currentId = data?.currentWorkspace || null;

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (workspaces.length === 0) return null;

  const current = currentId ? workspaces.find(w => w.sellerId === currentId) : null;
  const label = current ? current.sellerDisplayName || current.sellerSlug || 'Tienda' : 'Mi cuenta';

  const switchTo = async sellerId => {
    if (busy) return;
    setBusy(true);
    const r = await api('/api/team/switch-workspace', {
      method: 'POST',
      body: { sellerId },
    });
    setBusy(false);
    if (r.ok) {
      // Refresh para que todas las lecturas del store se re-hidraten.
      window.location.reload();
    } else {
      setOpen(false);
      // eslint-disable-next-line no-alert
      alert(`Error: ${r.data?.error || 'no_pude'}`);
    }
  };

  return (
    <div className={css.wrap}>
      <button
        type="button"
        className={`${css.trigger} ${current ? css.triggerActive : ''}`}
        onClick={() => setOpen(x => !x)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className={css.icon} aria-hidden="true">
          {current ? '🏢' : '👤'}
        </span>
        <span className={css.label}>{label}</span>
        <span className={css.chev} aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <>
          <div className={css.scrim} onClick={() => setOpen(false)} role="presentation" />
          <div className={css.menu} role="menu">
            <div className={css.menuSection}>
              <div className={css.menuTitle}>Operar como</div>
              <button
                type="button"
                className={`${css.menuItem} ${!current ? css.menuItemActive : ''}`}
                onClick={() => switchTo(null)}
                disabled={busy}
              >
                <span className={css.menuIcon}>👤</span>
                <div className={css.menuBody}>
                  <strong>Mi cuenta</strong>
                  <small>Mis compras, mi perfil, mis listings propios</small>
                </div>
                {!current ? <span className={css.menuCheck}>✓</span> : null}
              </button>
            </div>

            <div className={css.menuSection}>
              <div className={css.menuTitle}>Tiendas donde soy colaborador</div>
              {workspaces.map(w => {
                const isActive = current && current.sellerId === w.sellerId;
                const roleLabel = ROLE_PRESETS[w.roleName]?.label || w.roleName;
                return (
                  <button
                    key={w.sellerId}
                    type="button"
                    className={`${css.menuItem} ${isActive ? css.menuItemActive : ''}`}
                    onClick={() => switchTo(w.sellerId)}
                    disabled={busy}
                  >
                    <span className={css.menuIcon}>🏢</span>
                    <div className={css.menuBody}>
                      <strong>{w.sellerDisplayName || w.sellerSlug || 'Tienda'}</strong>
                      <small>
                        {roleLabel} · {w.permissions?.length || 0} permiso
                        {w.permissions?.length === 1 ? '' : 's'}
                      </small>
                    </div>
                    {isActive ? <span className={css.menuCheck}>✓</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
};

export default WorkspaceSwitcher;
