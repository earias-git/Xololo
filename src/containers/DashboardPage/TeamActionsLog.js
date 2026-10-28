import React, { useCallback, useEffect, useState } from 'react';

import { apiBaseUrl } from '../../util/api';

import css from './DashboardTeamView.module.css';

// XOLOLO Tier Empresarial · E3 — audit log del equipo.
//
// GET /api/team/actions?targetSellerId=&limit=100 devuelve el histórico
// append-prepend de hasta 500 entries (truncado server-side a 500).
// Aquí mostramos los primeros 100 con filtro por actor + por acción.

const api = async path => {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method: 'GET',
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
};

const ACTION_LABEL = {
  'team.invite': 'Invitó colaborador',
  'team.invite_accepted': 'Aceptó invitación',
  'team.permissions_updated': 'Actualizó permisos',
  'team.pause': 'Pausó colaborador',
  'team.resume': 'Reactivó colaborador',
  'team.remove': 'Removió colaborador',
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
  return `hace ${d}d`;
};

const TeamActionsLog = ({ targetSellerId }) => {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [actorFilter, setActorFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');

  const load = useCallback(() => {
    setState(s => ({ ...s, loading: true }));
    api(
      `/api/team/actions?targetSellerId=${encodeURIComponent(targetSellerId)}&limit=100`
    ).then(
      r =>
        setState({
          loading: false,
          data: r.ok ? r.data : null,
          error: r.ok ? null : r.data?.error || 'load_failed',
        }),
      e => setState({ loading: false, data: null, error: e.message })
    );
  }, [targetSellerId]);

  useEffect(load, [load]);

  const d = state.data;
  const filtered = (d?.actions || []).filter(a => {
    if (actorFilter && (a.actor?.email || '') !== actorFilter) return false;
    if (actionFilter && a.action !== actionFilter) return false;
    return true;
  });

  const uniqueActors = [
    ...new Set((d?.actions || []).map(a => a.actor?.email).filter(Boolean)),
  ];
  const uniqueActions = [...new Set((d?.actions || []).map(a => a.action).filter(Boolean))];

  return (
    <section className={css.actionsPanel}>
      <h3 className={css.actionsTitle}>Historial del equipo</h3>
      <p className={css.muted}>
        {d
          ? `${filtered.length} de ${d.actions?.length || 0} eventos ${d.total ? `(${d.total} totales)` : ''}`
          : 'Cargando…'}
      </p>

      <div className={css.actionsFilters}>
        <select
          value={actorFilter}
          onChange={e => setActorFilter(e.target.value)}
          className={css.modalInput}
        >
          <option value="">Cualquier colaborador</option>
          {uniqueActors.map(a => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select
          value={actionFilter}
          onChange={e => setActionFilter(e.target.value)}
          className={css.modalInput}
        >
          <option value="">Cualquier acción</option>
          {uniqueActions.map(a => (
            <option key={a} value={a}>
              {ACTION_LABEL[a] || a}
            </option>
          ))}
        </select>
        <button type="button" className={css.secondaryBtn} onClick={load}>
          🔄
        </button>
      </div>

      {state.loading && !d ? (
        <p className={css.muted}>Cargando…</p>
      ) : state.error ? (
        <p className={css.error}>Error: {state.error}</p>
      ) : filtered.length === 0 ? (
        <p className={css.muted}>Sin eventos con estos filtros.</p>
      ) : (
        <table className={css.table}>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Acción</th>
              <th>Por</th>
              <th>Target</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(a => (
              <tr key={a.id}>
                <td>
                  {a.at ? new Date(a.at).toLocaleString('es-MX') : '—'}
                  <br />
                  <small className={css.muted}>{timeAgo(a.at)}</small>
                </td>
                <td>
                  <strong>{ACTION_LABEL[a.action] || a.action}</strong>
                </td>
                <td>{a.actor?.name || a.actor?.email || '—'}</td>
                <td className={css.muted}>
                  <small>{a.target ? JSON.stringify(a.target) : '—'}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
};

export default TeamActionsLog;
