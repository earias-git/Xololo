import React, { useEffect, useState } from 'react';
import loadable from '@loadable/component';

import { apiBaseUrl } from '../../util/api';
import { IconSpinner } from '../../components';

import { formatNumber, fetchJson, Kpi, ErrorBox } from './adminUtils';
import css from './AdminPage.module.css';

// XOLOLO F3 · ampliación admin: catálogo — #productos, #servicios y
// crecimiento mensual. Consume /api/admin/overview (mismo endpoint
// que Usuarios y Tráfico — cacheado 10min server-side, así que entrar
// a las 3 tabs seguidas no re-computa el scan completo cada vez).

const GrowthChartLazy = loadable(() => import('./AdminGrowthChart'));

const AdminCatalogView = () => {
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
        <IconSpinner /> <p>Escaneando el catálogo…</p>
      </div>
    );
  }
  if (state.status === 'error') return <ErrorBox error={state.error} code={state.code} />;

  const { catalog } = state.data;
  const total = catalog.totalPublished || 1; // evita división por 0 en %s

  return (
    <>
      <header className={css.header}>
        <h2 className={css.pageTitle}>Catálogo</h2>
        <p className={css.pageSubtitle}>
          {catalog.totalPublished} listings publicados en total
          {state.data.cached ? <span className={css.cachedBadge}> · caché 10min</span> : null}
        </p>
      </header>

      <div className={css.kpiGrid}>
        <Kpi
          label="Productos"
          value={formatNumber(catalog.productsCount)}
          hint={`${Math.round((catalog.productsCount / total) * 100)}% del catálogo`}
          tone="active"
        />
        <Kpi
          label="Servicios"
          value={formatNumber(catalog.servicesCount)}
          hint={`${Math.round((catalog.servicesCount / total) * 100)}% del catálogo`}
          tone="ok"
        />
        <Kpi
          label="Otros"
          value={formatNumber(catalog.otherCount)}
          hint="Inquiry, ofertas, etc."
        />
        <Kpi label="Total publicados" value={formatNumber(catalog.totalPublished)} tone="revenue" />
      </div>

      <section className={css.chartSection}>
        <h3 className={css.sectionTitle}>Crecimiento del catálogo (últimos 6 meses)</h3>
        <GrowthChartLazy growth={catalog.growth} />
      </section>

      <p className={css.footNote}>
        Clasificación producto/servicio inferida de <code>publicData.unitType</code>{' '}
        (&apos;item&apos; = producto; &apos;hour&apos;/&apos;day&apos;/&apos;night&apos;/&apos;fixed&apos; = servicio).
        Sharetribe no tiene un campo booleano dedicado para esto.
      </p>
    </>
  );
};

export default AdminCatalogView;
