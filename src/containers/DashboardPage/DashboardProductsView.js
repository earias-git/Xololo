import React, { useEffect, useMemo, useState } from 'react';

import { apiBaseUrl } from '../../util/api';

import { IconSpinner } from '../../components';

import {
  PERIOD_PRESETS,
  formatSubunitsAsMxn,
  clampCustomRange,
} from './dashboardUtils';

import css from './DashboardPage.module.css';

// XOLOLO F3 · Sprint 3: vista "Productos" del dashboard.
// Consume /api/seller-catalog-insights con el rango elegido.
// 3 bloques:
//   - Top products by sales (tabla ordenada por revenue con % del total)
//   - Alertas: low stock / stale / sin ventas
// Comparte los presets de período con Ventas. No usa granularidad ni
// gráficas (Sprint 4 agregará el segundo bloque de top by views).

const ymdOf = (date = new Date()) => date.toISOString().slice(0, 10);
const monthsAgo = n => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return ymdOf(d);
};

const fetchInsights = async ({ from, to }) => {
  const url = `${apiBaseUrl()}/api/seller-catalog-insights?from=${from}&to=${to}`;
  const res = await fetch(url, { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'fetch_failed');
    err.status = res.status;
    throw err;
  }
  return data;
};

// Thumb fallback cuando el listing no tiene imagen.
const Thumb = ({ url, title }) => (
  <span className={css.thumb} aria-hidden>
    {url ? (
      <img src={url} alt="" />
    ) : (
      <span className={css.thumbEmpty} title={title || ''}>📦</span>
    )}
  </span>
);

const AlertRow = ({ variant, title, image, meta, cta, href }) => (
  <li className={`${css.alertRow} ${css[`alertRow--${variant}`]}`}>
    <Thumb url={image} title={title} />
    <div className={css.alertMain}>
      <p className={css.alertTitle}>{title}</p>
      <p className={css.alertMeta}>{meta}</p>
    </div>
    {href ? (
      <a href={href} className={css.alertCta}>{cta}</a>
    ) : (
      <span className={css.alertCta}>{cta}</span>
    )}
  </li>
);

const DashboardProductsView = () => {
  const [periodKey, setPeriodKey] = useState('last3');
  const [customFrom, setCustomFrom] = useState(monthsAgo(3));
  const [customTo, setCustomTo] = useState(ymdOf());
  const [customError, setCustomError] = useState(null);
  const [state, setState] = useState({ status: 'idle', data: null, error: null });

  const period = useMemo(() => {
    if (periodKey === 'custom') {
      const clamped = clampCustomRange(customFrom, customTo);
      if (!clamped) return null;
      return clamped;
    }
    const preset = PERIOD_PRESETS.find(p => p.key === periodKey) || PERIOD_PRESETS[2];
    return preset.range();
  }, [periodKey, customFrom, customTo]);

  useEffect(() => {
    if (!period) {
      setCustomError('Rango inválido — revisa las fechas.');
      return;
    }
    setCustomError(null);
    let aborted = false;
    setState({ status: 'loading', data: null, error: null });
    fetchInsights(period).then(
      data => {
        if (aborted) return;
        setState({ status: 'ok', data, error: null });
      },
      err => {
        if (aborted) return;
        setState({ status: 'error', data: null, error: err?.message || 'fetch_failed' });
      }
    );
    return () => {
      aborted = true;
    };
  }, [period?.from, period?.to]);

  const data = state.data;
  const top = data?.topBySales || [];
  const alerts = data?.alerts || { lowStock: [], stale: [], noSales: [] };
  const totals = data?.totals || null;
  const hasAnyAlert = alerts.lowStock.length + alerts.stale.length + alerts.noSales.length > 0;

  return (
    <>
      <header className={css.header}>
        <div>
          <h2 className={css.pageTitle}>Productos</h2>
          <p className={css.pageSubtitle}>
            {period ? (
              <>
                Rango: <strong>{period.from}</strong> → <strong>{period.to}</strong>
                {data?.cached ? <span className={css.cachedBadge}>caché 5min</span> : null}
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
              <input type="date" value={customFrom} max={customTo} onChange={e => setCustomFrom(e.target.value)} aria-label="Desde" />
              <span aria-hidden>→</span>
              <input type="date" value={customTo} min={customFrom} max={ymdOf()} onChange={e => setCustomTo(e.target.value)} aria-label="Hasta" />
              {customError ? <span className={css.customError}>{customError}</span> : null}
            </div>
          ) : null}
        </div>
      </div>

      {state.status === 'loading' ? (
        <div className={css.loading}>
          <IconSpinner />
          <p>Trayendo tu catálogo…</p>
        </div>
      ) : null}

      {state.status === 'error' ? (
        <div className={css.errorBox}>
          <strong>No pudimos cargar tus productos.</strong> ({state.error})
        </div>
      ) : null}

      {state.status === 'ok' ? (
        <>
          <section className={css.chartSection}>
            <h3 className={css.sectionTitle}>Top productos por ventas</h3>
            {top.length === 0 ? (
              <div className={css.emptyBox}>
                <p>Sin ventas en este período.</p>
              </div>
            ) : (
              <div className={css.tableWrap}>
                <table className={css.table}>
                  <thead>
                    <tr>
                      <th style={{ width: '48%' }}>Producto</th>
                      <th className={css.numeric}>Vendidos</th>
                      <th className={css.numeric}>Revenue</th>
                      <th className={css.numeric}>% del total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top.map(p => (
                      <tr key={p.listingId}>
                        <td>
                          <div className={css.prodCell}>
                            <Thumb url={p.imageUrl} title={p.title} />
                            <span className={css.prodTitle}>{p.title}</span>
                          </div>
                        </td>
                        <td className={css.numeric}>{p.unitsSold}</td>
                        <td className={css.numeric}>{formatSubunitsAsMxn(p.revenueAmount)}</td>
                        <td className={css.numeric}>
                          <div className={css.pctBar}>
                            <span className={css.pctBarFill} style={{ width: `${Math.min(100, p.pctOfTotal)}%` }} />
                            <span className={css.pctBarText}>{p.pctOfTotal}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {totals ? (
                      <tr className={css.totalsRow}>
                        <td><strong>Total ({top.length} de {totals.listingsCount})</strong></td>
                        <td className={css.numeric}><strong>{totals.unitsSold}</strong></td>
                        <td className={css.numeric}><strong>{formatSubunitsAsMxn(totals.salesAmount)}</strong></td>
                        <td className={css.numeric}>—</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className={css.chartSection}>
            <h3 className={css.sectionTitle}>Alertas de catálogo</h3>
            {!hasAnyAlert ? (
              <div className={css.emptyBox}>
                <p>Tu catálogo está al día 👍</p>
              </div>
            ) : (
              <ul className={css.alertsList}>
                {alerts.lowStock.map(a => (
                  <AlertRow
                    key={`low-${a.listingId}`}
                    variant="danger"
                    title={a.title}
                    image={a.imageUrl}
                    meta={`Stock bajo — quedan ${a.stock}`}
                    cta="Reponer"
                    href={`/l/product/${a.listingId}`}
                  />
                ))}
                {alerts.stale.map(a => (
                  <AlertRow
                    key={`stale-${a.listingId}`}
                    variant="warn"
                    title={a.title}
                    image={a.imageUrl}
                    meta={`Sin actualizar hace ${a.daysSince} días`}
                    cta="Editar"
                    href={`/l/product/${a.listingId}`}
                  />
                ))}
                {alerts.noSales.map(a => (
                  <AlertRow
                    key={`ns-${a.listingId}`}
                    variant="muted"
                    title={a.title}
                    image={a.imageUrl}
                    meta={`Sin ventas hace ${a.daysSince} días`}
                    cta="Revisar"
                    href={`/l/product/${a.listingId}`}
                  />
                ))}
              </ul>
            )}
            <p className={css.alertsFoot}>
              Se muestran hasta 20 alertas por tipo. Los conteos completos aparecen cuando corrijas éstas.
            </p>
          </section>

          <div className={css.footNote}>
            <p>
              <strong>Próximo sprint:</strong> Top productos por <em>vistas</em> con conversion rate.
              El agregador de tracking ya está recolectando datos — la sección aparecerá cuando haya
              suficiente muestra.
            </p>
          </div>
        </>
      ) : null}
    </>
  );
};

export default DashboardProductsView;
