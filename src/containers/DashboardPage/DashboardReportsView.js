import React, { useMemo, useState } from 'react'; // React namespace used inside sub-components

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

      <MonthlyEmailBlock />
    </>
  );
};

// XOLOLO F3 Sprint 6B: bloque de email mensual — sólo botón "preview"
// por ahora (el opt-out real por-seller vive en la cuenta del user y
// lo agregaremos en un sprint posterior). El botón dispara
// /api/seller-monthly-report-preview que envía el email al user
// logueado con el reporte del mes anterior.
const MonthlyEmailBlock = () => {
  const [status, setStatus] = React.useState({ state: 'idle', message: null });

  const sendPreview = async () => {
    setStatus({ state: 'loading', message: null });
    try {
      const res = await fetch(`${apiBaseUrl()}/api/seller-monthly-report-preview`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus({ state: 'error', message: data.error || data.details || 'Falló el envío.' });
        return;
      }

      // XOLOLO P1: mostramos el estado REAL del envío.
      // - sent:true + mode:'resend' → llegó a Resend, esperar bandeja.
      // - sent:false + mode:'log_only' → falta RESEND_API_KEY en el env.
      // - sent:false + error → Resend rechazó (dominio no verificado, etc).
      // - sent:false + no recipientEmail → el user no tiene email registrado.
      if (data.sent) {
        setStatus({
          state: 'ok',
          message:
            `Enviado a ${data.recipientEmail || 'tu correo'} — resumen de ${data.monthLabel} ` +
            `con ${data.count} pedidos. Revisa bandeja de entrada y carpeta de spam.`,
        });
        return;
      }
      // sent:false — reportar por qué.
      let reason;
      if (data.mode === 'log_only') {
        reason =
          'El servidor no tiene RESEND_API_KEY configurado — el email quedó sólo en logs, no se envió realmente. ' +
          'Configúralo en el env de Render.';
      } else if (!data.recipientEmail) {
        reason = 'No hay email registrado para tu cuenta.';
      } else if (data.error) {
        reason = `Resend rechazó el envío: ${data.error}`;
      } else {
        reason = 'El email no se envió (razón desconocida). Revisa los logs del server.';
      }
      setStatus({ state: 'error', message: reason });
    } catch (e) {
      setStatus({ state: 'error', message: e?.message || 'Falló el envío.' });
    }
  };

  return (
    <section className={css.chartSection}>
      <h3 className={css.sectionTitle}>Reporte mensual por email</h3>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--colorGrey500)' }}>
        Cada día 1 del mes te llegará un resumen del mes anterior — ventas totales,
        top productos, comparativa vs mes previo. Puedes enviarte uno de prueba
        ahora mismo.
      </p>
      <div className={css.reportRow}>
        <div className={css.reportRowInfo}>
          <p className={css.reportRowTitle}>Enviarme un reporte de prueba</p>
          <p className={css.reportRowMeta}>
            Genera el resumen del mes anterior y lo envía a tu correo registrado.
          </p>
        </div>
        <button
          type="button"
          className={css.reportBtn}
          onClick={sendPreview}
          disabled={status.state === 'loading'}
        >
          {status.state === 'loading' ? 'Enviando…' : 'Enviar prueba'}
        </button>
      </div>
      {status.state === 'ok' ? (
        <p style={{ margin: '10px 0 0', fontSize: 13, color: '#065f46' }}>
          ✓ {status.message}
        </p>
      ) : null}
      {status.state === 'error' ? (
        <p style={{ margin: '10px 0 0', fontSize: 13, color: '#991b1b' }}>
          ✗ {status.message}
        </p>
      ) : null}
      <p className={css.alertsFoot} style={{ marginTop: 10 }}>
        El envío programado del día 1 está gated por MONTHLY_REPORT_ENABLED en Render —
        se activará una vez validado el template. Por ahora sólo el botón de prueba manda.
      </p>
    </section>
  );
};

export default DashboardReportsView;
