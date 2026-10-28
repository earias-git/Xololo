import React, { useCallback, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import { apiBaseUrl } from '../../util/api';
import { IconSpinner } from '../../components';

import TeamInviteModal from './TeamInviteModal';
import TeamPermissionsModal from './TeamPermissionsModal';
import TeamActionsLog from './TeamActionsLog';
import css from './DashboardTeamView.module.css';

// XOLOLO Tier Empresarial · E3 — tab Equipo del Dashboard.
//
// Visible solo si el seller tiene plan Enterprise (sub.tier === 'enterprise').
// Si está en Starter, mostramos CTA para hacer upgrade.
//
// Fuente de datos:
//   - GET /api/team/collaborators?targetSellerId=<yo> para la lista + seats.
//   - GET /api/team/actions para el audit log.
// Mutations:
//   - POST /api/team/invite / update-permissions / pause / resume / remove

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

const STATUS_LABEL = {
  invited: 'Invitado',
  active: 'Activo',
  paused: 'Pausado',
  removed: 'Removido',
};

const ROLE_LABEL = {
  admin: 'Admin',
  manager: 'Manager',
  catalog: 'Catálogo',
  logistics: 'Logística',
  finance: 'Finanzas',
  custom: 'Custom',
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

const DashboardTeamView = () => {
  const currentUser = useSelector(state => state.user?.currentUser);
  const sellerId = currentUser?.id?.uuid;

  const [sub, setSub] = useState({ loading: true, data: null, error: null });
  const [team, setTeam] = useState({ loading: true, data: null, error: null });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState(null); // collaborator being edited
  const [showActions, setShowActions] = useState(false);

  const loadSub = useCallback(() => {
    setSub(s => ({ ...s, loading: true }));
    api('/api/seller-subscription').then(
      r =>
        setSub({
          loading: false,
          data: r.ok ? r.data : null,
          error: r.ok ? null : r.data?.error || 'load_failed',
        }),
      e => setSub({ loading: false, data: null, error: e.message })
    );
  }, []);

  const loadTeam = useCallback(() => {
    if (!sellerId) return;
    setTeam(s => ({ ...s, loading: true }));
    api(`/api/team/collaborators?targetSellerId=${encodeURIComponent(sellerId)}`).then(
      r =>
        setTeam({
          loading: false,
          data: r.ok ? r.data : null,
          error: r.ok ? null : r.data?.error || 'load_failed',
        }),
      e => setTeam({ loading: false, data: null, error: e.message })
    );
  }, [sellerId]);

  useEffect(() => {
    loadSub();
  }, [loadSub]);

  useEffect(() => {
    if (sub.data?.tier === 'enterprise') loadTeam();
  }, [sub.data?.tier, loadTeam]);

  // ---------- Loading / gated states ----------

  if (sub.loading) {
    return (
      <div className={css.loadingBlock}>
        <IconSpinner />
      </div>
    );
  }

  const tier = sub.data?.tier;
  if (tier !== 'enterprise') {
    return (
      <section className={css.upgradeCard}>
        <h2 className={css.upgradeTitle}>Suma a tu equipo con el plan Empresarial</h2>
        <p className={css.upgradeLead}>
          Invita a tu equipo (vendedor, logística, contador, social media…) y asígnales
          exactamente los permisos que necesitan. Mantén el control del dinero y la
          configuración mientras delegas la operación.
        </p>
        <div className={css.upgradePricing}>
          <div className={css.upgradeCol}>
            <span className={css.upgradeTag}>Pago anual</span>
            <strong className={css.upgradePrice}>$399 MXN/mes</strong>
            <small>2 colaboradores incluidos · +$69/mes por extra</small>
          </div>
          <div className={css.upgradeCol}>
            <span className={css.upgradeTag}>Pago mensual</span>
            <strong className={css.upgradePrice}>$499 MXN/mes</strong>
            <small>2 colaboradores incluidos · +$99/mes por extra</small>
          </div>
        </div>
        <ul className={css.upgradeBenefits}>
          <li>Hasta ilimitados colaboradores (pagando)</li>
          <li>10 permisos atómicos · 5 roles preset · roles custom</li>
          <li>Audit log cross-user de todo lo que hace tu equipo</li>
          <li>Mismo payout y facturación — tú sigues siendo el titular</li>
        </ul>
        <a href="/account/subscription" className={css.upgradeBtn}>
          Hacer upgrade a Empresarial →
        </a>
      </section>
    );
  }

  // ---------- Enterprise seller: lista real ----------

  const d = team.data;
  const seats = d?.seats || { used: 0, included: 2, extraPaid: 0 };
  const activeCollaborators = (d?.collaborators || []).filter(
    c => c.status !== 'removed'
  );

  return (
    <div className={css.root}>
      <header className={css.header}>
        <div>
          <h1 className={css.title}>Equipo</h1>
          <p className={css.subtitle}>
            {activeCollaborators.length} colaborador{activeCollaborators.length === 1 ? '' : 'es'}
            {' '}activo{activeCollaborators.length === 1 ? '' : 's'} ·{' '}
            {seats.used}/{seats.included + seats.extraPaid} asientos usados
            {seats.extraPaid > 0 ? ` (${seats.extraPaid} extra)` : ''}
          </p>
        </div>
        <div className={css.headerActions}>
          <button
            type="button"
            className={css.secondaryBtn}
            onClick={() => setShowActions(x => !x)}
          >
            📋 {showActions ? 'Ocultar' : 'Ver'} historial
          </button>
          <button
            type="button"
            className={css.primaryBtn}
            onClick={() => setInviteOpen(true)}
          >
            + Invitar colaborador
          </button>
        </div>
      </header>

      {team.loading && !d ? (
        <div className={css.loadingBlock}>
          <IconSpinner />
        </div>
      ) : team.error ? (
        <div className={css.error}>Error: {team.error}</div>
      ) : activeCollaborators.length === 0 ? (
        <div className={css.emptyState}>
          <h3>Todavía no tienes colaboradores</h3>
          <p>Invita al primero y asígnale los permisos que necesite.</p>
        </div>
      ) : (
        <table className={css.table}>
          <thead>
            <tr>
              <th>Colaborador</th>
              <th>Rol</th>
              <th>Permisos</th>
              <th>Status</th>
              <th>Desde</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {activeCollaborators.map(c => (
              <tr key={c.collaboratorId}>
                <td>
                  <strong>{c.email}</strong>
                </td>
                <td>
                  <span className={`${css.badge} ${css[`role_${c.roleName}`]}`}>
                    {ROLE_LABEL[c.roleName] || c.roleName}
                  </span>
                </td>
                <td className={css.permsCell}>
                  {c.permissions?.length ? (
                    <span className={css.permsCount}>
                      {c.permissions.length} permiso{c.permissions.length === 1 ? '' : 's'}
                    </span>
                  ) : (
                    <span className={css.muted}>sin permisos</span>
                  )}
                </td>
                <td>
                  <span className={`${css.statusBadge} ${css[`status_${c.status}`]}`}>
                    {STATUS_LABEL[c.status] || c.status}
                  </span>
                </td>
                <td>
                  {c.acceptedAt
                    ? timeAgo(c.acceptedAt)
                    : `invitado ${timeAgo(c.invitedAt)}`}
                </td>
                <td>
                  <div className={css.rowActions}>
                    <button
                      type="button"
                      className={css.linkBtn}
                      onClick={() => setEditing(c)}
                    >
                      Editar
                    </button>
                    {c.status === 'active' ? (
                      <button
                        type="button"
                        className={css.linkBtn}
                        onClick={async () => {
                          if (!window.confirm(`¿Pausar acceso de ${c.email}? El seat sigue contando.`)) return;
                          const r = await api('/api/team/pause', {
                            method: 'POST',
                            body: { targetSellerId: sellerId, collaboratorId: c.collaboratorId },
                          });
                          if (r.ok) loadTeam();
                          else alert(`Error: ${r.data?.error || 'no_pude'}`);
                        }}
                      >
                        Pausar
                      </button>
                    ) : c.status === 'paused' ? (
                      <button
                        type="button"
                        className={css.linkBtn}
                        onClick={async () => {
                          const r = await api('/api/team/resume', {
                            method: 'POST',
                            body: { targetSellerId: sellerId, collaboratorId: c.collaboratorId },
                          });
                          if (r.ok) loadTeam();
                        }}
                      >
                        Reactivar
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={css.dangerLinkBtn}
                      onClick={async () => {
                        if (
                          !window.confirm(
                            `¿Remover a ${c.email}? Pierde el acceso de inmediato. El seat se libera.`
                          )
                        ) {
                          return;
                        }
                        const r = await api('/api/team/remove', {
                          method: 'POST',
                          body: { targetSellerId: sellerId, collaboratorId: c.collaboratorId },
                        });
                        if (r.ok) loadTeam();
                        else alert(`Error: ${r.data?.error || 'no_pude'}`);
                      }}
                    >
                      Remover
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showActions ? <TeamActionsLog targetSellerId={sellerId} /> : null}

      {inviteOpen ? (
        <TeamInviteModal
          targetSellerId={sellerId}
          onClose={() => setInviteOpen(false)}
          onDone={() => {
            setInviteOpen(false);
            loadTeam();
          }}
        />
      ) : null}

      {editing ? (
        <TeamPermissionsModal
          targetSellerId={sellerId}
          collaborator={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            loadTeam();
          }}
        />
      ) : null}
    </div>
  );
};

export default DashboardTeamView;
