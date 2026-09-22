import React, { useEffect, useMemo, useState } from 'react';
import loadable from '@loadable/component';

import { apiBaseUrl } from '../../util/api';

import { IconSpinner } from '../../components';

import {
  PERIOD_PRESETS,
  autoGranularity,
  bucketTransactions,
  formatSubunitsAsMxn,
  previousPeriodOf,
  computeDelta,
  clampCustomRange,
} from './dashboardUtils';

import css from './DashboardPage.module.css';

// XOLOLO F3 · Vista "Ventas" del dashboard. Extraída de DashboardPage
// para separar responsabilidades — cada vista maneja su propio
// fetch/state y comparte los filtros del wrapper.

const BarChartLazy = loadable(() => import('./DashboardChart'));

const GRANULARITIES = [
  { key: 'auto', label: 'Auto' },
  { key: 'day', label: 'Día' },
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mes' },
];

const METRICS = [
  { key: 'salesAmount', label: 'Ventas MXN', money: true },
  { key: 'count', label: 'Pedidos', money: false },
  { key: 'ticketAverage', label: 'Ticket promedio', money: true },
  { key: 'providerAmount', label: 'Neto', money: true },
];

const ymdOf = (date = new Date()) => date.toISOString().slice(0, 10);
const monthsAgo = n => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return ymdOf(d);
};

const fetchAnalytics = async ({ from, to }) => {
  const url = `${apiBaseUrl()}/api/seller-analytics?from=${from}&to=${to}`;
  const res = await fetch(url, { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'fetch_failed');
    err.status = res.status;
    throw err;
  }
  return data;
};

const enrichBucketsWithTicket = buckets =>
  buckets.map(b => ({
    ...b,
    ticketAverage: b.count > 0 ? Math.round(b.salesAmount / b.count) : 0,
  }));

const KpiCard = ({ label, value, delta }) => {
  let deltaEl = null;
  if (delta) {
    if (delta.isNew) {
      deltaEl = <span className={`${css.kpiDelta} ${css.kpiDeltaNew}`}>nuevo</span>;
    } else if (delta.direction === 'up') {
      deltaEl = <span className={`${css.kpiDelta} ${css.kpiDeltaUp}`}>↑ {delta.pct}%</span>;
    } else if (delta.direction === 'down') {
      deltaEl = <span className={`${css.kpiDelta} ${css.kpiDeltaDown}`}>↓ {Math.abs(delta.pct)}%</span>;
    } else {
      deltaEl = <span className={`${css.kpiDelta} ${css.kpiDeltaFlat}`}>— sin cambio</span>;
    }
  }
  return (
    <div className={css.kpi}>
      <p className={css.kpiLabel}>{label}</p>
      <p className={css.kpiValue}>{value}</p>
      {deltaEl}
    </div>
  );
};

const DashboardSalesView = () => {
  const [periodKey, setPeriodKey] = useState('month');
  const [customFrom, setCustomFrom] = useState(monthsAgo(1));
  const [customTo, setCustomTo] = useState(ymdOf());
  const [customError, setCustomError] = useState(null);
  const [granKey, setGranKey] = useState('auto');
  const [metricKey, setMetricKey] = useState('salesAmount');
  const [current, setCurrent] = useState({ status: 'idle', data: null, error: null });
  const [previous, setPrevious] = useState({ status: 'idle', data: null });

  const period = useMemo(() => {
    if (periodKey === 'custom') {
      const clamped = clampCustomRange(customFrom, customTo);
      if (!clamped) return null;
      return clamped;
    }
    const preset = PERIOD_PRESETS.find(p => p.key === periodKey) || PERIOD_PRESETS[0];
    return preset.range();
  }, [periodKey, customFrom, customTo]);

  const granularity =
    granKey === 'auto' ? (period ? autoGranularity(period.from, period.to) : 'day') : granKey;

  useEffect(() => {
    if (!period) {
      setCustomError('Rango inválido — revisa las fechas.');
      return;
    }
    setCustomError(null);
    let aborted = false;
    setCurrent({ status: 'loading', data: null, error: null });
    setPrevious({ status: 'loading', data: null });

    const prev = previousPeriodOf(period);

    Promise.allSettled([fetchAnalytics(period), fetchAnalytics(prev)]).then(([curR, prevR]) => {
      if (aborted) return;
      if (curR.status === 'fulfilled') {
        setCurrent({ status: 'ok', data: curR.value, error: null });
      } else {
        setCurrent({
          status: 'error',
          data: null,
          error: curR.reason?.message || 'fetch_failed',
        });
      }
      if (prevR.status === 'fulfilled') {
        setPrevious({ status: 'ok', data: prevR.value });
      } else {
        setPrevious({ status: 'error', data: null });
      }
    });
    return () => {
      aborted = true;
    };
  }, [period?.from, period?.to]);

  const buckets = useMemo(() => {
    if (current.status !== 'ok' || !period) return [];
    const raw = bucketTransactions(current.data.transactions, period.from, period.to, granularity);
    return enrichBucketsWithTicket(raw);
  }, [current.status, current.data, period, granularity]);

  const summary = current.data?.summary || null;
  const ticketAverage =
    summary && summary.count > 0 ? Math.round(summary.salesAmount / summary.count) : 0;
  const prevSummary = previous.data?.summary || null;
  const prevTicketAverage =
    prevSummary && prevSummary.count > 0
      ? Math.round(prevSummary.salesAmount / prevSummary.count)
      : 0;

  const deltas = useMemo(() => {
    if (previous.status !== 'ok' || !summary || !prevSummary) return null;
    return {
      salesAmount: computeDelta(summary.salesAmount, prevSummary.salesAmount),
      count: computeDelta(summary.count, prevSummary.count),
      ticketAverage: computeDelta(ticketAverage, prevTicketAverage),
      commissionAmount: computeDelta(summary.commissionAmount, prevSummary.commissionAmount),
      providerAmount: computeDelta(summary.providerAmount, prevSummary.providerAmount),
    };
  }, [previous.status, summary, prevSummary, ticketAverage, prevTicketAverage]);

  const activeMetric = METRICS.find(m => m.key === metricKey) || METRICS[0];

  return (
    <>
      <header className={css.header}>
        <div>
          <h2 className={css.pageTitle}>Ventas</h2>
          <p className={css.pageSubtitle}>
            {period ? (
              <>
                Rango: <strong>{period.from}</strong> → <strong>{period.to}</strong>
                {current.data?.cached ? <span className={css.cachedBadge}>caché 5min</span> : null}
              </>
            ) : (
              <span>Ajusta el rango arriba.</span>
            )}
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
                className={p.key === periodKey ? css.chipActive : css.chip}
                onClick={() => setPeriodKey(p.key)}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              className={periodKey === 'custom' ? css.chipActive : css.chip}
              onClick={() => setPeriodKey('custom')}
            >
              Personalizado
            </button>
          </div>
          {periodKey === 'custom' ? (
            <div className={css.customRange}>
              <input
                type="date"
                value={customFrom}
                max={customTo}
                onChange={e => setCustomFrom(e.target.value)}
                aria-label="Desde"
              />
              <span aria-hidden>→</span>
              <input
                type="date"
                value={customTo}
                min={customFrom}
                max={ymdOf()}
                onChange={e => setCustomTo(e.target.value)}
                aria-label="Hasta"
              />
              {customError ? <span className={css.customError}>{customError}</span> : null}
            </div>
          ) : null}
        </div>
        <div className={css.filterGroup}>
          <span className={css.filterLabel}>Granularidad</span>
          <div className={css.filterChips}>
            {GRANULARITIES.map(g => {
              const active = g.key === granKey;
              return (
                <button
                  key={g.key}
                  type="button"
                  className={active ? css.chipActive : css.chip}
                  onClick={() => setGranKey(g.key)}
                  title={g.key === 'auto' ? `Auto elige "${granularity}" para este rango` : undefined}
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

      {current.status === 'loading' ? (
        <div className={css.loading}>
          <IconSpinner />
          <p>Trayendo tus ventas…</p>
        </div>
      ) : null}

      {current.status === 'error' ? (
        <div className={css.errorBox}>
          <strong>No pudimos cargar tus datos.</strong> ({current.error})
        </div>
      ) : null}

      {current.status === 'ok' && summary ? (
        <>
          <div className={css.kpiGrid}>
            <KpiCard label="Ventas totales" value={formatSubunitsAsMxn(summary.salesAmount)} delta={deltas?.salesAmount} />
            <KpiCard label="Pedidos" value={summary.count} delta={deltas?.count} />
            <KpiCard label="Ticket promedio" value={formatSubunitsAsMxn(ticketAverage)} delta={deltas?.ticketAverage} />
            <KpiCard label="Comisión Xololo" value={formatSubunitsAsMxn(summary.commissionAmount)} delta={deltas?.commissionAmount} />
            <KpiCard label="Neto para ti" value={formatSubunitsAsMxn(summary.providerAmount)} delta={deltas?.providerAmount} />
          </div>

          {buckets.length > 0 ? (
            <>
              <section className={css.chartSection}>
                <div className={css.chartHeader}>
                  <h3 className={css.sectionTitle}>
                    {activeMetric.label} por{' '}
                    {granularity === 'day' ? 'día' : granularity === 'week' ? 'semana' : 'mes'}
                  </h3>
                  <div className={css.metricToggle} role="tablist" aria-label="Métrica">
                    {METRICS.map(m => (
                      <button
                        key={m.key}
                        type="button"
                        className={m.key === metricKey ? css.metricOn : css.metricOff}
                        onClick={() => setMetricKey(m.key)}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
                <BarChartLazy
                  buckets={buckets}
                  metricKey={activeMetric.key}
                  metricIsMoney={activeMetric.money}
                />
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
    </>
  );
};

export default DashboardSalesView;
