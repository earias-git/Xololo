import React, { useEffect, useState } from 'react';

import { apiBaseUrl } from '../../util/api';
import { IconSpinner } from '../../components';

import { formatMxn, fetchJson, ErrorBox } from './adminUtils';
import css from './AdminPage.module.css';

// XOLOLO F3 · Fase 3: tx con xololoDispute abierto (últimos 90 días).

const AdminDisputesView = () => {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    fetchJson(`${apiBaseUrl()}/api/admin/disputes`).then(
      d => setState({ status: 'ok', data: d, error: null }),
      e => setState({ status: 'error', data: null, error: e.message, code: e.status })
    );
  }, []);

  if (state.status === 'loading') {
    return (
      <div className={css.loading}>
        <IconSpinner /> <p>Cargando disputas…</p>
      </div>
    );
  }
  if (state.status === 'error') return <ErrorBox error={state.error} code={state.code} />;

  const items = state.data.disputes;
  return (
    <>
      <header className={css.header}>
        <h2 className={css.pageTitle}>Disputas activas</h2>
        <p className={css.pageSubtitle}>
          {items.length} disputa{items.length === 1 ? '' : 's'} en los últimos 90 días
        </p>
      </header>
      {items.length === 0 ? (
        <div className={css.emptyBox}>
          <p>Sin disputas activas 👌</p>
        </div>
      ) : (
        <ul className={css.disputeList}>
          {items.map(d => (
            <li key={d.transactionId} className={css.disputeItem}>
              <div className={css.disputeHead}>
                <span className={css.disputeStatus}>{d.status}</span>
                <span className={css.disputeAmount}>{formatMxn(d.amountAtStake)}</span>
              </div>
              <p className={css.disputeListing}>{d.listing.title || 'Producto'}</p>
              <p className={css.disputeParties}>
                <strong>Buyer:</strong> {d.buyer.name} · {d.buyer.email}<br />
                <strong>Seller:</strong> {d.seller.name} · {d.seller.email}
              </p>
              {d.issueDetail ? (
                <p className={css.disputeIssue}>{d.issueDetail}</p>
              ) : null}
              <p className={css.disputeFoot}>
                <span>Abierta el {new Date(d.openedAt).toLocaleString('es-MX')}</span>
                <a
                  href={`/sale/${d.transactionId}/details`}
                  className={css.disputeLink}
                  target="_blank"
                  rel="noreferrer"
                >
                  Ver transacción →
                </a>
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
};

export default AdminDisputesView;
