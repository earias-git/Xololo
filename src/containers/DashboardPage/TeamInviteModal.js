import React, { useEffect, useState } from 'react';

import { apiBaseUrl } from '../../util/api';
import {
  PERMISSIONS,
  PERMISSION_META,
  ROLES,
  ROLE_PRESETS,
  getPermissionsForRole,
} from '../../util/xololoTeam';

import css from './DashboardTeamView.module.css';

// XOLOLO Tier Empresarial · E3 — modal para invitar un colaborador.
//
// Form:
//   - email (requerido)
//   - rol preset (dropdown) o 'custom'
//   - si custom: checkboxes de los 9 permisos atómicos (team se excluye)
//
// POST /api/team/invite con { targetSellerId, collaboratorEmail,
// roleName, permissions }.
//
// Si el server devuelve 404 'collaborator_not_registered', mostramos
// un mensaje accionable: el colaborador debe registrarse en Xololo
// primero.

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

// 'team' nunca se asigna a un colaborador — es exclusivo del admin.
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

const TeamInviteModal = ({ targetSellerId, onClose, onDone }) => {
  const [email, setEmail] = useState('');
  const [roleName, setRoleName] = useState(ROLES.CATALOG);
  const [customPerms, setCustomPerms] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // Permisos efectivos según el rol seleccionado.
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

  const canSubmit =
    !busy &&
    email.trim().length > 3 &&
    permissions.length > 0 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  const submit = async () => {
    setBusy(true);
    setErr(null);
    const r = await api('/api/team/invite', {
      method: 'POST',
      body: {
        targetSellerId,
        collaboratorEmail: email.trim(),
        roleName,
        permissions,
      },
    });
    setBusy(false);
    if (!r.ok) {
      const msg = {
        collaborator_not_registered:
          'Este email no tiene cuenta Xololo todavía. Pídele que se registre y vuelve a invitarlo.',
        collaborator_already_exists:
          'Este colaborador ya está en tu equipo (o tiene una invitación activa).',
        invalid_email: 'Formato de email inválido.',
        cannot_invite_self: 'No puedes invitarte a ti mismo.',
        invalid_role: 'Rol inválido.',
        invalid_permissions: 'Alguno de los permisos no es válido.',
      }[r.data?.error] || `Error: ${r.data?.error || 'desconocido'}`;
      setErr(msg);
      return;
    }
    onDone?.();
  };

  return (
    <div className={css.modalBackdrop} onClick={onClose} role="presentation">
      <div className={css.modalCard} onClick={e => e.stopPropagation()}>
        <h3 className={css.modalTitle}>Invitar colaborador</h3>

        <label className={css.modalLabel}>
          Email
          <input
            type="email"
            className={css.modalInput}
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="colaborador@ejemplo.com"
            autoFocus
          />
        </label>

        <label className={css.modalLabel}>
          Rol
          <select
            className={css.modalInput}
            value={roleName}
            onChange={e => {
              const nr = e.target.value;
              setRoleName(nr);
              // Al cambiar a custom, inicializamos desde el preset previo
              // para no obligar al admin a volver a marcar todo si estaba
              // casi definido. Para no-custom reseteamos los customPerms.
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

        {err ? <p className={css.error}>{err}</p> : null}

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
            {busy ? 'Enviando…' : 'Enviar invitación'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TeamInviteModal;
