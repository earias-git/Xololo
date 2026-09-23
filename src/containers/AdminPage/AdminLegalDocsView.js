import React, { useEffect, useState } from 'react';

import { apiBaseUrl } from '../../util/api';
import { IconSpinner } from '../../components';
import { STATUS_LABELS } from '../../config/legalDocSlots';

import { fetchJson, ErrorBox } from './adminUtils';
import css from './AdminPage.module.css';

// XOLOLO Track B (docs/SUBSCRIPTIONS_V1.md §2.3): cola de revisión de
// documentos legales de sellers. Lista sólo sellers con al menos un
// documento subido o personType elegido; pendientes primero.

const postJson = async (url, body) => {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'fetch_failed');
    err.status = res.status;
    throw err;
  }
  return data;
};

const DocReviewRow = ({ sellerId, slotKey, doc, onReviewed }) => {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const status = doc.status ? STATUS_LABELS[doc.status] : null;

  const review = async decision => {
    setBusy(true);
    try {
      await postJson(`${apiBaseUrl()}/api/admin/legal-docs/review`, {
        sellerId,
        slot: slotKey,
        status: decision,
        reviewNote: decision === 'rejected' ? note || null : null,
      });
      onReviewed();
    } catch (e) {
      // eslint-disable-next-line no-alert
      window.alert(`No se pudo actualizar: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={css.legalDocRow}>
      <div className={css.legalDocMain}>
        <p className={css.legalDocSlot}>{slotKey}</p>
        {status ? (
          <span className={`${css.statusPill} ${css[`statusPill--${status.tone}`]}`}>
            {status.text}
          </span>
        ) : null}
        {doc.reviewNote ? <p className={css.legalDocNote}>Nota previa: {doc.reviewNote}</p> : null}
      </div>
      <div className={css.legalDocActions}>
        {doc.url ? (
          <a href={doc.url} target="_blank" rel="noreferrer" className={css.disputeLink}>
            Ver archivo →
          </a>
        ) : null}
        {doc.status !== 'rejected' ? (
          <input
            type="text"
            placeholder="Motivo si rechazas…"
            value={note}
            onChange={e => setNote(e.target.value)}
            className={css.legalDocNoteInput}
            disabled={busy}
          />
        ) : null}
        <button
          type="button"
          className={css.legalDocApproveBtn}
          onClick={() => review('approved')}
          disabled={busy || doc.status === 'approved'}
        >
          Aprobar
        </button>
        <button
          type="button"
          className={css.legalDocRejectBtn}
          onClick={() => review('rejected')}
          disabled={busy || doc.status === 'rejected'}
        >
          Rechazar
        </button>
      </div>
    </li>
  );
};

const AdminLegalDocsView = () => {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  const load = () => {
    fetchJson(`${apiBaseUrl()}/api/admin/legal-docs`).then(
      d => setState({ status: 'ok', data: d, error: null }),
      e => setState({ status: 'error', data: null, error: e.message, code: e.status })
    );
  };

  useEffect(() => {
    load();
  }, []);

  if (state.status === 'loading') {
    return (
      <div className={css.loading}>
        <IconSpinner /> <p>Cargando documentos…</p>
      </div>
    );
  }
  if (state.status === 'error') return <ErrorBox error={state.error} code={state.code} />;

  const sellers = state.data.sellers;
  const pendingTotal = sellers.reduce((sum, s) => sum + s.pendingCount, 0);

  return (
    <>
      <header className={css.header}>
        <h2 className={css.pageTitle}>Documentos legales</h2>
        <p className={css.pageSubtitle}>
          {sellers.length} seller{sellers.length === 1 ? '' : 's'} con documentación ·{' '}
          {pendingTotal} documento{pendingTotal === 1 ? '' : 's'} en revisión
        </p>
      </header>
      {sellers.length === 0 ? (
        <div className={css.emptyBox}>
          <p>Todavía nadie ha subido documentos 👌</p>
        </div>
      ) : (
        <ul className={css.disputeList}>
          {sellers.map(s => (
            <li key={s.sellerId} className={css.disputeItem}>
              <div className={css.disputeHead}>
                <span className={css.disputeStatus}>
                  {s.personType === 'moral' ? 'Persona moral' : 'Persona física'}
                </span>
                {s.pendingCount > 0 ? (
                  <span className={`${css.statusPill} ${css['statusPill--pending']}`}>
                    {s.pendingCount} pendiente{s.pendingCount === 1 ? '' : 's'}
                  </span>
                ) : null}
              </div>
              <p className={css.disputeParties}>
                <strong>{s.name || 'Sin nombre'}</strong> · {s.email}
              </p>
              <ul className={css.legalDocList}>
                {Object.entries(s.docs).map(([slotKey, doc]) => (
                  <DocReviewRow
                    key={slotKey}
                    sellerId={s.sellerId}
                    slotKey={slotKey}
                    doc={doc}
                    onReviewed={load}
                  />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </>
  );
};

export default AdminLegalDocsView;
