import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useHistory } from 'react-router-dom';

import { apiBaseUrl } from '../../util/api';

import UserDrawer from './UserDrawer';
import css from './UsersView.module.css';

// XOLOLO OPS Users 360 · Fase A — vista maestra de users con filtros,
// paginación, buscador y drawer drilldown.
//
// Datos vienen de GET /api/admin/ops/users-roster (cacheado 10 min
// server-side). Filtros van en URL params para links compartibles.
//
// Drawer drilldown vive en UserDrawer.js y consume
// GET /api/admin/ops/users/:id/profile.

const api = async path => {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method: 'GET',
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
};

const TYPE_LABEL = {
  admin: 'Admin',
  store: 'Store',
  casual_reseller: 'Casual',
  buyer_only: 'Buyer',
  lead: 'Lead',
};

const SUB_LABEL = {
  active: 'Active',
  past_due: 'Past due',
  canceled: 'Canceled',
  none: '—',
};

const MX_STATES = [
  ['MX-AGU', 'Aguascalientes'],
  ['MX-BCN', 'Baja California'],
  ['MX-BCS', 'Baja California Sur'],
  ['MX-CAM', 'Campeche'],
  ['MX-CHP', 'Chiapas'],
  ['MX-CHH', 'Chihuahua'],
  ['MX-CDMX', 'Ciudad de México'],
  ['MX-COA', 'Coahuila'],
  ['MX-COL', 'Colima'],
  ['MX-DUR', 'Durango'],
  ['MX-GUA', 'Guanajuato'],
  ['MX-GRO', 'Guerrero'],
  ['MX-HID', 'Hidalgo'],
  ['MX-JAL', 'Jalisco'],
  ['MX-MEX', 'Estado de México'],
  ['MX-MIC', 'Michoacán'],
  ['MX-MOR', 'Morelos'],
  ['MX-NAY', 'Nayarit'],
  ['MX-NLE', 'Nuevo León'],
  ['MX-OAX', 'Oaxaca'],
  ['MX-PUE', 'Puebla'],
  ['MX-QUE', 'Querétaro'],
  ['MX-ROO', 'Quintana Roo'],
  ['MX-SLP', 'San Luis Potosí'],
  ['MX-SIN', 'Sinaloa'],
  ['MX-SON', 'Sonora'],
  ['MX-TAB', 'Tabasco'],
  ['MX-TAM', 'Tamaulipas'],
  ['MX-TLA', 'Tlaxcala'],
  ['MX-VER', 'Veracruz'],
  ['MX-YUC', 'Yucatán'],
  ['MX-ZAC', 'Zacatecas'],
];

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
  const mo = Math.floor(d / 30);
  if (mo < 12) return `hace ${mo}mo`;
  const y = Math.floor(mo / 12);
  return `hace ${y}a`;
};

const activityColor = iso => {
  if (!iso) return css.activityNever;
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 86_400_000) return css.activityToday;
  if (ms < 7 * 86_400_000) return css.activityWeek;
  if (ms < 30 * 86_400_000) return css.activityMonth;
  return css.activityStale;
};

const formatGmv = n => {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
};

const UsersView = ({ onBack }) => {
  const location = useLocation();
  const history = useHistory();
  const [data, setData] = useState({ loading: true, roster: null, error: null });
  const [selectedUserId, setSelectedUserId] = useState(null);
  // Fase C: bulk selection + bulk note modal.
  const [selected, setSelected] = useState(new Set());
  const [showBulkModal, setShowBulkModal] = useState(false);
  const abortRef = useRef(null);

  const toggleSelected = id => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelected = () => setSelected(new Set());

  // Lee filtros de la URL. Shape: ?q=&type=&verified=&sub=&legal=&state=&activity=&page=&pageSize=&sort=&dir=
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const filters = useMemo(
    () => ({
      q: params.get('q') || '',
      type: params.get('type') || '',
      verified: params.get('verified') || '',
      sub: params.get('sub') || '',
      stripe: params.get('stripe') || '',
      legal: params.get('legal') || '',
      state: params.get('state') || '',
      activity: params.get('activity') || '',
      sort: params.get('sort') || 'lastActivity',
      dir: params.get('dir') || 'desc',
      page: parseInt(params.get('page'), 10) || 1,
      pageSize: parseInt(params.get('pageSize'), 10) || 50,
    }),
    [params]
  );

  // Actualiza URL params preservando los existentes.
  const patchFilters = useCallback(
    patch => {
      const next = new URLSearchParams(location.search);
      Object.entries(patch).forEach(([k, v]) => {
        if (v === '' || v == null) next.delete(k);
        else next.set(k, String(v));
      });
      // Al cambiar filtros (no page/sort/dir), resetear page=1
      const resetPage = !('page' in patch) && !('sort' in patch) && !('dir' in patch);
      if (resetPage) next.delete('page');
      history.replace({ pathname: location.pathname, search: next.toString() });
    },
    [history, location.pathname, location.search]
  );

  const load = useCallback(() => {
    if (abortRef.current) abortRef.current.abort?.();
    const controller = new AbortController();
    abortRef.current = controller;
    setData(s => ({ ...s, loading: true, error: null }));
    const qs = new URLSearchParams(filters).toString();
    api(`/api/admin/ops/users-roster?${qs}`).then(
      r => {
        if (controller.signal.aborted) return;
        if (!r.ok) {
          setData({ loading: false, roster: null, error: r.data?.error || 'load_failed' });
          return;
        }
        setData({ loading: false, roster: r.data, error: null });
      },
      e => {
        if (controller.signal.aborted) return;
        setData({ loading: false, roster: null, error: e.message });
      }
    );
  }, [filters]);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort?.();
  }, [load]);

  const roster = data.roster;
  const facets = roster?.facets;

  const onRowClick = userId => setSelectedUserId(userId);
  const closeDrawer = () => setSelectedUserId(null);

  return (
    <div className={css.root}>
      <header className={css.header}>
        <div>
          <h1 className={css.title}>Usuarios 360</h1>
          <p className={css.subtitle}>
            {roster
              ? `${roster.total.toLocaleString(
                  'es-MX'
                )} users · ${roster.filteredTotal.toLocaleString(
                  'es-MX'
                )} coinciden con el filtro · snapshot ${timeAgo(roster.generatedAt)}`
              : 'Cargando snapshot…'}
          </p>
        </div>
        <div className={css.headerActions}>
          <button type="button" className={css.secondaryBtn} onClick={load}>
            🔄 Refrescar
          </button>
          <button
            type="button"
            className={css.secondaryBtn}
            onClick={() => {
              const qs = new URLSearchParams(
                Object.fromEntries(
                  Object.entries(filters).filter(
                    ([k, v]) => !['page', 'pageSize'].includes(k) && v !== '' && v != null
                  )
                )
              ).toString();
              const url = `${apiBaseUrl()}/api/admin/ops/users-roster.csv${qs ? `?${qs}` : ''}`;
              window.open(url, '_blank', 'noopener');
            }}
          >
            ⬇ Export CSV
          </button>
          <button type="button" className={css.secondaryBtn} onClick={onBack}>
            ← Volver
          </button>
        </div>
      </header>

      <LiveBanner onPickUser={onRowClick} />

      <div className={css.layout}>
        <aside className={css.filters}>
          <div className={css.searchGroup}>
            <input
              type="search"
              placeholder="🔍 nombre, email, slug…"
              className={css.search}
              value={filters.q}
              onChange={e => patchFilters({ q: e.target.value })}
            />
          </div>

          <FilterGroup title="Tipo">
            {['store', 'casual_reseller', 'buyer_only', 'lead', 'admin'].map(t => (
              <FilterCheckbox
                key={t}
                label={`${TYPE_LABEL[t]} (${facets?.byType?.[t] || 0})`}
                checked={filters.type.split(',').includes(t)}
                onToggle={() => {
                  const cur = filters.type ? filters.type.split(',') : [];
                  const next = cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t];
                  patchFilters({ type: next.join(',') });
                }}
              />
            ))}
          </FilterGroup>

          <FilterGroup title="Verified">
            <FilterRadio
              name="verified"
              currentValue={filters.verified}
              value=""
              label={`Todos (${(facets?.byVerified?.yes || 0) + (facets?.byVerified?.no || 0)})`}
              onPick={v => patchFilters({ verified: v })}
            />
            <FilterRadio
              name="verified"
              currentValue={filters.verified}
              value="yes"
              label={`✓ Verified (${facets?.byVerified?.yes || 0})`}
              onPick={v => patchFilters({ verified: v })}
            />
            <FilterRadio
              name="verified"
              currentValue={filters.verified}
              value="no"
              label={`✗ Not (${facets?.byVerified?.no || 0})`}
              onPick={v => patchFilters({ verified: v })}
            />
          </FilterGroup>

          <FilterGroup title="Suscripción">
            {['active', 'past_due', 'canceled', 'none'].map(s => (
              <FilterCheckbox
                key={s}
                label={`${SUB_LABEL[s]} (${facets?.bySub?.[s] || 0})`}
                checked={filters.sub.split(',').includes(s)}
                onToggle={() => {
                  const cur = filters.sub ? filters.sub.split(',') : [];
                  const next = cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s];
                  patchFilters({ sub: next.join(',') });
                }}
              />
            ))}
          </FilterGroup>

          <FilterGroup title="Legal docs">
            {['complete', 'partial', 'none'].map(l => (
              <FilterRadio
                key={l}
                name="legal"
                currentValue={filters.legal}
                value={l}
                label={`${
                  l === 'complete' ? '✓ Completo' : l === 'partial' ? '⏸ Parcial' : '✗ Sin docs'
                } (${facets?.byLegal?.[l] || 0})`}
                onPick={v => patchFilters({ legal: v })}
              />
            ))}
            {filters.legal ? (
              <button
                type="button"
                className={css.clearBtn}
                onClick={() => patchFilters({ legal: '' })}
              >
                Limpiar
              </button>
            ) : null}
          </FilterGroup>

          <FilterGroup title="Stripe">
            <FilterRadio
              name="stripe"
              currentValue={filters.stripe}
              value=""
              label={`Todos (${(facets?.byStripe?.yes || 0) + (facets?.byStripe?.no || 0)})`}
              onPick={v => patchFilters({ stripe: v })}
            />
            <FilterRadio
              name="stripe"
              currentValue={filters.stripe}
              value="yes"
              label={`Conectado (${facets?.byStripe?.yes || 0})`}
              onPick={v => patchFilters({ stripe: v })}
            />
            <FilterRadio
              name="stripe"
              currentValue={filters.stripe}
              value="no"
              label={`No conectado (${facets?.byStripe?.no || 0})`}
              onPick={v => patchFilters({ stripe: v })}
            />
          </FilterGroup>

          <FilterGroup title="Ubicación (estado)">
            <select
              className={css.select}
              value={filters.state}
              onChange={e => patchFilters({ state: e.target.value })}
            >
              <option value="">Todos</option>
              {MX_STATES.map(([code, label]) => (
                <option key={code} value={code}>
                  {label} ({facets?.byState?.[code] || 0})
                </option>
              ))}
            </select>
          </FilterGroup>

          <FilterGroup title="Última actividad">
            {[
              ['', 'Cualquier tiempo'],
              ['today', `Hoy (${facets?.byActivity?.today || 0})`],
              ['7d', `≤ 7 días (${facets?.byActivity?.['7d'] || 0})`],
              ['30d', `≤ 30 días (${facets?.byActivity?.['30d'] || 0})`],
              ['90d', `≤ 90 días (${facets?.byActivity?.['90d'] || 0})`],
              ['90d+', `> 90 días (${facets?.byActivity?.['90d+'] || 0})`],
              ['never', `Nunca (${facets?.byActivity?.never || 0})`],
            ].map(([v, label]) => (
              <FilterRadio
                key={v || 'any'}
                name="activity"
                currentValue={filters.activity}
                value={v}
                label={label}
                onPick={x => patchFilters({ activity: x })}
              />
            ))}
          </FilterGroup>
        </aside>

        <section className={css.tableWrap}>
          {data.loading && !roster ? (
            <div className={css.loading}>Cargando usuarios…</div>
          ) : data.error ? (
            <div className={css.error}>Error: {data.error}</div>
          ) : (
            <>
              {selected.size > 0 ? (
                <div className={css.bulkBar}>
                  <span>
                    <span className={css.bulkCount}>{selected.size}</span> seleccionado
                    {selected.size === 1 ? '' : 's'}
                  </span>
                  <button
                    type="button"
                    className={css.notePrimaryBtn}
                    onClick={() => setShowBulkModal(true)}
                  >
                    📝 Agregar nota a todos
                  </button>
                  <button type="button" className={css.bulkClear} onClick={clearSelected}>
                    Limpiar selección
                  </button>
                </div>
              ) : null}
              <table className={css.table}>
                <thead>
                  <tr>
                    <th className={css.rowCheckbox}>
                      <input
                        type="checkbox"
                        checked={
                          roster?.users?.length > 0 &&
                          roster.users.every(u => selected.has(u.id))
                        }
                        onChange={e => {
                          if (e.target.checked) {
                            setSelected(new Set(roster.users.map(u => u.id)));
                          } else {
                            clearSelected();
                          }
                        }}
                        onClick={e => e.stopPropagation()}
                        aria-label="Seleccionar toda la página"
                      />
                    </th>
                    <th>Usuario</th>
                    <th>Tipo</th>
                    <th>Verified</th>
                    <th>Sub</th>
                    <SortableTh
                      label="Listings"
                      current={filters.sort}
                      dir={filters.dir}
                      value="listings"
                      onSort={(sort, dir) => patchFilters({ sort, dir })}
                    />
                    <SortableTh
                      label="GMV YTD"
                      current={filters.sort}
                      dir={filters.dir}
                      value="gmv"
                      onSort={(sort, dir) => patchFilters({ sort, dir })}
                    />
                    <SortableTh
                      label="Última act."
                      current={filters.sort}
                      dir={filters.dir}
                      value="lastActivity"
                      onSort={(sort, dir) => patchFilters({ sort, dir })}
                    />
                    <th>Ubicación</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {roster?.users?.length ? (
                    roster.users.map(u => (
                      <tr key={u.id} className={css.row} onClick={() => onRowClick(u.id)}>
                        <td
                          className={css.rowCheckbox}
                          onClick={e => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(u.id)}
                            onChange={() => toggleSelected(u.id)}
                            aria-label={`Seleccionar ${u.displayName || u.email}`}
                          />
                        </td>
                        <td className={css.userCell}>
                          <div className={css.userName}>
                            {u.displayName ||
                              `${u.firstName || ''} ${u.lastName || ''}`.trim() ||
                              '(sin nombre)'}
                          </div>
                          <div className={css.userEmail}>{u.email || '(sin email)'}</div>
                          {u.slug ? <div className={css.userSlug}>{u.slug}</div> : null}
                        </td>
                        <td>
                          <span className={`${css.badge} ${css[`type_${u.type}`]}`}>
                            {TYPE_LABEL[u.type] || u.type}
                          </span>
                        </td>
                        <td>
                          {u.verified ? (
                            <span className={`${css.badge} ${css.verifiedYes}`}>✓</span>
                          ) : (
                            <span className={css.badgeMuted}>—</span>
                          )}
                        </td>
                        <td>
                          {u.subscriptionStatus ? (
                            <span className={`${css.badge} ${css[`sub_${u.subscriptionStatus}`]}`}>
                              {SUB_LABEL[u.subscriptionStatus] || u.subscriptionStatus}
                            </span>
                          ) : (
                            <span className={css.badgeMuted}>—</span>
                          )}
                        </td>
                        <td className={css.numeric}>
                          <strong>{u.listings.total}</strong>
                          {u.listings.total > 0 ? (
                            <span className={css.segSmall}>
                              {u.listings.new}n·{u.listings.used}u·{u.listings.service}s
                            </span>
                          ) : null}
                        </td>
                        <td className={css.numeric}>
                          {u.sales.gmvYTD > 0 ? formatGmv(u.sales.gmvYTD) : '—'}
                        </td>
                        <td>
                          <span className={`${css.activity} ${activityColor(u.lastActivityAt)}`}>
                            {timeAgo(u.lastActivityAt)}
                          </span>
                        </td>
                        <td>{u.state || '—'}</td>
                        <td>
                          <button
                            type="button"
                            className={css.rowBtn}
                            onClick={e => {
                              e.stopPropagation();
                              onRowClick(u.id);
                            }}
                          >
                            Ver 360 →
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={10} className={css.empty}>
                        Sin coincidencias con los filtros.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {roster ? (
                <div className={css.pager}>
                  <button
                    type="button"
                    disabled={filters.page <= 1}
                    onClick={() => patchFilters({ page: filters.page - 1 })}
                    className={css.pagerBtn}
                  >
                    ← Anterior
                  </button>
                  <span className={css.pagerInfo}>
                    Página {filters.page} de{' '}
                    {Math.max(1, Math.ceil(roster.filteredTotal / filters.pageSize))}
                  </span>
                  <button
                    type="button"
                    disabled={filters.page * filters.pageSize >= roster.filteredTotal}
                    onClick={() => patchFilters({ page: filters.page + 1 })}
                    className={css.pagerBtn}
                  >
                    Siguiente →
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>

      {selectedUserId ? (
        <UserDrawer userId={selectedUserId} onClose={closeDrawer} onReload={load} />
      ) : null}

      {showBulkModal ? (
        <BulkNoteModal
          userIds={[...selected]}
          onClose={() => setShowBulkModal(false)}
          onDone={() => {
            setShowBulkModal(false);
            clearSelected();
            load();
          }}
        />
      ) : null}
    </div>
  );
};

const BulkNoteModal = ({ userIds, onClose, onDone }) => {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [result, setResult] = useState(null);

  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setErr(null);
    const r = await api('/api/admin/ops/users/bulk-note', {
      method: 'POST',
      body: { userIds, text },
    });
    setBusy(false);
    if (!r.ok) {
      setErr(r.data?.error || 'error');
      return;
    }
    setResult(r.data);
  };

  if (result) {
    return (
      <div className={css.modalBackdrop} onClick={onDone} role="presentation">
        <div className={css.modalCard} onClick={e => e.stopPropagation()}>
          <h3 className={css.modalTitle}>Nota aplicada</h3>
          <p>
            ✓ {result.succeeded} de {result.total} users. {result.failed > 0 ? `${result.failed} fallaron.` : ''}
          </p>
          {result.errors?.length ? (
            <ul className={css.flagList}>
              {result.errors.map((e, i) => (
                <li key={i} className={`${css.flag} ${css.flag_error}`}>
                  <small>
                    {e.userId}: {e.error}
                  </small>
                </li>
              ))}
            </ul>
          ) : null}
          <div className={css.modalActions}>
            <button type="button" className={css.notePrimaryBtn} onClick={onDone}>
              Listo
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={css.modalBackdrop} onClick={onClose} role="presentation">
      <div className={css.modalCard} onClick={e => e.stopPropagation()}>
        <h3 className={css.modalTitle}>Nota masiva ({userIds.length} users)</h3>
        <p className={css.muted}>
          La misma nota se agregará al perfil de cada user seleccionado. Queda registrada en el
          audit log con <code>bulk_note_added</code>.
        </p>
        <textarea
          className={css.noteTextarea}
          value={text}
          onChange={e => setText(e.target.value)}
          rows={4}
          maxLength={5000}
          placeholder="Ej. 'Sellers con 0 ventas en Q3 2026 — campaña de reactivación.'"
          autoFocus
        />
        {err ? <p className={css.error}>Error: {err}</p> : null}
        <div className={css.modalActions}>
          <button type="button" className={css.secondaryBtn} onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className={css.notePrimaryBtn}
            onClick={submit}
            disabled={!text.trim() || busy}
          >
            {busy ? 'Aplicando…' : `Agregar nota a ${userIds.length}`}
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// Sub-components
// ============================================================

const FilterGroup = ({ title, children }) => (
  <div className={css.filterGroup}>
    <h4 className={css.filterTitle}>{title}</h4>
    {children}
  </div>
);

const FilterCheckbox = ({ label, checked, onToggle }) => (
  <label className={css.filterOption}>
    <input type="checkbox" checked={checked} onChange={onToggle} />
    <span>{label}</span>
  </label>
);

const FilterRadio = ({ name, currentValue, value, label, onPick }) => (
  <label className={css.filterOption}>
    <input
      type="radio"
      name={name}
      checked={currentValue === value}
      onChange={() => onPick(value)}
    />
    <span>{label}</span>
  </label>
);

const LiveBanner = ({ onPickUser }) => {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(() => {
    setState(s => ({ ...s, loading: true }));
    api('/api/admin/ops/users/live?windowMinutes=60').then(
      r => {
        if (!r.ok) {
          setState({ loading: false, data: null, error: r.data?.error || 'load_failed' });
          return;
        }
        setState({ loading: false, data: r.data, error: null });
      },
      e => setState({ loading: false, data: null, error: e.message })
    );
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [load]);

  if (state.loading && !state.data) return null;
  if (state.error) return null;
  const n = state.data?.totalOnline || 0;

  return (
    <div className={css.liveBanner}>
      <button
        type="button"
        className={css.liveBannerTitle}
        onClick={() => setExpanded(x => !x)}
      >
        <span className={css.liveDot} aria-hidden="true" />
        {n === 0
          ? 'Sin actividad en la última hora'
          : `${n} user${n === 1 ? '' : 's'} online en la última hora`}
        <span className={css.liveToggle}>{expanded ? '▲ ocultar' : '▼ ver'}</span>
      </button>
      {expanded && state.data?.users?.length ? (
        <ul className={css.liveList}>
          {state.data.users.map(u => (
            <li key={u.id} className={css.liveItem}>
              <button type="button" className={css.liveLink} onClick={() => onPickUser(u.id)}>
                <strong>{u.displayName || u.email || '(sin nombre)'}</strong>
                <span className={css.muted}> · {u.type}</span>
                <span className={css.muted}>
                  {' '}
                  · {new Date(u.lastSeenAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};

const SortableTh = ({ label, current, dir, value, onSort }) => {
  const active = current === value;
  const nextDir = active && dir === 'desc' ? 'asc' : 'desc';
  return (
    <th
      className={`${css.sortable} ${active ? css.sortActive : ''}`}
      onClick={() => onSort(value, nextDir)}
    >
      {label} {active ? (dir === 'desc' ? '▼' : '▲') : '↕'}
    </th>
  );
};

export default UsersView;
