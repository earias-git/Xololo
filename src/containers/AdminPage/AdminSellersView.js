import React, { useEffect, useState } from 'react';

import { apiBaseUrl } from '../../util/api';
import { IconSpinner } from '../../components';

import { formatMxn, fetchJson, ErrorBox } from './adminUtils';
import css from './AdminPage.module.css';

// XOLOLO F3 · Fase 3: ranking de sellers por revenue (últimos 30 días).

const AdminSellersView = () => {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    fetchJson(`${apiBaseUrl()}/api/admin/sellers-ranking`).then(
      d => setState({ status: 'ok', data: d, error: null }),
      e => setState({ status: 'error', data: null, error: e.message, code: e.status })
    );
  }, []);

  if (state.status === 'loading') {
    return (
      <div className={css.loading}>
        <IconSpinner /> <p>Cargando ranking de sellers…</p>
      </div>
    );
  }
  if (state.status === 'error') return <ErrorBox error={state.error} code={state.code} />;

  const sellers = state.data.sellers;
  return (
    <>
      <header className={css.header}>
        <h2 className={css.pageTitle}>Sellers destacados</h2>
        <p className={css.pageSubtitle}>
          Ranking por revenue en los últimos 30 días · {sellers.length} sellers con ventas
        </p>
      </header>
      {sellers.length === 0 ? (
        <div className={css.emptyBox}>
          <p>Sin ventas en el período.</p>
        </div>
      ) : (
        <div className={css.tableWrap}>
          <table className={css.table}>
            <thead>
              <tr>
                <th style={{ width: '5%' }}>#</th>
                <th style={{ width: '40%' }}>Seller</th>
                <th className={css.numeric}># tx</th>
                <th className={css.numeric}>Revenue</th>
                <th className={css.numeric}>Comisión</th>
                <th>Tienda</th>
              </tr>
            </thead>
            <tbody>
              {sellers.map((s, i) => (
                <tr key={s.sellerId}>
                  <td>{i + 1}</td>
                  <td>
                    <div>
                      <strong>{s.name || '—'}</strong>
                      <div className={css.sellerEmail}>{s.email}</div>
                    </div>
                  </td>
                  <td className={css.numeric}>{s.txCount}</td>
                  <td className={css.numeric}>{formatMxn(s.revenue)}</td>
                  <td className={css.numeric}>{formatMxn(s.commission)}</td>
                  <td>
                    {s.storeUrl ? (
                      <a href={s.storeUrl} target="_blank" rel="noreferrer" className={css.storeLink}>
                        {s.storeSlug} ↗
                      </a>
                    ) : (
                      <span className={css.storeMissing}>sin subdominio</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

export default AdminSellersView;
