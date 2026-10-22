import React, { useCallback, useEffect, useState } from 'react';

import { apiBaseUrl } from '../../util/api';

import css from './OpsConsolePage.module.css';

// XOLOLO Track #27 Fase 2 — cola de sellers con dinero retenido en Xololo.
//
// Lista cada seller con pendientes de payout, su estado del gate
// (stripe + docs) y botón para liberar el pago cuando el gate ya cerró.
// Los que YA pueden recibir pago aparecen primero (prioridad de proceso);
// los que todavía no, abajo con sus blockers visibles.
//
// Liberar NO ejecuta el transfer real — solo marca metadata
// xololoPayoutReleased=true. Contabilidad procesa el batch desde Stripe
// dashboard o con script dedicado. En Fase 3 se automatiza con cron.

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

const formatPesos = subunits => {
  if (!Number.isFinite(subunits)) return '—';
  const pesos = Math.round(subunits / 100);
  return `$${new Intl.NumberFormat('es-MX').format(pesos)} MXN`;
};

const formatDate = iso => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('es-MX', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    });
  } catch (_) {
    return iso.slice(0, 10);
  }
};

const BLOCKER_LABELS = {
  stripe: 'Cuenta bancaria',
  legalDocs: 'Docs legales',
};

const PayoutQueueView = ({ onBack }) => {
  const [state, setState] = useState({ loading: true, items: [], totalPending: 0, error: null });
  const [releasingId, setReleasingId] = useState(null);

  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: null }));
    const { ok, data } = await api('/api/admin/payout-queue');
    if (!ok) {
      setState({ loading: false, items: [], totalPending: 0, error: data?.error || 'error' });
      return;
    }
    setState({
      loading: false,
      items: data.items || [],
      totalPending: data.totalPending || 0,
      error: null,
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const release = async item => {
    if (!window.confirm(`¿Liberar ${formatPesos(item.pendingAmountSubunits)} para ${item.sellerName || item.sellerEmail}? Se intentará el transfer real a su cuenta Stripe Connect.`)) {
      return;
    }
    setReleasingId(item.sellerId);
    const { ok, data } = await api('/api/admin/payout-queue/release', {
      method: 'POST',
      body: {
        sellerId: item.sellerId,
        txIds: item.txIds,
        note: `Liberado desde /ops/payout-queue (${new Date().toISOString()})`,
      },
    });
    setReleasingId(null);
    if (!ok) {
      alert(`Error al liberar: ${data?.error || 'desconocido'}`);
      return;
    }
    const transferred = data.transferredCount || 0;
    const failed = data.failedCount || 0;
    if (failed > 0) {
      const firstErr = (data.results || []).find(r => r.transferError)?.transferError;
      alert(
        `Liberadas ${data.releasedCount} tx. Transfers exitosos: ${transferred}, fallidos: ${failed}.\n\nPrimer error: ${firstErr || 'desconocido'}\n\nUsa "Reintentar transfer" después de corregir.`
      );
    } else {
      alert(`Liberadas ${data.releasedCount} tx. Transfers exitosos: ${transferred}.`);
    }
    load();
  };

  const retry = async item => {
    if (!item.failedTxIds?.length) return;
    if (!window.confirm(`¿Reintentar transfer de ${item.failedTransferCount} tx fallidas para ${item.sellerName || item.sellerEmail}?`)) {
      return;
    }
    setReleasingId(item.sellerId);
    const { ok, data } = await api('/api/admin/payout-queue/retry', {
      method: 'POST',
      body: { sellerId: item.sellerId, txIds: item.failedTxIds },
    });
    setReleasingId(null);
    if (!ok) {
      alert(`Error al reintentar: ${data?.error || 'desconocido'}`);
      return;
    }
    const transferred = data.transferredCount || 0;
    const failed = data.failedCount || 0;
    if (failed > 0) {
      const firstErr = (data.results || []).find(r => r.transferError)?.transferError;
      alert(`Reintento: ${transferred} exitosos, ${failed} fallidos.\nPrimer error: ${firstErr || 'desconocido'}`);
    } else {
      alert(`Reintento exitoso: ${transferred} transfers completados.`);
    }
    load();
  };

  return (
    <div className={css.viewRoot}>
      <div className={css.viewHeader}>
        <button type="button" className={css.backBtn} onClick={onBack}>
          ← Dashboard
        </button>
        <h2 className={css.viewTitle}>Cola de payouts retenidos</h2>
      </div>

      {state.loading ? (
        <p className={css.loading}>Cargando…</p>
      ) : state.error ? (
        <p className={css.error}>Error: {state.error}</p>
      ) : (
        <>
          <div className={css.statCardRow}>
            <div className={css.statCard}>
              <span className={css.statLabel}>Total retenido</span>
              <span className={css.statValue}>{formatPesos(state.totalPending)}</span>
            </div>
            <div className={css.statCard}>
              <span className={css.statLabel}>Sellers esperando</span>
              <span className={css.statValue}>{state.items.length}</span>
            </div>
          </div>

          {state.items.length === 0 ? (
            <p className={css.empty}>Sin payouts retenidos. Todos los sellers con ventas tienen el gate cerrado.</p>
          ) : (
            <table className={css.table}>
              <thead>
                <tr>
                  <th>Seller</th>
                  <th>Modo</th>
                  <th>Pendiente</th>
                  <th>Ventas</th>
                  <th>Más vieja</th>
                  <th>Gate</th>
                  <th>Transfer</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {state.items.map(item => {
                  const hasFailedTransfers = item.failedTransferCount > 0;
                  return (
                    <tr key={item.sellerId}>
                      <td>
                        <div className={css.sellerName}>{item.sellerName || '—'}</div>
                        <div className={css.sellerEmail}>{item.sellerEmail || '—'}</div>
                      </td>
                      <td>{item.sellerMode}</td>
                      <td className={css.amountCell}>{formatPesos(item.pendingAmountSubunits)}</td>
                      <td>{item.pendingCount}</td>
                      <td>{formatDate(item.oldestPendingAt)}</td>
                      <td>
                        {item.canReceivePayout ? (
                          <span className={css.gateReady}>✓ Listo</span>
                        ) : (
                          <span className={css.gateBlocked}>
                            Falta: {item.blockers.map(b => BLOCKER_LABELS[b] || b).join(', ')}
                          </span>
                        )}
                      </td>
                      <td>
                        {hasFailedTransfers ? (
                          <span className={css.gateBlocked} title={item.lastTransferError || ''}>
                            ✗ {item.failedTransferCount} fallidos
                          </span>
                        ) : (
                          <span className={css.notReady}>—</span>
                        )}
                      </td>
                      <td>
                        {hasFailedTransfers ? (
                          <button
                            type="button"
                            className={css.primaryBtn}
                            disabled={releasingId === item.sellerId}
                            onClick={() => retry(item)}
                          >
                            {releasingId === item.sellerId ? 'Reintentando…' : 'Reintentar transfer'}
                          </button>
                        ) : item.canReceivePayout ? (
                          <button
                            type="button"
                            className={css.primaryBtn}
                            disabled={releasingId === item.sellerId}
                            onClick={() => release(item)}
                          >
                            {releasingId === item.sellerId ? 'Liberando…' : 'Liberar + transferir'}
                          </button>
                        ) : (
                          <span className={css.notReady}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
};

export default PayoutQueueView;
