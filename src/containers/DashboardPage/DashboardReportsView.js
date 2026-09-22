import React, { useMemo, useState } from 'react';

import { apiBaseUrl } from '../../util/api';

import { PERIOD_PRESETS, clampCustomRange } from './dashboardUtils';

import css from './DashboardPage.module.css';

// XOLOLO F3 · Sprint 6: vista "Reportes" del dashboard.
// Bloque A (CSV): botón "Descargar CSV" con selector de período.
// Bloque B (email mensual): mockup + placeholder — el cron real llega
// en el siguiente commit del Sprint 6.

const ymdOf = (date = new Date()) => date.toISOString().slice(0, 10);
const monthsAgo = n => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return ymdOf(d);
};

const DashboardReportsView = () => {
  const [periodKey, setPeriodKey] = useState('last3');
  const [customFrom, setCustomFrom] = useState(monthsAgo(3));
  const [customTo, setCustomTo] = useState(ymdOf());
  const [customError, setCustomError] = useState(null);

  const period = useMemo(() => {
    if (periodKey === 'custom') {
      const clamped = clampCustomRange(customFrom, customTo);
      if (!clamped) {
        setCustomError('Rango inválido — revisa las fechas.');
        return null;
      }
      setCustomError(null);
      return clamped;
    }
    const preset = PERIOD_PRESETS.find(p => p.key === periodKey) || PERIOD_PRESETS[2];
    return preset.range();
  }, [periodKey, customFrom, customTo]);

  const downloadUrl = period
    ? `${apiBaseUrl()}/api/seller-analytics/export?from=${period.from}&to=${period.to}`
    : null;

  const filename = period ? `xololo-ventas-${period.from}_${period.to}.csv` : '';

  return (
    <>
      <header className={css.header}>
        <div>
          <h2 className={css.pageTitle}>Reportes</h2>
          <p className={css.pageSubtitle}>Exporta tu data o programa reportes automáticos.</p>
        </div>
      </header>

      <div className={css.filters}>
        <div className={css.filterGroup}>
          <span className={css.filterLabel}>Período del reporte</span>
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

      <section className={css.chartSection}>
        <h3 className={css.sectionTitle}>Exportar ventas a CSV</h3>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--colorGrey500)' }}>
          Descarga las transacciones del período en formato compatible con Excel MX
          (UTF-8 con BOM).
        </p>
        <div className={css.reportRow}>
          <div className={css.reportRowInfo}>
            {period ? (
              <>
                <p className={css.reportRowTitle}>
                  {period.from} → {period.to}
                </p>
                <p className={css.reportRowMeta}>
                  Se descargará como <code>{filename}</code>
                </p>
              </>
            ) : (
              <p className={css.reportRowMeta}>Selecciona un rango válido arriba.</p>
            )}
          </div>
          {downloadUrl ? (
            <a
              href={downloadUrl}
              className={css.reportBtn}
              download={filename}
              rel="nofollow"
            >
              Descargar CSV
            </a>
          ) : (
            <button type="button" className={css.reportBtn} disabled>
              Descargar CSV
            </button>
          )}
        </div>
        <p style={{ margin: '12px 0 4px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--colorGrey500)', fontWeight: 500 }}>
          Columnas incluidas
        </p>
        <div className={css.csvCols}>
          {[
            'id',
            'fecha_pago',
            'cliente',
            'producto',
            'cantidad',
            'subtotal_mxn',
            'envio_mxn',
            'comision_xololo_mxn',
            'neto_seller_mxn',
            'estado',
            'tracking',
            'source',
          ].map(c => (
            <span key={c} className={css.csvCol}>
              {c}
            </span>
          ))}
        </div>
      </section>

      <section className={css.chartSection}>
        <h3 className={css.sectionTitle}>Reporte mensual por email</h3>
        <div className={css.footNote}>
          <p>
            <strong>Próximamente:</strong> configuración para recibir cada día 1 del mes un
            resumen del mes anterior — ventas totales, top productos, comparativa vs
            mes previo. El cron ya está preparado en el server; el toggle y el envío
            se activan en el próximo deploy.
          </p>
        </div>
      </section>
    </>
  );
};

export default DashboardReportsView;
