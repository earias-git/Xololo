import React from 'react';

import css from './AdminPage.module.css';

// XOLOLO F3 · helpers compartidos entre las vistas de /admin.

export const formatMxn = subunits => {
  const n = Number(subunits) || 0;
  return (n / 100).toLocaleString('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
};

export const formatNumber = n => (Number(n) || 0).toLocaleString('es-MX');

export const fetchJson = async url => {
  const res = await fetch(url, { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'fetch_failed');
    err.status = res.status;
    throw err;
  }
  return data;
};

export const Kpi = ({ label, value, tone, hint }) => (
  <div className={`${css.kpi} ${tone ? css[`kpi--${tone}`] : ''}`}>
    <p className={css.kpiLabel}>{label}</p>
    <p className={css.kpiValue}>{value}</p>
    {hint ? <p className={css.kpiHint}>{hint}</p> : null}
  </div>
);

export const ErrorBox = ({ error, code }) => {
  if (code === 403) {
    return (
      <div className={css.gateBlocked}>
        <h3>Acceso restringido</h3>
        <p>
          Esta sección es sólo para operadores de Xololo. Si eres parte del equipo,
          pide que tu email se agregue a <code>XOLOLO_ADMIN_EMAILS</code> en el server.
        </p>
      </div>
    );
  }
  if (code === 401) {
    return (
      <div className={css.gateBlocked}>
        <h3>Sesión expirada</h3>
        <p>Recarga la página y vuelve a iniciar sesión.</p>
      </div>
    );
  }
  return (
    <div className={css.errorBox}>
      <strong>Error cargando datos:</strong> {error}
    </div>
  );
};
