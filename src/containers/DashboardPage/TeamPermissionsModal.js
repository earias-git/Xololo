import React, { useEffect, useState } from 'react';

import { apiBaseUrl } from '../../util/api';
import {
  PERMISSIONS,
  PERMISSION_META,
  ROLES,
  ROLE_PRESETS,
  getPermissionsForRole,
  inferRoleFromPermissions,
} from '../../util/xololoTeam';

import css from './DashboardTeamView.module.css';

// XOLOLO Tier Empresarial · E3 — modal para editar rol/permisos de un
// colaborador existente. POST /api/team/update-permissions.
//
// Al abrir, infiere el rol a partir de permissions[]:
//   - matchea preset exacto → ese rol seleccionado.
//   - diferente → 'custom'.

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

const SELECTABLE_PERMISSIONS = Object.values(PERMISSIONS).filter(
  p => p !== PERMISSIONS.TEAM
);

const INVITABLE_ROLES = [
  ROLES.MANAGER,
  ROLES.CATALOG,
  ROLES.LOGISTICS,
  ROLES.FINANCE,
  ROLES.CUSTOM,
];

const TeamPermissionsModal = ({ targetSellerId, collaborator, onClose, onDone }) => {
  const initialRole = inferRoleFromPermissions(collaborator.permissions);
  const [roleName, setRoleName] = useState(initialRole);
  const [customPerms, setCustomPerms] = useState(
    new Set(initialRole === ROLES.CUSTOM ? collaborator.permissions || [] : [])
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const permissions =
    roleName === ROLES.CUSTOM
      ? [...customPerms]
      : getPermissionsForRole(roleName).filter(p => p !== PERMISSIONS.TEAM);

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const togglePerm = p => {
    setCustomPerms(prev => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    const r = await api('/api/team/update-permissions', {
      method: 'POST',
      body: {
        targetSellerId,
        collaboratorId: collaborator.collaboratorId,
        roleName,
        permissions,
      },
    });
    setBusy(false);
    if (!r.ok) {
      setErr(r.data?.error || 'error');
      return;
    }
    onDone?.();
  };

  const canSubmit = !busy && permissions.length > 0;

  return (
    <div className={css.modalBackdrop} onClick={onClose} role="presentation">
      <div className={css.modalCard} onClick={e => e.stopPropagation()}>
        <h3 className={css.modalTitle}>Editar permisos — {collaborator.email}</h3>

        <label className={css.modalLabel}>
          Rol
          <select
            className={css.modalInput}
            value={roleName}
            onChange={e => {
              const nr = e.target.value;
              setRoleName(nr);
              if (nr === ROLES.CUSTOM) {
                const seed = getPermissionsForRole(roleName).filter(
                  p => p !== PERMISSIONS.TEAM
                );
                setCustomPerms(new Set(seed));
              } else {
                setCustomPerms(new Set());
              }
            }}
          >
            {INVITABLE_ROLES.map(key => (
              <option key={key} value={key}>
                {ROLE_PRESETS[key].label}
              </option>
            ))}
          </select>
          <small className={css.muted}>{ROLE_PRESETS[roleName].hint}</small>
        </label>

        {roleName === ROLES.CUSTOM ? (
          <fieldset className={css.permsBox}>
            <legend className={css.permsLegend}>Permisos</legend>
            {SELECTABLE_PERMISSIONS.map(p => (
              <label key={p} className={css.permCheck}>
                <input
                  type="checkbox"
                  checked={customPerms.has(p)}
                  onChange={() => togglePerm(p)}
                />
                <span>
                  <strong>{PERMISSION_META[p].label}</strong>
                  <small className={css.muted}> — {PERMISSION_META[p].hint}</small>
                </span>
              </label>
            ))}
          </fieldset>
        ) : (
          <div className={css.permPreview}>
            <strong>Permisos del rol:</strong>
            <ul>
              {permissions.map(p => (
                <li key={p}>{PERMISSION_META[p]?.label || p}</li>
              ))}
            </ul>
          </div>
        )}

        {err ? <p className={css.error}>Error: {err}</p> : null}

        <div className={css.modalActions}>
          <button type="button" className={css.secondaryBtn} onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className={css.primaryBtn}
            onClick={submit}
            disabled={!canSubmit}
          >
            {busy ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TeamPermissionsModal;
