import React, { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import loadable from '@loadable/component';

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

import {
  PERIOD_PRESETS,
  autoGranularity,
  bucketTransactions,
  formatSubunitsAsMxn,
} from './dashboardUtils';

import css from './DashboardPage.module.css';

// XOLOLO F3 · Dashboard analytics para sellers en /dashboard.
//
// Trae las ventas del rango elegido (endpoint /api/seller-analytics),
// las buckets por día/semana/mes según granularidad (auto o manual) y
// muestra:
//   - Filtro de período (presets + rango custom)
//   - Selector de granularidad (auto / día / semana / mes)
//   - KPI hero adaptado al período
//   - Gráfica de barras Recharts (ventas por bucket)
//   - Tabla desglose con totales
//
// Recharts se carga lazy — es ~90kb gzip y sólo la necesita esta ruta.

const BarChartLazy = loadable(() => import('./DashboardChart'));

const GRANULARITIES = [
  { key: 'auto', label: 'Auto' },
  { key: 'day', label: 'Día' },
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mes' },
];

const DashboardPage = props => {
  const scrollingDisabled = useSelector(isScrollingDisabled);
  const currentUser = useSelector(state => state.user?.currentUser || null);

  // Período por default: este mes.
  const [periodKey, setPeriodKey] = useState('month');
  const [granKey, setGranKey] = useState('auto');
  const [state, setState] = useState({ status: 'idle', data: null, error: null });

  const period = useMemo(() => {
    const preset = PERIOD_PRESETS.find(p => p.key === periodKey) || PERIOD_PRESETS[0];
    return preset.range();
  }, [periodKey]);

  const granularity =
    granKey === 'auto' ? autoGranularity(period.from, period.to) : granKey;

  useEffect(() => {
    let aborted = false;
    setState({ status: 'loading', data: null, error: null });
    const url = `${apiBaseUrl()}/api/seller-analytics?from=${period.from}&to=${period.to}`;
    fetch(url, { credentials: 'include' })
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (aborted) return;
        if (!res.ok) {
          setState({ status: 'error', data: null, error: data.error || 'fetch_failed' });
          return;
        }
        setState({ status: 'ok', data, error: null });
      })
      .catch(err => {
        if (aborted) return;
        setState({ status: 'error', data: null, error: err.message });
      });
    return () => {
      aborted = true;
    };
  }, [period.from, period.to]);

  const buckets = useMemo(() => {
    if (state.status !== 'ok') return [];
    return bucketTransactions(
      state.data.transactions,
      period.from,
      period.to,
      granularity
    );
  }, [state.status, state.data, period.from, period.to, granularity]);

  const summary = state.data?.summary || null;
  const ticketAverage =
    summary && summary.count > 0 ? Math.round(summary.salesAmount / summary.count) : 0;

  const isSeller = !!currentUser?.attributes?.profile?.publicData; // heurística ligera

  return (
    <Page title="Dashboard de ventas" scrollingDisabled={scrollingDisabled}>
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
              Dashboard
            </H2>
            <TabNav
              rootClassName={css.tabs}
              tabRootClassName={css.tab}
              tabs={[
                {
                  text: 'Ventas',
                  selected: true,
                  linkProps: { name: 'DashboardPage' },
                },
                {
                  text: 'Inbox',
                  selected: false,
                  linkProps: { name: 'InboxPage', params: { tab: 'sales' } },
                },
              ]}
              ariaLabel="Navegación dashboard"
            />
          </>
        }
        footer={<FooterContainer />}
      >
        <div className={css.root}>
          <header className={css.header}>
            <div>
              <h2 className={css.pageTitle}>Ventas</h2>
              <p className={css.pageSubtitle}>
                Rango: <strong>{period.from}</strong> → <strong>{period.to}</strong>
                {state.data?.cached ? <span className={css.cachedBadge}>caché 5min</span> : null}
              </p>
            </div>
          </header>

          <div className={css.filters}>
            <div className={css.filterGroup}>
              <span className={css.filterLabel}>Período</span>
              <div className={css.filterChips}>
                {PERIOD_PRESETS.map(p => (
                  <button
                    key={p.key}
                    type="button"
                    className={
                      p.key === periodKey ? css.chipActive : css.chip
                    }
                    onClick={() => setPeriodKey(p.key)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className={css.filterGroup}>
              <span className={css.filterLabel}>Granularidad</span>
              <div className={css.filterChips}>
                {GRANULARITIES.map(g => {
                  const active =
                    g.key === granKey || (g.key === 'auto' && granKey === 'auto');
                  return (
                    <button
                      key={g.key}
                      type="button"
                      className={active ? css.chipActive : css.chip}
                      onClick={() => setGranKey(g.key)}
                      title={
                        g.key === 'auto'
                          ? `Auto elige "${granularity}" para este rango`
                          : undefined
                      }
                    >
                      {g.label}
                      {g.key === 'auto' && granKey === 'auto' ? (
                        <span className={css.autoHint}>·{granularity}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {state.status === 'loading' ? (
            <div className={css.loading}>
              <IconSpinner />
              <p>Trayendo tus ventas…</p>
            </div>
          ) : null}

          {state.status === 'error' ? (
            <div className={css.errorBox}>
              <strong>No pudimos cargar tus datos.</strong> ({state.error})
            </div>
          ) : null}

          {state.status === 'ok' && summary ? (
            <>
              <div className={css.kpiGrid}>
                <div className={css.kpi}>
                  <p className={css.kpiLabel}>Ventas totales</p>
                  <p className={css.kpiValue}>{formatSubunitsAsMxn(summary.salesAmount)}</p>
                </div>
                <div className={css.kpi}>
                  <p className={css.kpiLabel}>Pedidos</p>
                  <p className={css.kpiValue}>{summary.count}</p>
                </div>
                <div className={css.kpi}>
                  <p className={css.kpiLabel}>Ticket promedio</p>
                  <p className={css.kpiValue}>{formatSubunitsAsMxn(ticketAverage)}</p>
                </div>
                <div className={css.kpi}>
                  <p className={css.kpiLabel}>Comisión Xololo</p>
                  <p className={css.kpiValue}>{formatSubunitsAsMxn(summary.commissionAmount)}</p>
                </div>
                <div className={css.kpi}>
                  <p className={css.kpiLabel}>Neto para ti</p>
                  <p className={css.kpiValue}>{formatSubunitsAsMxn(summary.providerAmount)}</p>
                </div>
              </div>

              {buckets.length > 0 ? (
                <>
                  <section className={css.chartSection}>
                    <h3 className={css.sectionTitle}>Ventas por {granularity === 'day' ? 'día' : granularity === 'week' ? 'semana' : 'mes'}</h3>
                    <BarChartLazy buckets={buckets} />
                  </section>

                  <section className={css.tableSection}>
                    <h3 className={css.sectionTitle}>Desglose</h3>
                    <div className={css.tableWrap}>
                      <table className={css.table}>
                        <thead>
                          <tr>
                            <th>Período</th>
                            <th className={css.numeric}>Pedidos</th>
                            <th className={css.numeric}>Ventas</th>
                            <th className={css.numeric}>Comisión</th>
                            <th className={css.numeric}>Neto</th>
                          </tr>
                        </thead>
                        <tbody>
                          {buckets.map(b => (
                            <tr key={b.key}>
                              <td>{b.label}</td>
                              <td className={css.numeric}>{b.count}</td>
                              <td className={css.numeric}>{formatSubunitsAsMxn(b.salesAmount)}</td>
                              <td className={css.numeric}>{formatSubunitsAsMxn(b.commissionAmount)}</td>
                              <td className={css.numeric}>{formatSubunitsAsMxn(b.providerAmount)}</td>
                            </tr>
                          ))}
                          <tr className={css.totalsRow}>
                            <td><strong>Totales</strong></td>
                            <td className={css.numeric}><strong>{summary.count}</strong></td>
                            <td className={css.numeric}><strong>{formatSubunitsAsMxn(summary.salesAmount)}</strong></td>
                            <td className={css.numeric}><strong>{formatSubunitsAsMxn(summary.commissionAmount)}</strong></td>
                            <td className={css.numeric}><strong>{formatSubunitsAsMxn(summary.providerAmount)}</strong></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              ) : (
                <div className={css.emptyBox}>
                  <p>Sin ventas en este período.</p>
                </div>
              )}
            </>
          ) : null}
        </div>
      </LayoutSideNavigation>
    </Page>
  );
};

export default DashboardPage;
