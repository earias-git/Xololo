import React, { useCallback, useEffect, useState } from 'react';

import { apiBaseUrl } from '../../util/api';

import css from './UsersView.module.css';

// XOLOLO OPS Users 360 · Fase C — viewer dedicado del audit log global.
// Agrega metadata.xololoOps.audit entries de todos los users y lista con
// filtros (actor, action, userId, days).

const api = async path => {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method: 'GET',
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
};

const timeAgo = iso => {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'ahora';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `hace ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `hace ${d}d`;
  return `hace ${Math.floor(d / 30)}mo`;
};

const AuditLogView = ({ onBack }) => {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [days, setDays] = useState(7);
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    const qs = new URLSearchParams({
      days: String(days),
      page: String(page),
      pageSize: '50',
    });
    if (actor.trim()) qs.set('actorEmail', actor.trim());
    if (action.trim()) qs.set('action', action.trim());
    setState(s => ({ ...s, loading: true }));
    api(`/api/admin/ops/audit-log?${qs}`).then(
      r => {
        if (!r.ok) {
          setState({ loading: false, data: null, error: r.data?.error || 'load_failed' });
          return;
        }
        setState({ loading: false, data: r.data, error: null });
      },
      e => setState({ loading: false, data: null, error: e.message })
    );
  }, [actor, action, days, page]);

  useEffect(load, [load]);

  const d = state.data;
  const totalPages = d ? Math.max(1, Math.ceil(d.filteredTotal / 50)) : 1;

  return (
    <div className={css.root}>
      <header className={css.header}>
        <div>
          <h1 className={css.title}>Audit log OPS</h1>
          <p className={css.subtitle}>
            {d
              ? `${d.filteredTotal.toLocaleString('es-MX')} eventos en los últimos ${d.days} días (de ${d.total.toLocaleString('es-MX')} totales)`
              : 'Cargando…'}
          </p>
        </div>
        <div className={css.headerActions}>
          <button type="button" className={css.secondaryBtn} onClick={load}>
            🔄 Refrescar
          </button>
          <button type="button" className={css.secondaryBtn} onClick={onBack}>
            ← Volver
          </button>
        </div>
      </header>

      <div className={css.auditFilters}>
        <input
          type="search"
          placeholder="Email del operator"
          value={actor}
          onChange={e => {
            setActor(e.target.value);
            setPage(1);
          }}
        />
        <select
          value={action}
          onChange={e => {
            setAction(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Toda acción</option>
          {d
            ? Object.entries(d.facets.byAction || {})
                .sort((a, b) => b[1] - a[1])
                .map(([a, n]) => (
                  <option key={a} value={a}>
                    {a} ({n})
                  </option>
                ))
            : null}
        </select>
        <select
          value={days}
          onChange={e => {
            setDays(Number(e.target.value));
            setPage(1);
          }}
        >
          <option value={1}>Último día</option>
          <option value={7}>Últimos 7 días</option>
          <option value={30}>Últimos 30 días</option>
          <option value={90}>Últimos 90 días</option>
        </select>
      </div>

      {state.loading && !d ? (
        <div className={css.loading}>Cargando…</div>
      ) : state.error ? (
        <div className={css.error}>Error: {state.error}</div>
      ) : d?.entries?.length ? (
        <>
          <div className={css.auditPanel}>
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Acción</th>
                  <th>Operator</th>
                  <th>User afectado</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {d.entries.map(e => (
                  <tr key={e.id}>
                    <td>
                      {e.at ? new Date(e.at).toLocaleString('es-MX') : '—'}
                      <br />
                      <small className={css.muted}>{timeAgo(e.at)}</small>
                    </td>
                    <td>
                      <strong>{e.action}</strong>
                      {e.payload?.reason ? (
                        <div className={css.muted}>
                          <small>“{String(e.payload.reason).slice(0, 80)}”</small>
                        </div>
                      ) : null}
                    </td>
                    <td>{e.by?.email || e.by?.name || '—'}</td>
                    <td>
                      {e.userDisplayName || e.userEmail || e.userId?.slice(0, 8)}
                      <br />
                      <small className={css.muted}>{e.userEmail || ''}</small>
                    </td>
                    <td>{e.result || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={css.pager}>
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className={css.pagerBtn}
            >
              ← Anterior
            </button>
            <span className={css.pagerInfo}>
              Página {page} de {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
              className={css.pagerBtn}
            >
              Siguiente →
            </button>
          </div>
        </>
      ) : (
        <p className={css.muted}>Sin eventos con los filtros seleccionados.</p>
      )}
    </div>
  );
};

export default AuditLogView;
