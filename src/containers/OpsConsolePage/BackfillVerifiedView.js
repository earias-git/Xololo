import React, { useCallback, useEffect, useState } from 'react';

import { apiBaseUrl } from '../../util/api';

import css from './OpsConsolePage.module.css';

// XOLOLO Task #22: backfill del badge Xololo Verified.
//
// Flujo:
//   1. Dry-run al mount → cuenta cuántos sellers cambiarían Y muestra
//      hasta 10 ejemplos. NO modifica nada.
//   2. Ops valida y hace click en "Ejecutar backfill real" → confirma
//      en un prompt del browser, luego el server itera y sincroniza
//      cada seller con syncVerifiedBadge (idempotente).
//   3. Al terminar, muestra el resumen final (becameVerified / lost /
//      noChange / errorCount).

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

const BackfillVerifiedView = ({ onBack }) => {
  const [dryRun, setDryRun] = useState({ loading: true, data: null, error: null });
  const [runResult, setRunResult] = useState({ loading: false, data: null, error: null });

  const loadDryRun = useCallback(async () => {
    setDryRun({ loading: true, data: null, error: null });
    const { ok, data } = await api('/api/admin/backfill-verified-badge/dry-run');
    if (!ok) {
      setDryRun({ loading: false, data: null, error: data?.error || 'load_failed' });
      return;
    }
    setDryRun({ loading: false, data, error: null });
  }, []);

  useEffect(() => {
    loadDryRun();
  }, [loadDryRun]);

  const executeRun = async () => {
    const d = dryRun.data;
    const expectedChanges = (d?.wouldBecomeVerified || 0) + (d?.wouldLoseVerified || 0);
    if (!window.confirm(
      `¿Ejecutar backfill en ${d?.total || 0} sellers?\n\n` +
      `• ${d?.wouldBecomeVerified || 0} ganarán el badge\n` +
      `• ${d?.wouldLoseVerified || 0} perderán el badge\n` +
      `• ${d?.noChange || 0} quedan igual\n\n` +
      `El sync es idempotente. Puede tardar 1-5 min.`
    )) return;

    setRunResult({ loading: true, data: null, error: null });
    const { ok, data } = await api('/api/admin/backfill-verified-badge/run', { method: 'POST' });
    if (!ok) {
      setRunResult({ loading: false, data: null, error: data?.error || 'run_failed' });
      return;
    }
    setRunResult({ loading: false, data, error: null });
    // Re-dry-run para refrescar el estado actual.
    loadDryRun();
  };

  return (
    <div className={css.viewRoot}>
      <div className={css.viewHeader}>
        <button type="button" className={css.backBtn} onClick={onBack}>
          ← Dashboard
        </button>
        <h2 className={css.viewTitle}>Backfill Xololo Verified</h2>
      </div>

      <p className={css.lead}>
        Re-evalúa a todos los sellers del marketplace y sincroniza el badge
        <code> xololoVerified</code>. Los criterios actuales viven en
        <code> server/api-util/sellerVerified.js</code>. Idempotente —
        sellers que ya están correctos no se tocan.
      </p>

      {/* ----- Dry-run ----- */}
      {dryRun.loading ? (
        <p className={css.loading}>Calculando dry-run…</p>
      ) : dryRun.error ? (
        <p className={css.error}>Error: {dryRun.error}</p>
      ) : (
        <>
          <div className={css.statCardRow}>
            <div className={css.statCard}>
              <span className={css.statLabel}>Total sellers</span>
              <span className={css.statValue}>{dryRun.data.total}</span>
            </div>
            <div className={css.statCard}>
              <span className={css.statLabel}>Ganarán badge</span>
              <span className={`${css.statValue} ${css.gateReady}`}>
                +{dryRun.data.wouldBecomeVerified}
              </span>
            </div>
            <div className={css.statCard}>
              <span className={css.statLabel}>Perderán badge</span>
              <span className={`${css.statValue} ${css.gateBlocked}`}>
                −{dryRun.data.wouldLoseVerified}
              </span>
            </div>
            <div className={css.statCard}>
              <span className={css.statLabel}>Sin cambios</span>
              <span className={css.statValue}>{dryRun.data.noChange}</span>
            </div>
          </div>

          {dryRun.data.samples?.length > 0 ? (
            <>
              <h3 className={css.sectionTitle}>Primeros {dryRun.data.samples.length} que cambiarían</h3>
              <table className={css.table}>
                <thead>
                  <tr>
                    <th>Seller</th>
                    <th>Email</th>
                    <th>Antes</th>
                    <th>Después</th>
                    <th>Cambio</th>
                  </tr>
                </thead>
                <tbody>
                  {dryRun.data.samples.map(s => (
                    <tr key={s.sellerId}>
                      <td>{s.displayName}</td>
                      <td className={css.sellerEmail}>{s.email || '—'}</td>
                      <td>{s.was ? '✓' : '✗'}</td>
                      <td>{s.willBe ? '✓' : '✗'}</td>
                      <td>
                        {s.change === 'become_verified' ? (
                          <span className={css.gateReady}>+ gana badge</span>
                        ) : (
                          <span className={css.gateBlocked}>− pierde badge</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className={css.empty}>
              Nada que hacer — todos los sellers tienen el badge correctamente
              sincronizado.
            </p>
          )}

          {dryRun.data.wouldBecomeVerified + dryRun.data.wouldLoseVerified > 0 ? (
            <div className={css.ctaRow}>
              <button
                type="button"
                className={css.primaryBtn}
                disabled={runResult.loading}
                onClick={executeRun}
              >
                {runResult.loading
                  ? 'Ejecutando backfill…'
                  : '🔄 Ejecutar backfill real'}
              </button>
              <button
                type="button"
                className={css.backBtn}
                onClick={loadDryRun}
                disabled={runResult.loading}
              >
                ↻ Recalcular dry-run
              </button>
            </div>
          ) : null}
        </>
      )}

      {/* ----- Resultado del run ----- */}
      {runResult.error ? (
        <p className={css.error}>Error al ejecutar: {runResult.error}</p>
      ) : null}
      {runResult.data ? (
        <div className={css.aiReviewBlock}>
          <h3 className={css.sectionTitle}>Resultado del último backfill</h3>
          <p>
            <strong>{runResult.data.becameVerified}</strong> ganaron badge ·{' '}
            <strong>{runResult.data.lostVerified}</strong> lo perdieron ·{' '}
            <strong>{runResult.data.noChange}</strong> sin cambio ·{' '}
            <strong>{runResult.data.errorCount}</strong> errores
          </p>
          <p className={css.sellerEmail}>
            Inició {runResult.data.startedAt} · Terminó {runResult.data.finishedAt}
          </p>
          {runResult.data.errors?.length > 0 ? (
            <details>
              <summary>Ver errores ({runResult.data.errors.length})</summary>
              <ul>
                {runResult.data.errors.map((e, i) => (
                  <li key={i}>{e.sellerId}: {e.error}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default BackfillVerifiedView;
