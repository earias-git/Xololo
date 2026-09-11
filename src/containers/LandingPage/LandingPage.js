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

// XOLOLO: hero carrusel custom, se renderiza antes del PageBuilder y sustituye
// visualmente la sección "hero" que trae el asset hospedado.
import HeroCarousel from '../../components/HeroCarousel/HeroCarousel';
import heroSlides from '../../config/heroSlides';

const PageBuilder = loadable(() =>
  import(/* webpackChunkName: "PageBuilder" */ '../PageBuilder/PageBuilder')
);

// XOLOLO: elimina la primera sección `hero` del asset del landing para que el
// PageBuilder no la duplique con el HeroCarousel custom. Deja intactas las
// demás secciones (Why this marketplace, How it works, Categorias, ...).
const stripHostedHero = pageData => {
  if (!pageData?.sections?.length) return pageData;
  const sections = pageData.sections.filter(s => s.sectionType !== 'hero');
  if (sections.length === pageData.sections.length) return pageData;
  return { ...pageData, sections };
};

export const LandingPageComponent = props => {
  const { pageAssetsData, inProgress, error } = props;
  const pageData = pageAssetsData?.[camelize(ASSET_NAME)]?.data;
  const dataWithoutHero = stripHostedHero(pageData);

  return (
    <PageBuilder
      pageAssetsData={dataWithoutHero}
      inProgress={inProgress}
      error={error}
      fallbackPage={<FallbackPage error={error} />}
      featuredListings={getFeaturedListingsProps(camelize(ASSET_NAME), props)}
      beforeSections={<HeroCarousel slides={heroSlides} />}
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
