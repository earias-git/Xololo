import React, { useEffect, useState } from 'react';

import { apiBaseUrl } from '../../util/api';
import { IconSpinner } from '../../components';

import { formatMxn, fetchJson, Kpi, ErrorBox } from './adminUtils';
import css from './AdminPage.module.css';

// XOLOLO F3 · Fase 3: salud del marketplace (últimos 30 días).

const AdminHealthView = () => {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    fetchJson(`${apiBaseUrl()}/api/admin/health`).then(
      d => setState({ status: 'ok', data: d, error: null }),
      e => setState({ status: 'error', data: null, error: e.message, code: e.status })
    );
  }, []);

  if (state.status === 'loading') {
    return (
      <div className={css.loading}>
        <IconSpinner /> <p>Cargando métricas…</p>
      </div>
    );
  }
  if (state.status === 'error') return <ErrorBox error={state.error} code={state.code} />;

  const m = state.data.metrics;
  return (
    <>
      <header className={css.header}>
        <h2 className={css.pageTitle}>Salud del marketplace</h2>
        <p className={css.pageSubtitle}>
          Rango: <strong>{state.data.range.from}</strong> → <strong>{state.data.range.to}</strong>
        </p>
      </header>
      <div className={css.kpiGrid}>
        <Kpi label="GMV total" value={formatMxn(m.gmv)} tone="revenue" />
        <Kpi label="Transacciones" value={m.txCount} tone="active" />
        <Kpi label="Sellers activos" value={m.sellersActive} tone="active" />
        <Kpi label="Buyers únicos" value={m.buyersUnique} tone="active" />
        <Kpi label="Ticket promedio" value={formatMxn(m.ticketAverage)} tone="revenue" />
        <Kpi label="Comisión Xololo" value={formatMxn(m.commissionXololo)} tone="revenue" />
        <Kpi
          label="Disputas abiertas"
          value={m.openDisputes}
          tone={m.openDisputes > 0 ? 'alert' : 'ok'}
        />
      </div>
      <p className={css.footNote}>
        Estas métricas son un resumen de los últimos 30 días.
        Cache de 5 min desde la última consulta.
      </p>
    </>
  );
};

export default AdminHealthView;
