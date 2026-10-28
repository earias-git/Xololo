import React from 'react';
import { useSelector } from 'react-redux';

import { apiBaseUrl } from '../../util/api';
import { ROLE_PRESETS, getCurrentWorkspace } from '../../util/xololoTeam';

import css from './WorkspaceRibbon.module.css';

// XOLOLO Tier Empresarial · E4 — ribbon fijo que avisa al colaborador
// "estás operando como <tienda>, con rol <X>".
//
// Monta una vez en <ClientApp> cerca de SuspensionBanner. Se renderiza
// solo si state.user.currentUser.publicData.xololoWorkspaces.currentWorkspace
// apunta a un workspace active (si está paused o removed, getCurrentWorkspace
// devuelve null y el ribbon desaparece).

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

const WorkspaceRibbon = () => {
  const currentUser = useSelector(state => state.user?.currentUser);
  const ws = getCurrentWorkspace(currentUser);
  if (!ws) return null;

  const roleLabel = ROLE_PRESETS[ws.roleName]?.label || ws.roleName;
  const permsCount = ws.permissions?.length || 0;

  const exitWorkspace = async () => {
    const r = await api('/api/team/switch-workspace', {
      method: 'POST',
      body: { sellerId: null },
    });
    if (r.ok) window.location.reload();
  };

  return (
    <div className={css.root} role="status">
      <div className={css.inner}>
        <span className={css.icon} aria-hidden="true">
          🏢
        </span>
        <div className={css.body}>
          <strong className={css.title}>
            Operando como{' '}
            <span className={css.store}>{ws.sellerDisplayName || ws.sellerSlug || 'Tienda'}</span>
          </strong>
          <span className={css.meta}>
            Rol {roleLabel} · {permsCount} permiso{permsCount === 1 ? '' : 's'}
          </span>
        </div>
        <button type="button" className={css.exitBtn} onClick={exitWorkspace}>
          Salir del workspace
        </button>
      </div>
    </div>
  );
};

export default WorkspaceRibbon;
