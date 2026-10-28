import React, { useCallback, useEffect, useState } from 'react';

import { apiBaseUrl } from '../../util/api';

import css from './UsersView.module.css';

// XOLOLO OPS Users 360 · Fase A — drawer drilldown de un user.
// Tabs: Resumen · Catálogo · Moderación. Membresía / Transacciones /
// Actividad / Notas quedan para Fase B.

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

const TYPE_LABEL = {
  admin: 'Admin',
  store: 'Store',
  casual_reseller: 'Casual reseller',
  buyer_only: 'Buyer',
  lead: 'Lead',
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
  const mo = Math.floor(d / 30);
  return `hace ${mo}mo`;
};

const UserDrawer = ({ userId, onClose, onReload }) => {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [tab, setTab] = useState('summary');

  const load = useCallback(() => {
    setState({ loading: true, data: null, error: null });
    api(`/api/admin/ops/users/${userId}/profile`).then(
      r => {
        if (!r.ok) {
          setState({ loading: false, data: null, error: r.data?.error || 'load_failed' });
          return;
        }
        setState({ loading: false, data: r.data, error: null });
      },
      e => setState({ loading: false, data: null, error: e.message })
    );
  }, [userId]);

  useEffect(load, [load]);

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const d = state.data;
  const summary = d?.summary;

  return (
    <>
      <div className={css.drawerBackdrop} onClick={onClose} role="presentation" />
      <aside className={css.drawer} role="dialog" aria-label="Perfil de usuario">
        <header className={css.drawerHeader}>
          <div>
            <h2 className={css.drawerTitle}>
              {summary?.displayName || summary?.firstName || summary?.email || 'Cargando…'}
            </h2>
            {summary?.email ? <p className={css.drawerEmail}>{summary.email}</p> : null}
            {summary ? (
              <div className={css.drawerBadges}>
                <span className={`${css.badge} ${css[`type_${summary.type}`]}`}>
                  {TYPE_LABEL[summary.type] || summary.type}
                </span>
                {summary.verified ? (
                  <span className={`${css.badge} ${css.verifiedYes}`}>✓ Verified</span>
                ) : null}
                {summary.stripeConnected ? (
                  <span className={`${css.badge} ${css.stripeOn}`}>Stripe conectado</span>
                ) : null}
              </div>
            ) : null}
          </div>
          <button type="button" className={css.closeBtn} onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </header>

        <nav className={css.drawerTabs}>
          <button
            type="button"
            className={tab === 'summary' ? css.tabActive : css.tab}
            onClick={() => setTab('summary')}
          >
            Resumen
          </button>
          <button
            type="button"
            className={tab === 'catalog' ? css.tabActive : css.tab}
            onClick={() => setTab('catalog')}
          >
            Catálogo {d?.listings?.length ? `(${d.listings.length})` : ''}
          </button>
          <button
            type="button"
            className={tab === 'moderation' ? css.tabActive : css.tab}
            onClick={() => setTab('moderation')}
          >
            Moderación {d?.flags?.length ? `(${d.flags.length})` : ''}
          </button>
        </nav>

        <div className={css.drawerBody}>
          {state.loading ? (
            <p className={css.loading}>Cargando perfil…</p>
          ) : state.error ? (
            <p className={css.error}>Error: {state.error}</p>
          ) : tab === 'summary' ? (
            <SummaryTab data={d} />
          ) : tab === 'catalog' ? (
            <CatalogTab listings={d.listings} />
          ) : (
            <ModerationTab
              userId={userId}
              flags={d.flags}
              onActionDone={() => {
                load();
                onReload?.();
              }}
            />
          )}
        </div>
      </aside>
    </>
  );
};

// ============================================================
// Tab: Resumen
// ============================================================

const SummaryTab = ({ data }) => {
  const s = data.summary;
  const sub = data.subscription;
  const legal = data.legalDocs;
  const salesCount = data.transactions.filter(t => t.role === 'sold').length;
  const purchasesCount = data.transactions.filter(t => t.role === 'bought').length;

  const Kpi = ({ label, value, hint }) => (
    <div className={css.kpi}>
      <div className={css.kpiLabel}>{label}</div>
      <div className={css.kpiValue}>{value}</div>
      {hint ? <div className={css.kpiHint}>{hint}</div> : null}
    </div>
  );

  return (
    <>
      <div className={css.kpiGrid}>
        <Kpi
          label="Listings"
          value={data.listings.length}
          hint={`${data.listings.filter(l => l.state === 'published').length} publicados`}
        />
        <Kpi label="Ventas" value={salesCount} />
        <Kpi label="Compras" value={purchasesCount} />
        <Kpi
          label="Última actividad"
          value={timeAgo(s.lastSeenAt)}
          hint={s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleString('es-MX') : '—'}
        />
      </div>

      <section className={css.section}>
        <h3 className={css.sectionTitle}>Identidad</h3>
        <dl className={css.dl}>
          <dt>User ID</dt>
          <dd className={css.mono}>{s.id}</dd>
          <dt>Alta</dt>
          <dd>
            {s.createdAt
              ? `${new Date(s.createdAt).toLocaleDateString('es-MX')} (${timeAgo(s.createdAt)})`
              : '—'}
          </dd>
          <dt>Slug</dt>
          <dd>{s.slug || '—'}</dd>
          <dt>SellerMode</dt>
          <dd>{s.sellerMode || 'no declarado'}</dd>
          <dt>Verified</dt>
          <dd>
            {s.verified ? `✓ desde ${new Date(s.verifiedAt).toLocaleDateString('es-MX')}` : '—'}
          </dd>
        </dl>
      </section>

      <section className={css.section}>
        <h3 className={css.sectionTitle}>Membresía</h3>
        {sub ? (
          <dl className={css.dl}>
            <dt>Estado</dt>
            <dd>{sub.status}</dd>
            <dt>Plan</dt>
            <dd>{sub.plan || '—'}</dd>
            <dt>Próxima renovación</dt>
            <dd>
              {sub.currentPeriodEnd
                ? new Date(sub.currentPeriodEnd).toLocaleDateString('es-MX')
                : '—'}
            </dd>
            <dt>Última factura</dt>
            <dd>
              {sub.lastInvoiceAt ? new Date(sub.lastInvoiceAt).toLocaleDateString('es-MX') : '—'}
            </dd>
          </dl>
        ) : (
          <p className={css.muted}>Sin suscripción activa.</p>
        )}
      </section>

      <section className={css.section}>
        <h3 className={css.sectionTitle}>Documentos legales</h3>
        {legal?.slots?.length ? (
          <>
            <p className={css.muted}>
              Persona: {legal.personType || '—'} · Aprobados {legal.summary.approved}/
              {legal.summary.total}
            </p>
            <ul className={css.legalList}>
              {legal.slots.map(slot => (
                <li key={slot.key}>
                  <span className={`${css.legalBadge} ${css[`legal_${slot.status}`]}`}>
                    {slot.status}
                  </span>
                  <strong>{slot.key}</strong>
                  {slot.rejectionReason ? (
                    <span className={css.muted}> — {slot.rejectionReason}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className={css.muted}>Sin documentos cargados.</p>
        )}
      </section>
    </>
  );
};

// ============================================================
// Tab: Catálogo
// ============================================================

const CatalogTab = ({ listings }) => {
  const [filterSegment, setFilterSegment] = useState('all');
  const [filterState, setFilterState] = useState('all');

  const filtered = listings.filter(l => {
    if (filterSegment !== 'all' && l.segment !== filterSegment) return false;
    if (filterState !== 'all' && l.state !== filterState) return false;
    return true;
  });

  if (!listings.length) {
    return <p className={css.muted}>Este user no tiene listings publicados.</p>;
  }

  return (
    <>
      <div className={css.catalogFilters}>
        <select
          value={filterSegment}
          onChange={e => setFilterSegment(e.target.value)}
          className={css.select}
        >
          <option value="all">Todos los segmentos ({listings.length})</option>
          <option value="new">Nuevo ({listings.filter(l => l.segment === 'new').length})</option>
          <option value="used">Usado ({listings.filter(l => l.segment === 'used').length})</option>
          <option value="service">
            Servicio ({listings.filter(l => l.segment === 'service').length})
          </option>
        </select>
        <select
          value={filterState}
          onChange={e => setFilterState(e.target.value)}
          className={css.select}
        >
          <option value="all">Todos los estados</option>
          <option value="published">Publicado</option>
          <option value="closed">Cerrado</option>
          <option value="draft">Borrador</option>
        </select>
      </div>
      <table className={css.innerTable}>
        <thead>
          <tr>
            <th>Título</th>
            <th>Segmento</th>
            <th>Estado</th>
            <th>Precio</th>
            <th>Vistas</th>
            <th>Creado</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(l => (
            <tr key={l.id}>
              <td>{l.title || '(sin título)'}</td>
              <td>{l.segment}</td>
              <td>{l.state}</td>
              <td>{l.price ? `$${(l.price.amount / 100).toFixed(2)}` : '—'}</td>
              <td className={css.numeric}>{l.views || 0}</td>
              <td>{l.createdAt ? new Date(l.createdAt).toLocaleDateString('es-MX') : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
};

// ============================================================
// Tab: Moderación
// ============================================================

const ModerationTab = ({ userId, flags, onActionDone }) => (
  <>
    <section className={css.section}>
      <h3 className={css.sectionTitle}>Flags activos</h3>
      {flags?.length ? (
        <ul className={css.flagList}>
          {flags.map((f, i) => (
            <li key={i} className={`${css.flag} ${css[`flag_${f.severity}`]}`}>
              <strong>{f.key}</strong>
              <p>{f.reason}</p>
              {f.raisedAt ? <small>desde {timeAgo(f.raisedAt)}</small> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className={css.muted}>Sin flags. Perfil limpio.</p>
      )}
    </section>

    <section className={css.section}>
      <h3 className={css.sectionTitle}>Acciones</h3>
      <p className={css.muted}>
        Las acciones destructivas (suspender, forzar re-sync del badge, impersonar) llegan en Fase
        C. Por ahora los flags son read-only y los procesas desde los módulos existentes de OPS
        (Backfill Verified, Tax Reviews, Payout Queue).
      </p>
      <code className={css.codeHint}>userId: {userId}</code>
    </section>
  </>
);

export default UserDrawer;
