import React, { useEffect, useState } from 'react';

import { apiBaseUrl } from '../../util/api';
import { IconSpinner } from '../../components';

import { formatNumber, fetchJson, Kpi, ErrorBox } from './adminUtils';
import css from './AdminPage.module.css';

// XOLOLO F3 · ampliación admin: usuarios — buyers activos/dormidos/
// sin compra, y candidatos a convertirse en seller. Consume
// /api/admin/overview (compartido con Catálogo y Tráfico).

const timeAgo = iso => {
  if (!iso) return 'nunca';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
  if (days < 1) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days} días`;
  const months = Math.floor(days / 30);
  return `hace ${months} ${months === 1 ? 'mes' : 'meses'}`;
};

const AdminUsersView = () => {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    fetchJson(`${apiBaseUrl()}/api/admin/overview?months=6`).then(
      d => setState({ status: 'ok', data: d, error: null }),
      e => setState({ status: 'error', data: null, error: e.message, code: e.status })
    );
  }, []);

  if (state.status === 'loading') {
    return (
      <div className={css.loading}>
        <IconSpinner /> <p>Analizando usuarios…</p>
      </div>
    );
  }
  if (state.status === 'error') return <ErrorBox error={state.error} code={state.code} />;

  const { buyers } = state.data;

  return (
    <>
      <header className={css.header}>
        <h2 className={css.pageTitle}>Usuarios</h2>
        <p className={css.pageSubtitle}>
          {buyers.totalUsers} usuarios registrados en total
          {state.data.cached ? <span className={css.cachedBadge}> · caché 10min</span> : null}
        </p>
      </header>

      <div className={css.kpiGrid}>
        <Kpi
          label="Compradores activos"
          value={formatNumber(buyers.activeBuyers)}
          hint="Compraron en los últimos 60 días"
          tone="ok"
        />
        <Kpi
          label="Compradores dormidos"
          value={formatNumber(buyers.dormantBuyers)}
          hint="Compraron antes, no recientemente"
          tone="alert"
        />
        <Kpi
          label="Nunca compraron"
          value={formatNumber(buyers.neverPurchased)}
          hint="Registrados sin ninguna compra"
        />
        <Kpi label="Total usuarios" value={formatNumber(buyers.totalUsers)} tone="revenue" />
      </div>

      <section className={css.chartSection}>
        <h3 className={css.sectionTitle}>
          Candidatos a seller
          <span className={css.blockCountBadge}>{buyers.candidates.length}</span>
        </h3>
        <p className={css.sectionSubtitle}>
          Compradores con ≥3 compras que todavía no publican ningún producto —
          buenos prospectos para invitar a vender en Xololo.
        </p>
        {buyers.candidates.length === 0 ? (
          <div className={css.emptyBox}>
            <p>Sin candidatos por ahora.</p>
          </div>
        ) : (
          <div className={css.tableWrap}>
            <table className={css.table}>
              <thead>
                <tr>
                  <th style={{ width: '40%' }}>Usuario</th>
                  <th className={css.numeric}>Compras</th>
                  <th>Última compra</th>
                </tr>
              </thead>
              <tbody>
                {buyers.candidates.map(c => (
                  <tr key={c.userId}>
                    <td>
                      <div>
                        <strong>{c.name || '—'}</strong>
                        <div className={css.sellerEmail}>{c.email}</div>
                      </div>
                    </td>
                    <td className={css.numeric}>{c.ordersCount}</td>
                    <td>{timeAgo(c.lastOrderAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className={css.footNote}>
        Xololo no tiene roles duros buyer/seller — cualquier usuario puede vender.
        &quot;Activo&quot; = compró (tx no cancelada) en los últimos 60 días.
        &quot;Dormido&quot; = compró antes, no en esa ventana.
      </p>
    </>
  );
};

export default AdminUsersView;
