import React, { useEffect, useState } from 'react';

import { apiBaseUrl } from '../../util/api';
import { IconSpinner } from '../../components';

import { formatNumber, fetchJson, Kpi, ErrorBox } from './adminUtils';
import css from './AdminPage.module.css';

// XOLOLO F3 · ampliación admin: tráfico — vistas de listings (xololo.mx)
// y vistas de storefronts ({slug}.xololo.mx), por source. Consume
// /api/admin/overview (compartido con Catálogo y Usuarios).
//
// Fuente de la data:
//   - listingViews: agregado de listing.metadata.xololoAnalytics
//     (Sprint 2 — listing.viewed por source).
//   - storeViews: agregado de user.profile.metadata.xololoStoreAnalytics
//     (store.viewed — nuevo, alimenta esta vista específicamente).

const SOURCE_LABELS = {
  direct: 'Directo',
  xololo: 'Xololo (buscador)',
  seller_store: 'Tienda del seller',
  facebook: 'Facebook',
  instagram: 'Instagram',
  whatsapp: 'WhatsApp',
  twitter: 'X / Twitter',
  tiktok: 'TikTok',
  search: 'Buscadores',
  other: 'Otro',
};

const SourceBreakdown = ({ bySource, total }) => {
  const entries = Object.entries(bySource || {}).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return <p className={css.emptyInline}>Sin vistas registradas todavía.</p>;
  }
  return (
    <ul className={css.sourceList}>
      {entries.map(([source, n]) => {
        const pct = total > 0 ? Math.round((n / total) * 100) : 0;
        return (
          <li key={source} className={css.sourceRow}>
            <span className={css.sourceLabel}>{SOURCE_LABELS[source] || source}</span>
            <span className={css.sourceBarTrack}>
              <span className={css.sourceBarFill} style={{ width: `${pct}%` }} />
            </span>
            <span className={css.sourceValue}>
              {formatNumber(n)} <span className={css.sourcePct}>({pct}%)</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
};

const AdminTrafficView = () => {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    fetchJson(`${apiBaseUrl()}/api/admin/overview?months=6`).then(
      d => setState({ status: 'ok', data: d, error: null }),
      e => setState({ status: 'error', data: null, error: e.message, code: e.status })
    );
  }, []);

  if (state.status === 'loading') {
    return (
      <div className={css.loading}>
        <IconSpinner /> <p>Agregando tráfico…</p>
      </div>
    );
  }
  if (state.status === 'error') return <ErrorBox error={state.error} code={state.code} />;

  const { traffic } = state.data;

  return (
    <>
      <header className={css.header}>
        <h2 className={css.pageTitle}>Tráfico</h2>
        <p className={css.pageSubtitle}>
          Vistas de productos y tiendas, histórico completo
          {state.data.cached ? <span className={css.cachedBadge}> · caché 10min</span> : null}
        </p>
      </header>

      <div className={css.kpiGrid}>
        <Kpi label="Vistas a productos" value={formatNumber(traffic.listingViews.total)} tone="active" />
        <Kpi label="Vistas a tiendas" value={formatNumber(traffic.storeViews.total)} tone="active" />
        <Kpi label="Productos con tráfico" value={formatNumber(traffic.topListings.length)} />
        <Kpi label="Tiendas con tráfico" value={formatNumber(traffic.topStores.length)} />
      </div>

      <div className={css.trafficGrid}>
        <section className={css.chartSection}>
          <h3 className={css.sectionTitle}>Vistas a productos por fuente</h3>
          <SourceBreakdown bySource={traffic.listingViews.bySource} total={traffic.listingViews.total} />
        </section>
        <section className={css.chartSection}>
          <h3 className={css.sectionTitle}>Vistas a tiendas por fuente</h3>
          <SourceBreakdown bySource={traffic.storeViews.bySource} total={traffic.storeViews.total} />
        </section>
      </div>

      <section className={css.chartSection}>
        <h3 className={css.sectionTitle}>Top productos por vistas</h3>
        {traffic.topListings.length === 0 ? (
          <div className={css.emptyBox}>
            <p>Sin datos de tráfico todavía.</p>
          </div>
        ) : (
          <div className={css.tableWrap}>
            <table className={css.table}>
              <thead>
                <tr>
                  <th style={{ width: '40%' }}>Producto</th>
                  <th>Seller</th>
                  <th className={css.numeric}>Vistas</th>
                  <th className={css.numeric}>Vendidos</th>
                  <th className={css.numeric}>Conversión</th>
                </tr>
              </thead>
              <tbody>
                {traffic.topListings.map(l => (
                  <tr key={l.listingId}>
                    <td>
                      <a href={`/l/${l.listingId}`} target="_blank" rel="noreferrer" className={css.storeLink}>
                        {l.title || 'Producto'}
                      </a>
                    </td>
                    <td>{l.sellerName || '—'}</td>
                    <td className={css.numeric}>{formatNumber(l.views)}</td>
                    <td className={css.numeric}>{formatNumber(l.unitsSold)}</td>
                    <td className={css.numeric}>
                      {l.conversionPct == null ? '—' : `${l.conversionPct}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={css.chartSection}>
        <h3 className={css.sectionTitle}>Top tiendas por vistas</h3>
        {traffic.topStores.length === 0 ? (
          <div className={css.emptyBox}>
            <p>Sin datos de tráfico todavía.</p>
          </div>
        ) : (
          <div className={css.tableWrap}>
            <table className={css.table}>
              <thead>
                <tr>
                  <th style={{ width: '50%' }}>Tienda</th>
                  <th className={css.numeric}>Vistas</th>
                  <th>Link</th>
                </tr>
              </thead>
              <tbody>
                {traffic.topStores.map(s => (
                  <tr key={s.sellerId}>
                    <td>{s.sellerName || '—'}</td>
                    <td className={css.numeric}>{formatNumber(s.views)}</td>
                    <td>
                      {s.sellerSlug ? (
                        <a
                          href={`https://${s.sellerSlug}.xololo.mx`}
                          target="_blank"
                          rel="noreferrer"
                          className={css.storeLink}
                        >
                          {s.sellerSlug} ↗
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
      </section>

      <p className={css.footNote}>
        No incluye vistas de la home de xololo.mx (todavía no hay dónde persistir un
        contador global — se necesita una tabla/KV dedicada, ver DASHBOARDS_V1.md §5.4).
        Las vistas de productos y de tiendas individuales sí están completas desde
        que se activó el tracking.
      </p>
    </>
  );
};

export default AdminTrafficView;
