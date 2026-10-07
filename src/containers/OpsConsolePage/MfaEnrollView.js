import React, { useEffect, useState } from 'react';

import { apiBaseUrl } from '../../util/api';

import css from './OpsConsolePage.module.css';

// XOLOLO Fase 1C.5b — Vista de enrollment MFA.
// Flow: GET /mfa/enroll → genera secret + QR + recovery codes →
// operator escanea con app Authenticator + guarda recovery codes →
// pone primer código → POST /mfa/verify-enroll → mfaEnabled=true.
//
// Props: onDone() se llama cuando el enrollment termina OK; el
// container padre refresca sesión y vuelve al Dashboard.

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

const MfaEnrollView = ({ onDone, onCancel }) => {
  const [enrollment, setEnrollment] = useState(null);
  const [loadingEnroll, setLoadingEnroll] = useState(true);
  const [enrollError, setEnrollError] = useState(null);

  const [token, setToken] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState(null);
  const [savedCodes, setSavedCodes] = useState(false);

  // Al montar, pedir enrollment nuevo. OJO: cada vez que entra genera
  // un secret NUEVO — descarta el anterior si no se verificó. Es
  // deseable: si el operator cerró el browser sin terminar, debe
  // empezar de cero (los recovery codes previos no son recuperables).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await api('/api/admin/auth/mfa/enroll', { method: 'POST' });
      if (cancelled) return;
      if (!r.ok) {
        setEnrollError(r.data?.error || 'enroll_failed');
        setLoadingEnroll(false);
        return;
      }
      setEnrollment(r.data);
      setLoadingEnroll(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleVerify = async e => {
    e.preventDefault();
    setVerifying(true);
    setVerifyError(null);
    const r = await api('/api/admin/auth/mfa/verify-enroll', {
      method: 'POST',
      body: { token: token.trim() },
    });
    setVerifying(false);
    if (!r.ok) {
      setVerifyError(
        r.data?.error === 'invalid_token'
          ? 'Código inválido. Verifica el reloj de tu dispositivo.'
          : `Error: ${r.data?.error || 'desconocido'}`
      );
      return;
    }
    onDone();
  };

  if (loadingEnroll) {
    return (
      <div className={css.card}>
        <h1 className={css.title}>Preparando 2FA…</h1>
        <p className={css.subtitle}>Un momento.</p>
      </div>
    );
  }

  if (enrollError) {
    return (
      <div className={css.card}>
        <h1 className={css.title}>Error al preparar 2FA</h1>
        <p className={css.error}>Error: {enrollError}</p>
        <button type="button" className={css.primaryBtn} onClick={onCancel}>
          Volver
        </button>
      </div>
    );
  }

  return (
    <div className={css.cardWide}>
      <h1 className={css.title}>Activa 2FA</h1>
      <p className={css.subtitle}>
        Es obligatorio para operar. Instala Google Authenticator, Authy o 1Password en tu teléfono
        si aún no la tienes.
      </p>

      <div className={css.enrollSection}>
        <h3 className={css.sectionTitle}>Paso 1 — Escanea el QR con tu app</h3>
        <div className={css.qrFrame}>
          <img src={enrollment.qrDataUrl} alt="QR TOTP" className={css.qrImg} />
        </div>
        <details className={css.manualDetails}>
          <summary>¿No puedes escanear? Introduce el secret manualmente</summary>
          <code className={css.secretCode}>{enrollment.secret}</code>
        </details>
      </div>

      <div className={css.enrollSection}>
        <h3 className={css.sectionTitle}>Paso 2 — Guarda estos códigos de recuperación</h3>
        <p className={css.helperText}>
          Si pierdes acceso a tu app Authenticator, estos códigos te permiten entrar. Cada uno sirve
          UNA SOLA VEZ. <strong>No se mostrarán de nuevo.</strong> Imprímelos o guárdalos en un
          password manager.
        </p>
        <div className={css.recoveryCodesGrid}>
          {enrollment.recoveryCodes.map((code, i) => (
            <code key={i} className={css.recoveryCode}>
              {code}
            </code>
          ))}
        </div>
        <label className={css.ackRow}>
          <input
            type="checkbox"
            checked={savedCodes}
            onChange={e => setSavedCodes(e.target.checked)}
          />
          <span>Confirmo que guardé los códigos de recuperación en un lugar seguro.</span>
        </label>
      </div>

      <form onSubmit={handleVerify} className={css.enrollSection}>
        <h3 className={css.sectionTitle}>Paso 3 — Confirma con el primer código de tu app</h3>
        <label className={css.label}>
          Código TOTP (6 dígitos)
          <input
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            value={token}
            onChange={e => setToken(e.target.value.replace(/\D/g, ''))}
            placeholder="123456"
            required
            className={`${css.input} ${css.codeInput}`}
          />
        </label>

        {verifyError ? <p className={css.error}>{verifyError}</p> : null}

        <button
          type="submit"
          disabled={verifying || !savedCodes || token.length !== 6}
          className={css.primaryBtn}
        >
          {verifying ? 'Verificando…' : 'Activar 2FA'}
        </button>
        <button type="button" className={css.linkBtn} onClick={onCancel}>
          Cancelar
        </button>
      </form>
    </div>
  );
};

export default MfaEnrollView;
