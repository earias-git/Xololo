import React, { useEffect, useState, useCallback } from 'react';
import { useSelector } from 'react-redux';

import { apiBaseUrl } from '../../util/api';
import { isScrollingDisabled } from '../../ducks/ui.duck';
import { Page } from '../../components';

import css from './OpsConsolePage.module.css';

// XOLOLO Fase 1C.5 — Panel /ops (operators Xololo).
//
// SEPARADO del /admin legacy (que usa auth del user marketplace). Este
// panel usa autenticación propia (operatorAuth) con dominio corporativo
// xololo.mx + MFA TOTP. Los operators NO son users del marketplace.
//
// Este archivo contiene el flow completo: Login → MFA Verify →
// Dashboard. Los sub-componentes viven inline para keep todo en un
// solo archivo (son pequeños y el estado es compartido). Páginas
// específicas (operators CRUD, penalty queue, etc.) viven en archivos
// separados y se montan dentro del Dashboard en sub-commits futuros.

// ============================================================
// API client helpers
// ============================================================

const api = async (path, { method = 'GET', body = null } = {}) => {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
};

// ============================================================
// Hook: sesión del operator
// ============================================================

const useOperatorSession = () => {
  const [state, setState] = useState({
    loading: true,
    operator: null,
    error: null,
  });

  const refresh = useCallback(async () => {
    setState(s => ({ ...s, loading: true }));
    const r = await api('/api/admin/auth/me');
    if (r.ok) {
      setState({ loading: false, operator: r.data.operator, error: null });
    } else {
      setState({ loading: false, operator: null, error: r.data?.error || null });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api('/api/admin/auth/logout', { method: 'POST' });
    setState({ loading: false, operator: null, error: null });
  }, []);

  return { ...state, refresh, logout };
};

// ============================================================
// Sub-componente: Login form
// ============================================================

const LoginForm = ({ onSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async e => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const r = await api('/api/admin/auth/login', {
      method: 'POST',
      body: { email: email.trim(), password },
    });
    setLoading(false);
    if (!r.ok) {
      setError(
        r.data?.error === 'invalid_credentials'
          ? 'Email o contraseña incorrectos.'
          : r.data?.error === 'operator_suspended'
          ? 'Esta cuenta está suspendida. Contacta al super admin.'
          : r.data?.error === 'password_not_set'
          ? 'La contraseña no ha sido configurada para esta cuenta.'
          : `Error: ${r.data?.error || 'desconocido'}`
      );
      return;
    }
    onSuccess(r.data.operator);
  };

  return (
    <form className={css.card} onSubmit={handleSubmit}>
      <h1 className={css.title}>Xololo Ops</h1>
      <p className={css.subtitle}>Acceso restringido a operadores Xololo.</p>

      <label className={css.label}>
        Email corporativo
        <input
          type="email"
          autoFocus
          autoComplete="username"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="tu-nombre@xololo.mx"
          required
          className={css.input}
        />
      </label>

      <label className={css.label}>
        Contraseña
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          className={css.input}
        />
      </label>

      {error ? <p className={css.error}>{error}</p> : null}

      <button type="submit" disabled={loading} className={css.primaryBtn}>
        {loading ? 'Verificando…' : 'Entrar'}
      </button>
    </form>
  );
};

// ============================================================
// Sub-componente: MFA Verify form
// ============================================================

const MfaVerifyForm = ({ onSuccess, onCancel }) => {
  const [mode, setMode] = useState('totp'); // 'totp' | 'recovery'
  const [token, setToken] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async e => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const body = mode === 'totp' ? { token: token.trim() } : { recoveryCode: recoveryCode.trim() };
    const r = await api('/api/admin/auth/mfa/verify', { method: 'POST', body });
    setLoading(false);
    if (!r.ok) {
      setError(
        r.data?.error === 'invalid_token'
          ? 'Código inválido. Verifica el reloj de tu app Authenticator.'
          : `Error: ${r.data?.error || 'desconocido'}`
      );
      return;
    }
    onSuccess();
  };

  return (
    <form className={css.card} onSubmit={handleSubmit}>
      <h1 className={css.title}>Verificación 2FA</h1>
      <p className={css.subtitle}>
        Ingresa el código de 6 dígitos de tu app Authenticator (Google Authenticator, Authy, 1Password).
      </p>

      {mode === 'totp' ? (
        <label className={css.label}>
          Código TOTP (6 dígitos)
          <input
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            autoFocus
            value={token}
            onChange={e => setToken(e.target.value.replace(/\D/g, ''))}
            placeholder="123456"
            required
            className={`${css.input} ${css.codeInput}`}
          />
        </label>
      ) : (
        <label className={css.label}>
          Código de recuperación
          <input
            type="text"
            autoFocus
            value={recoveryCode}
            onChange={e => setRecoveryCode(e.target.value.toUpperCase())}
            placeholder="XXXX-XXXX"
            required
            className={`${css.input} ${css.codeInput}`}
          />
        </label>
      )}

      {error ? <p className={css.error}>{error}</p> : null}

      <button type="submit" disabled={loading} className={css.primaryBtn}>
        {loading ? 'Verificando…' : 'Verificar'}
      </button>

      <div className={css.linkRow}>
        <button
          type="button"
          className={css.linkBtn}
          onClick={() => {
            setMode(m => (m === 'totp' ? 'recovery' : 'totp'));
            setError(null);
          }}
        >
          {mode === 'totp' ? 'Usar código de recuperación' : 'Usar código TOTP'}
        </button>
        <button type="button" className={css.linkBtn} onClick={onCancel}>
          Salir
        </button>
      </div>
    </form>
  );
};

// ============================================================
// Sub-componente: Dashboard
// ============================================================

const ROLE_LABELS = {
  super_admin: 'Super Admin (CEO)',
  operator_penalties: 'Operador de Penalidades',
  operator_logistics: 'Operador de Logística',
  accounting: 'Contabilidad',
  readonly: 'Solo Lectura',
};

const MODULE_CARDS = [
  { key: 'penalties', label: 'Cola de penalidades', emoji: '⚖️', hint: 'Aprueba/rechaza penalidades propuestas por el sistema' },
  { key: 'disputes', label: 'Disputes', emoji: '🤝', hint: 'Mediación de disputes entre buyer y seller' },
  { key: 'appeals', label: 'Apelaciones', emoji: '📩', hint: 'Apelaciones de sellers a penalidades aplicadas' },
  { key: 'logistics', label: 'Logística', emoji: '📦', hint: 'Guías, fletes, entregas' },
  { key: 'accounting', label: 'Contabilidad', emoji: '🧾', hint: 'Facturama, Stripe balance, CxC/CxP' },
  { key: 'users', label: 'Usuarios', emoji: '👤', hint: 'Historial de sellers y buyers' },
  { key: 'operators', label: 'Operadores', emoji: '🔐', hint: 'CRUD de operadores (super admin)' },
  { key: 'audit_log', label: 'Audit log', emoji: '📋', hint: 'Registro de todas las acciones' },
];

const Dashboard = ({ operator, onLogout }) => {
  // TODO: filtrar MODULE_CARDS por permisos del operator (sub-commit 1C.5b).
  return (
    <div className={css.dashboard}>
      <header className={css.topBar}>
        <div>
          <h1 className={css.dashTitle}>Xololo Ops</h1>
          <p className={css.greeting}>
            Hola, <strong>{operator.name}</strong> ·{' '}
            <span className={css.rolePill}>{ROLE_LABELS[operator.role] || operator.role}</span>
          </p>
        </div>
        <button type="button" onClick={onLogout} className={css.logoutBtn}>
          Cerrar sesión
        </button>
      </header>

      {!operator.mfaEnabled ? (
        <div className={css.warningBanner}>
          <strong>⚠️ MFA aún no activada.</strong> Es obligatoria para operar.{' '}
          <a href="/ops/mfa-enroll" className={css.inlineLink}>
            Activarla ahora →
          </a>
        </div>
      ) : null}

      <div className={css.modulesGrid}>
        {MODULE_CARDS.map(m => (
          <div key={m.key} className={css.moduleCard}>
            <span className={css.moduleEmoji} aria-hidden>
              {m.emoji}
            </span>
            <h3 className={css.moduleName}>{m.label}</h3>
            <p className={css.moduleHint}>{m.hint}</p>
            <span className={css.soonBadge}>Próximamente</span>
          </div>
        ))}
      </div>

      <footer className={css.footer}>
        <small>
          Sesión expira en 8h. Último login: {operator.lastLoginAt || '—'}
        </small>
      </footer>
    </div>
  );
};

// ============================================================
// Container principal
// ============================================================

const OpsConsolePage = () => {
  const scrollingDisabled = useSelector(isScrollingDisabled);
  const session = useOperatorSession();

  let content;

  if (session.loading) {
    content = (
      <div className={css.card}>
        <p className={css.subtitle}>Cargando…</p>
      </div>
    );
  } else if (!session.operator) {
    content = <LoginForm onSuccess={() => session.refresh()} />;
  } else if (session.operator.mfaEnabled && session.operator.mfaVerified === false) {
    // Nota: `mfaVerified` viene del JWT. Si mfaEnabled=true y no está
    // verificado todavía, mostramos el gate 2FA.
    content = (
      <MfaVerifyForm onSuccess={() => session.refresh()} onCancel={session.logout} />
    );
  } else {
    content = <Dashboard operator={session.operator} onLogout={session.logout} />;
  }

  return (
    <Page title="Xololo Ops" scrollingDisabled={scrollingDisabled} noIndex>
      <div className={css.root}>{content}</div>
    </Page>
  );
};

export default OpsConsolePage;
