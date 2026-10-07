import React, { useEffect, useState, useCallback } from 'react';

import { apiBaseUrl } from '../../util/api';

import css from './OpsConsolePage.module.css';

// XOLOLO Fase 1C.5b — UI de gestión de operators. Solo super_admin
// puede llegar aquí (gate server-side en /api/admin/operators). Esta
// vista permite:
//   - Listar operators (con rol, MFA status, suspensión).
//   - Crear operator nuevo (email xololo.mx + nombre + rol).
//   - Asignar/resetear password.
//   - Suspender / reactivar.
//   - Cambiar rol (excepto propio rol, para evitar lockout).

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

const OperatorsView = ({ currentOperator, onBack }) => {
  const [state, setState] = useState({ loading: true, operators: [], roles: [], error: null });
  const [showCreate, setShowCreate] = useState(false);
  const [actionTarget, setActionTarget] = useState(null); // {op, action: 'setPassword'|'suspend'|'edit'}

  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true }));
    const r = await api('/api/admin/operators');
    if (r.ok) {
      setState({ loading: false, operators: r.data.operators, roles: r.data.roles, error: null });
    } else {
      setState({ loading: false, operators: [], roles: [], error: r.data?.error || 'load_failed' });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className={css.dashboard}>
      <header className={css.topBar}>
        <div>
          <button type="button" className={css.linkBtn} onClick={onBack}>
            ← Volver al dashboard
          </button>
          <h1 className={css.dashTitle}>Operadores</h1>
          <p className={css.greeting}>Gestión de cuentas Xololo con acceso al panel /ops.</p>
        </div>
        <button type="button" className={css.primaryBtnInline} onClick={() => setShowCreate(true)}>
          + Nuevo operador
        </button>
      </header>

      {state.loading ? <p>Cargando…</p> : null}
      {state.error ? <p className={css.error}>Error: {state.error}</p> : null}

      {!state.loading && !state.error ? (
        <div className={css.tableWrap}>
          <table className={css.table}>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Email</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>MFA</th>
                <th>Último login</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {state.operators.map(op => {
                const roleLabel = state.roles.find(r => r.key === op.role)?.label || op.role;
                const isMe = op.id === currentOperator.id;
                return (
                  <tr key={op.id} className={op.suspendedAt ? css.rowMuted : ''}>
                    <td>
                      <strong>{op.name}</strong>
                      {isMe ? <span className={css.youBadge}>tú</span> : null}
                    </td>
                    <td className={css.monoCell}>{op.email}</td>
                    <td>{roleLabel}</td>
                    <td>
                      {op.suspendedAt ? (
                        <span className={css.badgeRed}>Suspendido</span>
                      ) : op.hasPassword ? (
                        <span className={css.badgeGreen}>Activo</span>
                      ) : (
                        <span className={css.badgeYellow}>Sin password</span>
                      )}
                    </td>
                    <td>
                      {op.mfaEnabled ? (
                        <span className={css.badgeGreen}>✓</span>
                      ) : (
                        <span className={css.badgeYellow}>—</span>
                      )}
                      {op.mfaEnabled && op.recoveryCodesRemaining > 0 ? (
                        <small className={css.monoSmall}> ({op.recoveryCodesRemaining}/8)</small>
                      ) : null}
                    </td>
                    <td className={css.monoSmall}>
                      {op.lastLoginAt ? new Date(op.lastLoginAt).toLocaleString('es-MX') : '—'}
                    </td>
                    <td className={css.actionsCell}>
                      <button
                        type="button"
                        className={css.secondaryBtnSmall}
                        onClick={() => setActionTarget({ op, action: 'setPassword' })}
                      >
                        Password
                      </button>
                      {!isMe ? (
                        <button
                          type="button"
                          className={css.secondaryBtnSmall}
                          onClick={() =>
                            setActionTarget({
                              op,
                              action: op.suspendedAt ? 'reinstate' : 'suspend',
                            })
                          }
                        >
                          {op.suspendedAt ? 'Reactivar' : 'Suspender'}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {state.operators.length === 0 ? (
                <tr>
                  <td colSpan={7} className={css.emptyRow}>
                    No hay otros operadores. Usa "+ Nuevo operador" para crear uno.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {showCreate ? (
        <CreateOperatorModal
          roles={state.roles}
          onClose={() => setShowCreate(false)}
          onCreated={async () => {
            setShowCreate(false);
            await load();
          }}
        />
      ) : null}

      {actionTarget ? (
        <ActionModal
          target={actionTarget}
          onClose={() => setActionTarget(null)}
          onDone={async () => {
            setActionTarget(null);
            await load();
          }}
        />
      ) : null}
    </div>
  );
};

// ============================================================
// Modal: Crear operator
// ============================================================
const CreateOperatorModal = ({ roles, onClose, onCreated }) => {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('readonly');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async e => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const r = await api('/api/admin/operators', {
      method: 'POST',
      body: { email: email.trim(), name: name.trim(), role },
    });
    setSaving(false);
    if (!r.ok) {
      setError(
        r.data?.error === 'email_already_exists'
          ? 'Ya existe un operador con ese email.'
          : r.data?.error === 'validation_failed'
          ? `Validación: ${(r.data.details || []).join(', ')}`
          : `Error: ${r.data?.error || 'desconocido'}`
      );
      return;
    }
    onCreated(r.data.operator);
  };

  return (
    <div className={css.modalBackdrop} onClick={onClose}>
      <form className={css.modal} onClick={e => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2 className={css.modalTitle}>Nuevo operador</h2>

        <label className={css.label}>
          Email corporativo (@xololo.mx)
          <input
            type="email"
            autoFocus
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="nombre@xololo.mx"
            className={css.input}
          />
        </label>

        <label className={css.label}>
          Nombre completo
          <input
            type="text"
            required
            value={name}
            onChange={e => setName(e.target.value)}
            className={css.input}
          />
        </label>

        <label className={css.label}>
          Rol
          <select value={role} onChange={e => setRole(e.target.value)} className={css.input}>
            {roles.map(r => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        </label>

        <p className={css.helperText}>
          Al crear la cuenta, el nuevo operador podrá entrar sólo cuando le asignes una contraseña
          desde la lista.
        </p>

        {error ? <p className={css.error}>{error}</p> : null}

        <div className={css.modalActions}>
          <button type="button" className={css.secondaryBtn} onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" disabled={saving} className={css.primaryBtn}>
            {saving ? 'Creando…' : 'Crear operador'}
          </button>
        </div>
      </form>
    </div>
  );
};

// ============================================================
// Modal: acciones (setPassword / suspend / reinstate)
// ============================================================
const ActionModal = ({ target, onClose, onDone }) => {
  const { op, action } = target;
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async e => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    let r;
    if (action === 'setPassword') {
      if (password.length < 12) {
        setError('La contraseña debe tener mínimo 12 caracteres.');
        setSaving(false);
        return;
      }
      r = await api(`/api/admin/operators/${op.id}/set-password`, {
        method: 'POST',
        body: { password },
      });
    } else if (action === 'suspend') {
      r = await api(`/api/admin/operators/${op.id}/suspend`, {
        method: 'POST',
        body: { reason: reason.trim() || null },
      });
    } else if (action === 'reinstate') {
      r = await api(`/api/admin/operators/${op.id}/reinstate`, { method: 'POST' });
    }
    setSaving(false);
    if (!r || !r.ok) {
      setError(r?.data?.error || 'error');
      return;
    }
    onDone();
  };

  const title =
    action === 'setPassword'
      ? `Asignar password a ${op.name}`
      : action === 'suspend'
      ? `Suspender a ${op.name}`
      : `Reactivar a ${op.name}`;

  return (
    <div className={css.modalBackdrop} onClick={onClose}>
      <form className={css.modal} onClick={e => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2 className={css.modalTitle}>{title}</h2>

        {action === 'setPassword' ? (
          <label className={css.label}>
            Nueva contraseña (mínimo 12 caracteres)
            <input
              type="password"
              autoFocus
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className={css.input}
            />
          </label>
        ) : null}

        {action === 'suspend' ? (
          <label className={css.label}>
            Razón (opcional, para audit log)
            <input
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Ej: Renuncia, política violada, etc."
              className={css.input}
            />
          </label>
        ) : null}

        {action === 'reinstate' ? (
          <p className={css.helperText}>
            El operador recuperará su acceso con las mismas credenciales que tenía antes.
          </p>
        ) : null}

        {error ? <p className={css.error}>{error}</p> : null}

        <div className={css.modalActions}>
          <button type="button" className={css.secondaryBtn} onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" disabled={saving} className={css.primaryBtn}>
            {saving ? 'Guardando…' : 'Confirmar'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default OperatorsView;
