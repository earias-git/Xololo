import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { Helmet } from 'react-helmet-async';

import { apiBaseUrl } from '../../util/api';
import { isScrollingDisabled } from '../../ducks/ui.duck';
import { Page, LayoutSingleColumn } from '../../components';
import TopbarContainer from '../../containers/TopbarContainer/TopbarContainer';
import FooterContainer from '../../containers/FooterContainer/FooterContainer';
import FeaturedStores from '../../components/FeaturedStores/FeaturedStores';

import css from './TiendasVerifiedPage.module.css';

// XOLOLO: directorio público de tiendas Xololo Verified™.
//
// Reutiliza el endpoint /api/featured-stores con `verified=true`. El filtro
// vive server-side (lee publicData.xololoVerified que syncVerifiedBadge
// mantiene actualizado — ver api-util/sellerVerified.js). Cada card es un
// link al storefront real del seller (slug.xololo.mx), no al listing
// filtrado del marketplace.
//
// Fetch client-side (sin loadData/SSR por ahora): el objetivo primario es
// que el CTA "Ver tiendas" del VerifiedBand aterrice en algo honesto. Si
// más adelante queremos SEO fuerte en este directorio, agregamos un
// TiendasVerifiedPage.duck con loadData y lo registramos en
// pageDataLoadingAPI.

const PAGE_LIMIT = 48;

const TiendasVerifiedPage = () => {
  const scrollingDisabled = useSelector(isScrollingDisabled);
  const [state, setState] = useState({ status: 'loading', stores: [], error: null });

  useEffect(() => {
    let aborted = false;
    fetch(`${apiBaseUrl()}/api/featured-stores?verified=true&limit=${PAGE_LIMIT}`)
      .then(r => r.json())
      .then(data => {
        if (aborted) return;
        setState({ status: 'ok', stores: data.stores || [], error: null });
      })
      .catch(err => {
        if (aborted) return;
        setState({ status: 'error', stores: [], error: err?.message || 'fetch_failed' });
      });
    return () => {
      aborted = true;
    };
  }, []);

  const title = 'Tiendas Xololo Verified™';
  const description =
    'Directorio de tiendas que cumplen los 4 filtros Xololo Verified: identidad validada, documentos legales aprobados, cuenta de cobros registrada y suscripción activa.';

  return (
    <Page
      title={title}
      description={description}
      scrollingDisabled={scrollingDisabled}
      schema={{
        '@context': 'http://schema.org',
        '@type': 'CollectionPage',
        name: title,
        description,
      }}
    >
      <Helmet>
        <link rel="canonical" href="https://xololo.mx/tiendas-verified" />
      </Helmet>
      <LayoutSingleColumn
        topbar={<TopbarContainer />}
        footer={<FooterContainer />}
      >
        <section className={css.hero}>
          <div className={css.heroInner}>
            <p className={css.eyebrow}>Confianza bidireccional</p>
            <h1 className={css.heroTitle}>Tiendas Xololo Verified™</h1>
            <p className={css.heroDesc}>
              Cada tienda de este directorio pasó los 4 filtros de Xololo
              Verified: identidad validada, documentos legales aprobados,
              cuenta de cobros registrada y suscripción activa. Compra sin
              miedo.
            </p>
          </div>
        </section>

        {state.status === 'loading' ? (
          <div className={css.feedback}>Cargando tiendas…</div>
        ) : null}

        {state.status === 'error' ? (
          <div className={css.feedback}>
            No pudimos cargar el directorio ahora. Intenta más tarde.
          </div>
        ) : null}

        {state.status === 'ok' && state.stores.length === 0 ? (
          <div className={css.feedback}>
            Aún no hay tiendas Verified publicadas. Vuelve pronto.
          </div>
        ) : null}

        {state.status === 'ok' && state.stores.length > 0 ? (
          <FeaturedStores
            title={`${state.stores.length} ${
              state.stores.length === 1 ? 'tienda verificada' : 'tiendas verificadas'
            }`}
            stores={state.stores}
          />
        ) : null}
      </LayoutSingleColumn>
    </Page>
  );
};

export default TiendasVerifiedPage;
