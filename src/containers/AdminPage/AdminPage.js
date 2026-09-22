import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { apiBaseUrl } from '../../util/api';
import { isScrollingDisabled } from '../../ducks/ui.duck';

import {
  H2,
  IconSpinner,
  LayoutSideNavigation,
  Page,
  TabNav,
} from '../../components';
import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import css from './AdminPage.module.css';

// XOLOLO F3 · Fase 3: panel interno /admin para Ops de Xololo.
// Server-side gated por XOLOLO_ADMIN_EMAILS. El cliente esconde
// contenido si el fetch inicial devuelve 403 — no gate hardcoded
// en el bundle (evita revelar quién es admin ni permitir bypass
// del gate del server).
//
// Sub-secciones (via ?section=):
//   - health   → métricas globales del marketplace (default)
//   - disputes → tx con xololoDispute abierto
//   - sellers  → top sellers por revenue

const SECTIONS = [
  { key: 'health', label: 'Salud del marketplace' },
  { key: 'disputes', label: 'Disputas activas' },
  { key: 'sellers', label: 'Sellers destacados' },
];

const DEFAULT_SECTION = 'health';

const formatMxn = subunits => {
  const n = Number(subunits) || 0;
  return (n / 100).toLocaleString('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
};

const fetchJson = async url => {
  const res = await fetch(url, { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'fetch_failed');
    err.status = res.status;
    throw err;
  }
  return data;
};

const getSectionFromLocation = search => {
  const p = new URLSearchParams(search || '');
  const s = (p.get('section') || DEFAULT_SECTION).toLowerCase();
  return SECTIONS.some(x => x.key === s) ? s : DEFAULT_SECTION;
};

// ==================== HEALTH ====================

const HealthView = () => {
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

// ==================== DISPUTES ====================

const DisputesView = () => {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    fetchJson(`${apiBaseUrl()}/api/admin/disputes`).then(
      d => setState({ status: 'ok', data: d, error: null }),
      e => setState({ status: 'error', data: null, error: e.message, code: e.status })
    );
  }, []);

  if (state.status === 'loading') {
    return (
      <div className={css.loading}>
        <IconSpinner /> <p>Cargando disputas…</p>
      </div>
    );
  }
  if (state.status === 'error') return <ErrorBox error={state.error} code={state.code} />;

  const items = state.data.disputes;
  return (
    <>
      <header className={css.header}>
        <h2 className={css.pageTitle}>Disputas activas</h2>
        <p className={css.pageSubtitle}>
          {items.length} disputa{items.length === 1 ? '' : 's'} en los últimos 90 días
        </p>
      </header>
      {items.length === 0 ? (
        <div className={css.emptyBox}>
          <p>Sin disputas activas 👌</p>
        </div>
      ) : (
        <ul className={css.disputeList}>
          {items.map(d => (
            <li key={d.transactionId} className={css.disputeItem}>
              <div className={css.disputeHead}>
                <span className={css.disputeStatus}>{d.status}</span>
                <span className={css.disputeAmount}>{formatMxn(d.amountAtStake)}</span>
              </div>
              <p className={css.disputeListing}>{d.listing.title || 'Producto'}</p>
              <p className={css.disputeParties}>
                <strong>Buyer:</strong> {d.buyer.name} · {d.buyer.email}<br />
                <strong>Seller:</strong> {d.seller.name} · {d.seller.email}
              </p>
              {d.issueDetail ? (
                <p className={css.disputeIssue}>{d.issueDetail}</p>
              ) : null}
              <p className={css.disputeFoot}>
                <span>Abierta el {new Date(d.openedAt).toLocaleString('es-MX')}</span>
                <a
                  href={`/sale/${d.transactionId}/details`}
                  className={css.disputeLink}
                  target="_blank"
                  rel="noreferrer"
                >
                  Ver transacción →
                </a>
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
};

// ==================== SELLERS ====================

const SellersView = () => {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    fetchJson(`${apiBaseUrl()}/api/admin/sellers-ranking`).then(
      d => setState({ status: 'ok', data: d, error: null }),
      e => setState({ status: 'error', data: null, error: e.message, code: e.status })
    );
  }, []);

  if (state.status === 'loading') {
    return (
      <div className={css.loading}>
        <IconSpinner /> <p>Cargando ranking de sellers…</p>
      </div>
    );
  }
  if (state.status === 'error') return <ErrorBox error={state.error} code={state.code} />;

  const sellers = state.data.sellers;
  return (
    <>
      <header className={css.header}>
        <h2 className={css.pageTitle}>Sellers destacados</h2>
        <p className={css.pageSubtitle}>
          Ranking por revenue en los últimos 30 días · {sellers.length} sellers con ventas
        </p>
      </header>
      {sellers.length === 0 ? (
        <div className={css.emptyBox}>
          <p>Sin ventas en el período.</p>
        </div>
      ) : (
        <div className={css.tableWrap}>
          <table className={css.table}>
            <thead>
              <tr>
                <th style={{ width: '5%' }}>#</th>
                <th style={{ width: '40%' }}>Seller</th>
                <th className={css.numeric}># tx</th>
                <th className={css.numeric}>Revenue</th>
                <th className={css.numeric}>Comisión</th>
                <th>Tienda</th>
              </tr>
            </thead>
            <tbody>
              {sellers.map((s, i) => (
                <tr key={s.sellerId}>
                  <td>{i + 1}</td>
                  <td>
                    <div>
                      <strong>{s.name || '—'}</strong>
                      <div className={css.sellerEmail}>{s.email}</div>
                    </div>
                  </td>
                  <td className={css.numeric}>{s.txCount}</td>
                  <td className={css.numeric}>{formatMxn(s.revenue)}</td>
                  <td className={css.numeric}>{formatMxn(s.commission)}</td>
                  <td>
                    {s.storeUrl ? (
                      <a href={s.storeUrl} target="_blank" rel="noreferrer" className={css.storeLink}>
                        {s.storeSlug} ↗
                      </a>
                    ) : (
                      <span className={css.storeMissing}>sin subdominio</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

// ==================== helpers UI ====================

const Kpi = ({ label, value, tone }) => (
  <div className={`${css.kpi} ${tone ? css[`kpi--${tone}`] : ''}`}>
    <p className={css.kpiLabel}>{label}</p>
    <p className={css.kpiValue}>{value}</p>
  </div>
);

const ErrorBox = ({ error, code }) => {
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

// ==================== main ====================

const AdminPage = () => {
  const scrollingDisabled = useSelector(isScrollingDisabled);
  const location = useLocation();
  const active = getSectionFromLocation(location.search);

  return (
    <Page title="Admin · Xololo" scrollingDisabled={scrollingDisabled}>
      <LayoutSideNavigation
        topbar={
          <TopbarContainer
            mobileRootClassName={css.mobileTopbar}
            desktopClassName={css.desktopTopbar}
          />
        }
        sideNav={
          <>
            <H2 as="h1" className={css.title}>
              Admin
            </H2>
            <TabNav
              rootClassName={css.tabs}
              tabRootClassName={css.tab}
              tabs={SECTIONS.map(s => ({
                text: s.label,
                selected: s.key === active,
                linkProps: {
                  name: 'AdminPage',
                  to: {
                    search: s.key === DEFAULT_SECTION ? '' : `?section=${s.key}`,
                  },
                },
              }))}
              ariaLabel="Navegación admin"
            />
          </>
        }
        footer={<FooterContainer />}
      >
        <div className={css.root}>
          {active === 'disputes' ? (
            <DisputesView />
          ) : active === 'sellers' ? (
            <SellersView />
          ) : (
            <HealthView />
          )}
        </div>
      </LayoutSideNavigation>
    </Page>
  );
};

export default AdminPage;
