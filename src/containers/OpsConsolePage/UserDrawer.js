import React, { useCallback, useEffect, useRef, useState } from 'react';

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
          <TabBtn active={tab === 'summary'} onClick={() => setTab('summary')} label="Resumen" />
          <TabBtn
            active={tab === 'membership'}
            onClick={() => setTab('membership')}
            label="Membresía"
          />
          <TabBtn
            active={tab === 'catalog'}
            onClick={() => setTab('catalog')}
            label="Catálogo"
            count={d?.listings?.length}
          />
          <TabBtn
            active={tab === 'transactions'}
            onClick={() => setTab('transactions')}
            label="Transacciones"
            count={d?.transactions?.length}
          />
          <TabBtn active={tab === 'activity'} onClick={() => setTab('activity')} label="Actividad" />
          <TabBtn
            active={tab === 'moderation'}
            onClick={() => setTab('moderation')}
            label="Moderación"
            count={d?.flags?.length}
          />
          <TabBtn
            active={tab === 'notes'}
            onClick={() => setTab('notes')}
            label="Notas"
            count={d?.notes?.length}
          />
        </nav>

        <div className={css.drawerBody}>
          {state.loading ? (
            <p className={css.loading}>Cargando perfil…</p>
          ) : state.error ? (
            <p className={css.error}>Error: {state.error}</p>
          ) : tab === 'summary' ? (
            <SummaryTab data={d} />
          ) : tab === 'membership' ? (
            <MembershipTab data={d} />
          ) : tab === 'catalog' ? (
            <CatalogTab listings={d.listings} />
          ) : tab === 'transactions' ? (
            <TransactionsTab transactions={d.transactions} />
          ) : tab === 'activity' ? (
            <ActivityTab data={d} />
          ) : tab === 'notes' ? (
            <NotesTab userId={userId} initialNotes={d.notes || []} onChange={load} />
          ) : (
            <ModerationTab
              userId={userId}
              flags={d.flags}
              auditLog={d.auditLog || []}
              data={d}
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
// Tab: Membresía
// ============================================================

const MembershipTab = ({ data }) => {
  const sub = data.subscription;
  const legal = data.legalDocs;
  const s = data.summary;
  return (
    <>
      <section className={css.section}>
        <h3 className={css.sectionTitle}>Suscripción</h3>
        {sub ? (
          <dl className={css.dl}>
            <dt>Status</dt>
            <dd>
              <span className={`${css.badge} ${css[`sub_${sub.status}`]}`}>{sub.status}</span>
            </dd>
            <dt>Plan</dt>
            <dd>{sub.plan || '—'}</dd>
            <dt>Próxima renovación</dt>
            <dd>{sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleString('es-MX') : '—'}</dd>
            <dt>Cancelación programada</dt>
            <dd>{sub.cancelAt ? new Date(sub.cancelAt).toLocaleString('es-MX') : '—'}</dd>
            <dt>Última factura</dt>
            <dd>{sub.lastInvoiceAt ? new Date(sub.lastInvoiceAt).toLocaleString('es-MX') : '—'}</dd>
          </dl>
        ) : (
          <p className={css.muted}>
            Sin suscripción activa.{' '}
            {s.sellerMode === 'casual_reseller'
              ? '(casual reseller — no paga suscripción por diseño)'
              : null}
          </p>
        )}
      </section>

      <section className={css.section}>
        <h3 className={css.sectionTitle}>Stripe Connect</h3>
        <dl className={css.dl}>
          <dt>Cuenta conectada</dt>
          <dd>{s.stripeConnected ? '✓ Sí' : '✗ No'}</dd>
        </dl>
      </section>

      <section className={css.section}>
        <h3 className={css.sectionTitle}>
          Documentos legales ({legal?.summary?.approved || 0}/{legal?.summary?.total || 0})
        </h3>
        {legal?.slots?.length ? (
          <ul className={css.legalList}>
            {legal.slots.map(slot => (
              <li key={slot.key}>
                <span className={`${css.legalBadge} ${css[`legal_${slot.status}`]}`}>
                  {slot.status}
                </span>
                <strong>{slot.key}</strong>
                {slot.approvedAt ? (
                  <small className={css.muted}>· aprobado {new Date(slot.approvedAt).toLocaleDateString('es-MX')}</small>
                ) : slot.rejectionReason ? (
                  <small className={css.muted}>· {slot.rejectionReason}</small>
                ) : slot.uploadedAt ? (
                  <small className={css.muted}>· subido {new Date(slot.uploadedAt).toLocaleDateString('es-MX')}</small>
                ) : null}
                {slot.url ? (
                  <a href={slot.url} target="_blank" rel="noreferrer" className={css.docLink}>
                    ver →
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className={css.muted}>Este user no ha subido documentos.</p>
        )}
      </section>
    </>
  );
};

// ============================================================
// Tab: Transacciones
// ============================================================

const TransactionsTab = ({ transactions }) => {
  const [role, setRole] = useState('all');
  const filtered = transactions.filter(t => role === 'all' || t.role === role);
  const sales = transactions.filter(t => t.role === 'sold');
  const bought = transactions.filter(t => t.role === 'bought');
  const avg = sales.length ? sales.reduce((s, t) => s + (t.amount || 0), 0) / sales.length : 0;

  if (!transactions.length) {
    return <p className={css.muted}>Sin transacciones.</p>;
  }

  return (
    <>
      <div className={css.kpiGrid}>
        <div className={css.kpi}>
          <div className={css.kpiLabel}>Ventas</div>
          <div className={css.kpiValue}>{sales.length}</div>
        </div>
        <div className={css.kpi}>
          <div className={css.kpiLabel}>Compras</div>
          <div className={css.kpiValue}>{bought.length}</div>
        </div>
        <div className={css.kpi}>
          <div className={css.kpiLabel}>Ticket prom. venta</div>
          <div className={css.kpiValue}>{avg ? `$${avg.toFixed(2)}` : '—'}</div>
        </div>
      </div>

      <div className={css.catalogFilters}>
        <select value={role} onChange={e => setRole(e.target.value)} className={css.select}>
          <option value="all">Todas ({transactions.length})</option>
          <option value="sold">Ventas ({sales.length})</option>
          <option value="bought">Compras ({bought.length})</option>
        </select>
      </div>

      <table className={css.innerTable}>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Rol</th>
            <th>Contraparte</th>
            <th>Listing</th>
            <th>Monto</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(t => (
            <tr key={t.id}>
              <td>{t.createdAt ? new Date(t.createdAt).toLocaleDateString('es-MX') : '—'}</td>
              <td>
                <span className={`${css.badge} ${t.role === 'sold' ? css.sub_active : css.type_buyer_only}`}>
                  {t.role === 'sold' ? 'vendió' : 'compró'}
                </span>
              </td>
              <td>{t.counterpartyName || '—'}</td>
              <td>{t.listingTitle || '—'}</td>
              <td className={css.numeric}>{t.amount != null ? `$${t.amount.toFixed(2)}` : '—'}</td>
              <td>{t.state || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
};

// ============================================================
// Tab: Actividad
// ============================================================

const ActivityTab = ({ data }) => {
  const s = data.summary;
  const audit = data.auditLog || [];
  return (
    <>
      <section className={css.section}>
        <h3 className={css.sectionTitle}>Últimas señales</h3>
        <dl className={css.dl}>
          <dt>Last seen (heartbeat)</dt>
          <dd>{s.lastSeenAt ? `${timeAgo(s.lastSeenAt)} · ${new Date(s.lastSeenAt).toLocaleString('es-MX')}` : '—'}</dd>
          <dt>Alta</dt>
          <dd>{s.createdAt ? `${timeAgo(s.createdAt)} · ${new Date(s.createdAt).toLocaleString('es-MX')}` : '—'}</dd>
        </dl>
        <p className={css.muted}>
          El heartbeat se dispara cada vez que el user carga la app + cada 5 min + al focus de la
          pestaña. Dedupe server-side a 60s. Si lastSeenAt está muy atrás, probablemente el user
          no entra desde entonces.
        </p>
      </section>

      <section className={css.section}>
        <h3 className={css.sectionTitle}>Audit log ({audit.length})</h3>
        {audit.length ? (
          <ul className={css.flagList}>
            {audit.slice(0, 50).map(a => (
              <li key={a.id} className={css.auditEntry}>
                <div className={css.auditHead}>
                  <strong>{a.action}</strong>
                  <small>{a.at ? new Date(a.at).toLocaleString('es-MX') : ''}</small>
                </div>
                <small className={css.muted}>
                  por {a.by?.name || a.by?.email || 'operator'}
                  {a.result ? ` · ${a.result}` : ''}
                </small>
                {a.payload ? (
                  <pre className={css.auditPayload}>{JSON.stringify(a.payload, null, 2)}</pre>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className={css.muted}>Aún no hay acciones ops registradas en este user.</p>
        )}
      </section>
    </>
  );
};

// ============================================================
// Tab: Notas internas
// ============================================================

const NotesTab = ({ userId, initialNotes, onChange }) => {
  const [notes, setNotes] = useState(initialNotes);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const textareaRef = useRef(null);

  const submit = async e => {
    e.preventDefault();
    if (!draft.trim() || saving) return;
    setSaving(true);
    setError(null);
    const r = await api(`/api/admin/ops/users/${userId}/notes`, {
      method: 'POST',
      body: { text: draft },
    });
    setSaving(false);
    if (!r.ok) {
      setError(r.data?.error || 'error_al_guardar');
      return;
    }
    setNotes([r.data.note, ...notes]);
    setDraft('');
    onChange?.();
    textareaRef.current?.focus();
  };

  const remove = async noteId => {
    if (!window.confirm('¿Eliminar esta nota? Solo tú o un super_admin pueden hacerlo.')) return;
    const r = await api(`/api/admin/ops/users/${userId}/notes/${noteId}`, { method: 'DELETE' });
    if (r.ok) {
      setNotes(notes.filter(n => n.id !== noteId));
      onChange?.();
    } else {
      alert(`Error: ${r.data?.error || 'no_se_pudo'}`);
    }
  };

  return (
    <>
      <form onSubmit={submit} className={css.noteForm}>
        <textarea
          ref={textareaRef}
          className={css.noteTextarea}
          placeholder="Agregar nota interna (ej. 'llamada 2026-10-28: pidió prórroga de pago')"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={3}
          maxLength={5000}
        />
        <div className={css.noteFormBar}>
          <small className={css.muted}>{draft.length}/5000 · Solo visible para operators</small>
          <button
            type="submit"
            disabled={!draft.trim() || saving}
            className={css.notePrimaryBtn}
          >
            {saving ? 'Guardando…' : 'Agregar nota'}
          </button>
        </div>
        {error ? <p className={css.error}>Error: {error}</p> : null}
      </form>

      {notes.length === 0 ? (
        <p className={css.muted}>Aún no hay notas sobre este user.</p>
      ) : (
        <ul className={css.notesList}>
          {notes.map(n => (
            <li key={n.id} className={css.note}>
              <div className={css.noteHead}>
                <strong>{n.by?.name || n.by?.email || 'operator'}</strong>
                <small>{timeAgo(n.at)}</small>
              </div>
              <p className={css.noteText}>{n.text}</p>
              <button type="button" className={css.noteDelete} onClick={() => remove(n.id)}>
                Eliminar
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
};

// ============================================================
// Tab: Moderación (con acciones Fase C)
// ============================================================

const ModerationTab = ({ userId, flags, auditLog, data, onActionDone }) => {
  const [action, setAction] = useState(null); // 'suspend'|'unsuspend'|'resync'|'impersonate'|null
  const [reason, setReason] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const suspension = data?.summary?.suspension;
  const isSuspended = !!suspension?.suspended;

  const closeModal = () => {
    setAction(null);
    setReason('');
    setTotpCode('');
    setErr(null);
    setBusy(false);
  };

  const confirm = async () => {
    setBusy(true);
    setErr(null);
    let path = '';
    let body = {};
    if (action === 'suspend') { path = `/api/admin/ops/users/${userId}/suspend`; body = { reason }; }
    else if (action === 'unsuspend') { path = `/api/admin/ops/users/${userId}/unsuspend`; body = { reason }; }
    else if (action === 'resync') { path = `/api/admin/ops/users/${userId}/resync-badge`; body = {}; }
    else if (action === 'impersonate') { path = `/api/admin/ops/users/${userId}/impersonate`; body = { reason, totpCode }; }
    const r = await api(path, { method: 'POST', body });
    setBusy(false);
    if (!r.ok) {
      const code = r.data?.error || 'error';
      const msg = {
        reason_required: 'El motivo debe tener al menos 10 caracteres.',
        reason_too_long: 'Motivo demasiado largo.',
        invalid_totp_format: 'El código TOTP debe tener 6 dígitos.',
        invalid_totp: 'Código TOTP incorrecto.',
        operator_mfa_not_enrolled: 'Debes activar MFA en tu cuenta para impersonar.',
      }[code] || `Error: ${code}`;
      setErr(msg);
      return;
    }
    if (action === 'impersonate' && r.data?.redirectUrl) {
      window.location.href = r.data.redirectUrl;
      return;
    }
    closeModal();
    onActionDone?.();
  };

  return (
    <>
      <section className={css.section}>
        <h3 className={css.sectionTitle}>Estado del user</h3>
        {isSuspended ? (
          <div className={`${css.flag} ${css.flag_error}`}>
            <strong>⛔ Suspendido</strong>
            <p>{suspension.reason}</p>
            <small>
              por {suspension.by?.email || '—'} · {timeAgo(suspension.at)}
            </small>
          </div>
        ) : (
          <p className={css.muted}>Activo — sin suspensiones.</p>
        )}
      </section>

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
        <h3 className={css.sectionTitle}>Acciones ops recientes</h3>
        {auditLog?.length ? (
          <ul className={css.auditSummaryList}>
            {auditLog.slice(0, 5).map(a => (
              <li key={a.id}>
                <strong>{a.action}</strong>
                <small>
                  {' '}
                  por {a.by?.name || a.by?.email || '—'}, {timeAgo(a.at)}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <p className={css.muted}>Sin acciones ops registradas aún.</p>
        )}
      </section>

      <section className={css.section}>
        <h3 className={css.sectionTitle}>Acciones</h3>
        <div className={css.actionBar}>
          <button
            type="button"
            className={css.secondaryBtn}
            onClick={() => setAction('resync')}
          >
            🔁 Resync Verified badge
          </button>
          {isSuspended ? (
            <button
              type="button"
              className={css.secondaryBtn}
              onClick={() => setAction('unsuspend')}
            >
              ✓ Levantar suspensión
            </button>
          ) : (
            <button
              type="button"
              className={css.dangerBtn}
              onClick={() => setAction('suspend')}
            >
              ⛔ Suspender
            </button>
          )}
          <button
            type="button"
            className={css.dangerBtn}
            onClick={() => setAction('impersonate')}
          >
            👁 Ingresar como este user (MFA)
          </button>
        </div>
      </section>

      {action ? (
        <ActionModal
          action={action}
          reason={reason}
          setReason={setReason}
          totpCode={totpCode}
          setTotpCode={setTotpCode}
          busy={busy}
          err={err}
          onClose={closeModal}
          onConfirm={confirm}
        />
      ) : null}
    </>
  );
};

const ACTION_LABELS = {
  suspend: {
    title: 'Suspender user',
    confirm: 'Suspender',
    danger: true,
    needsReason: true,
    needsTotp: false,
    hint: 'El user no podrá publicar listings nuevos ni completar transacciones. Documenta el motivo.',
  },
  unsuspend: {
    title: 'Levantar suspensión',
    confirm: 'Reactivar',
    danger: false,
    needsReason: true,
    needsTotp: false,
    hint: 'Documenta por qué levantas la suspensión (quedará en el audit log).',
  },
  resync: {
    title: 'Resincronizar badge Verified',
    confirm: 'Correr resync',
    danger: false,
    needsReason: false,
    needsTotp: false,
    hint: 'Re-evalúa los 4 criterios (sub activa, Stripe conectado, perfil completo, docs legales aprobados) y actualiza el badge si cambió.',
  },
  impersonate: {
    title: 'Ingresar como este user',
    confirm: 'Impersonar',
    danger: true,
    needsReason: true,
    needsTotp: true,
    hint: 'Vas a entrar al marketplace con la identidad del user. La acción queda registrada en el audit log junto al motivo. Re-ingresa tu código MFA para confirmar.',
  },
};

const ActionModal = ({
  action,
  reason,
  setReason,
  totpCode,
  setTotpCode,
  busy,
  err,
  onClose,
  onConfirm,
}) => {
  const cfg = ACTION_LABELS[action];
  const canSubmit =
    !busy &&
    (!cfg.needsReason || reason.trim().length >= 10) &&
    (!cfg.needsTotp || /^\d{6}$/.test(totpCode.replace(/\s+/g, '')));

  return (
    <div className={css.modalBackdrop} onClick={onClose} role="presentation">
      <div className={css.modalCard} onClick={e => e.stopPropagation()} role="dialog">
        <h3 className={css.modalTitle}>{cfg.title}</h3>
        <p className={css.muted}>{cfg.hint}</p>

        {cfg.needsReason ? (
          <label className={css.modalLabel}>
            Motivo (mín. 10 caracteres)
            <textarea
              className={css.noteTextarea}
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              autoFocus
            />
          </label>
        ) : null}

        {cfg.needsTotp ? (
          <label className={css.modalLabel}>
            Tu código MFA (6 dígitos)
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              className={css.modalInput}
              value={totpCode}
              onChange={e => setTotpCode(e.target.value)}
              maxLength={6}
              placeholder="123456"
            />
          </label>
        ) : null}

        {err ? <p className={css.error}>{err}</p> : null}

        <div className={css.modalActions}>
          <button type="button" className={css.secondaryBtn} onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className={cfg.danger ? css.dangerBtn : css.notePrimaryBtn}
            onClick={onConfirm}
            disabled={!canSubmit}
          >
            {busy ? 'Procesando…' : cfg.confirm}
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// Helpers
// ============================================================

const TabBtn = ({ active, onClick, label, count }) => (
  <button type="button" className={active ? css.tabActive : css.tab} onClick={onClick}>
    {label}
    {count != null ? ` (${count})` : ''}
  </button>
);

export default UserDrawer;
