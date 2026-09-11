import React from 'react';
import loadable from '@loadable/component';

import { bool, object } from 'prop-types';
import { compose } from 'redux';
import { connect } from 'react-redux';

import { camelize } from '../../util/string';
import { propTypes } from '../../util/types';

import FallbackPage from './FallbackPage';
import { ASSET_NAME } from './LandingPage.duck';
import { fetchFeaturedListings } from '../../ducks/featuredListings.duck';
import { getListingsById } from '../../ducks/marketplaceData.duck';
import { getFeaturedListingsProps } from '../../util/data';

// XOLOLO: piezas custom del landing (hero carrusel, banda de confianza, riel
// de categorías, tarjetas promocionales). Se colocan alrededor de las
// secciones hospedadas para acercar el look al mockup sin depender del
// PageBuilder para todo.
import HeroCarousel from '../../components/HeroCarousel/HeroCarousel';
import TrustBar from '../../components/TrustBar/TrustBar';
import CategoryRail from '../../components/CategoryRail/CategoryRail';
import PromoCards from '../../components/PromoCards/PromoCards';
import FeaturedListings from '../../components/FeaturedListings/FeaturedListings';
import FeaturedStores from '../../components/FeaturedStores/FeaturedStores';
import VerifiedBand from '../../components/VerifiedBand/VerifiedBand';
import AppBand from '../../components/AppBand/AppBand';
import heroSlides from '../../config/heroSlides';
import trustItems from '../../config/trustItems';
import categories from '../../config/categories';
import promoCards from '../../config/promoCards';
import { featuredProducts, featuredServices } from '../../config/featuredListings';
import featuredStores from '../../config/featuredStores';

const PageBuilder = loadable(() =>
  import(/* webpackChunkName: "PageBuilder" */ '../PageBuilder/PageBuilder')
);

// XOLOLO: filtra las secciones hospedadas del landing porque el layout
// completo se arma ahora con componentes custom que replican el mockup:
// - 'hero' -> HeroCarousel + TrustBar arriba
// - 'columns' -> reemplazadas por PromoCards + FeaturedListings + FeaturedStores
// - 'carousel' (Categorias) -> CategoryRail
// Al filtrar por tipo dejamos el asset hospedado disponible por si se quiere
// reactivar alguna sección de Console sin cambiar código; para eso basta con
// remover ese `sectionType` del set.
const stripCustomizedSections = pageData => {
  if (!pageData?.sections?.length) return pageData;
  const removed = new Set(['hero', 'columns', 'carousel']);
  const sections = pageData.sections.filter(s => !removed.has(s.sectionType));
  if (sections.length === pageData.sections.length) return pageData;
  return { ...pageData, sections };
};

export const LandingPageComponent = props => {
  const { pageAssetsData, inProgress, error } = props;
  const pageData = pageAssetsData?.[camelize(ASSET_NAME)]?.data;
  const dataForBuilder = stripCustomizedSections(pageData);

  return (
    <PageBuilder
      pageAssetsData={dataForBuilder}
      inProgress={inProgress}
      error={error}
      fallbackPage={<FallbackPage error={error} />}
      featuredListings={getFeaturedListingsProps(camelize(ASSET_NAME), props)}
      beforeSections={
        <>
          <HeroCarousel slides={heroSlides} />
          <TrustBar items={trustItems} />
        </>
      }
      afterSections={
        <>
          <CategoryRail categories={categories} />
          <PromoCards cards={promoCards} />
          <FeaturedListings
            title="Productos destacados"
            seeAllLabel="Ver todos los productos"
            seeAllHref="/s?pub_listingType=product"
            items={featuredProducts}
          />
          <FeaturedListings
            title="Servicios populares"
            seeAllLabel="Ver todos los servicios"
            seeAllHref="/s?pub_listingType=service"
            items={featuredServices}
          />
          <FeaturedStores stores={featuredStores} />
          <VerifiedBand />
          <AppBand />
        </>
      }
    />
  );
};

LandingPageComponent.propTypes = {
  pageAssetsData: object,
  inProgress: bool,
  error: propTypes.error,
};

const mapStateToProps = state => {
  const { pageAssetsData, inProgress, error } = state.hostedAssets || {};
  const featuredListingData = state.featuredListings || {};

  const getListingEntitiesById = listingIds => getListingsById(state, listingIds);

  return { pageAssetsData, featuredListingData, getListingEntitiesById, inProgress, error };
};

const mapDispatchToProps = dispatch => ({
  onFetchFeaturedListings: (sectionId, parentPage, listingImageConfig, allSections) =>
    dispatch(fetchFeaturedListings({ sectionId, parentPage, listingImageConfig, allSections })),
});

// Note: it is important that the withRouter HOC is **outside** the
// connect HOC, otherwise React Router won't rerender any Route
// components since connect implements a shouldComponentUpdate
// lifecycle hook.
//
// See: https://github.com/ReactTraining/react-router/issues/4671
const LandingPage = compose(
  connect(
    mapStateToProps,
    mapDispatchToProps
  )
)(LandingPageComponent);

export default LandingPage;
