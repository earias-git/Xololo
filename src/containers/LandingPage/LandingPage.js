import React, { useEffect } from 'react';
import loadable from '@loadable/component';

import { bool, object, func } from 'prop-types';
import { compose } from 'redux';
import { connect, useSelector } from 'react-redux';

import { useBuyerLocation } from '../../hooks/useBuyerLocation';

import { camelize } from '../../util/string';
import { propTypes } from '../../util/types';

import FallbackPage from './FallbackPage';
import { ASSET_NAME } from './LandingPage.duck';
import { fetchFeaturedListings } from '../../ducks/featuredListings.duck';
import {
  fetchLandingListings,
  selectFeaturedProducts,
  selectFeaturedServices,
  selectFeaturedUsed,
  selectLandingListingsLoading,
} from '../../ducks/landingListings.duck';
import { fetchLandingStores, selectLandingStores } from '../../ducks/landingStores.duck';
import { getListingsById } from '../../ducks/marketplaceData.duck';
import { selectStorefrontSlug } from '../../ducks/storefrontSubdomain.duck';
import { getFeaturedListingsProps } from '../../util/data';

import StorefrontPage from '../StorefrontPage/StorefrontPage';

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
import XololearBand from '../../components/XololearBand/XololearBand';
import UsedGoodsBand from '../../components/UsedGoodsBand/UsedGoodsBand';
import AppBand from '../../components/AppBand/AppBand';
import heroSlides from '../../config/heroSlides';
import trustItems from '../../config/trustItems';
import categories from '../../config/categories';
import promoCards from '../../config/promoCards';
import {
  featuredProducts as featuredProductsPlaceholder,
  featuredServices as featuredServicesPlaceholder,
} from '../../config/featuredListings';
import featuredStoresPlaceholder from '../../config/featuredStores';

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
  const {
    pageAssetsData,
    inProgress,
    error,
    onFetchLandingListings,
    onFetchLandingStores,
    featuredStores,
    featuredLoading,
    storefrontSlug,
  } = props;

  // XOLOLO Task #17: lee ubicación del buyer y la pasa a los selectores,
  // que reordenan cada riel para poner primero lo que coincide con el
  // estado del buyer. Sin ubicación → orden global por fecha (default).
  const { location: buyerLocation } = useBuyerLocation();
  const buyerState = buyerLocation?.state || null;
  const buyerCity = buyerLocation?.city || null;
  const featuredProducts = useSelector(selectFeaturedProducts(buyerState));
  const featuredServices = useSelector(selectFeaturedServices(buyerState));
  const featuredUsed = useSelector(selectFeaturedUsed(buyerState));

  // XOLOLO: si el server detectó un subdominio de storefront, saltamos el
  // marketplace general y renderizamos la tienda del seller.
  // Efectos y transformaciones del marketplace ni se disparan.
  if (storefrontSlug) {
    return <StorefrontPage />;
  }

  const pageData = pageAssetsData?.[camelize(ASSET_NAME)]?.data;
  const dataForBuilder = stripCustomizedSections(pageData);

  // XOLOLO: fetch de listings reales al montar el landing. Si el fetch
  // regresa vacío o falla, caemos a los placeholders estáticos para no
  // dejar hueco visual mientras se poblan las secciones destacadas.
  useEffect(() => {
    if (onFetchLandingListings) {
      onFetchLandingListings();
    }
    if (onFetchLandingStores) {
      onFetchLandingStores();
    }
  }, [onFetchLandingListings, onFetchLandingStores]);

  // XOLOLO: evitar el flash de placeholders mientras el fetch está en
  // curso. Mientras `featuredLoading=true`, pasamos [] a FeaturedListings
  // (el componente se auto-oculta con items vacíos). Al terminar el
  // fetch: data real si vino, placeholder solo como último recurso.
  const productsToShow = featuredProducts?.length
    ? featuredProducts
    : featuredLoading
      ? []
      : featuredProductsPlaceholder;
  const servicesToShow = featuredServices?.length
    ? featuredServices
    : featuredLoading
      ? []
      : featuredServicesPlaceholder;
  // XOLOLO: segunda mano NO cae a placeholders — si no hay inventario real
  // de usados aún, la sección completa se omite para no mostrar bikes nuevas
  // bajo un rótulo de "segunda mano".
  const usedToShow = featuredUsed?.length ? featuredUsed : null;
  const storesToShow = featuredStores?.length ? featuredStores : featuredStoresPlaceholder;

  // XOLOLO Task #17: títulos fijos. El reordenamiento por ubicación
  // ocurre en silencio dentro de los selectores — el buyer ve primero
  // lo cercano sin que el UI anuncie nada.
  const productsTitle = 'Productos destacados';
  const servicesTitle = 'Servicios populares';
  const usedTitle = 'Segunda mano destacada';

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
          {/* XOLOLO: patrón intercalado banner → listing
              1. Xololéalo       → 2. Productos
              3. Verified        → 4. Servicios
              5. Vende tus usados → 6. Segunda mano
              7. PromoCards      → 8. Tiendas destacadas
              9. AppBand         → 10. Footer (lo pone PageBuilder) */}
          <XololearBand />
          <FeaturedListings
            title={productsTitle}
            seeAllLabel="Ver todos los productos"
            seeAllHref="/s?pub_listingType=product"
            items={productsToShow}
          />
          <VerifiedBand />
          <FeaturedListings
            title={servicesTitle}
            seeAllLabel="Ver todos los servicios"
            seeAllHref="/s?pub_listingType=service,service-day"
            items={servicesToShow}
          />
          <UsedGoodsBand />
          {usedToShow ? (
            <FeaturedListings
              title={usedTitle}
              seeAllLabel="Ver todo lo usado"
              seeAllHref="/s?pub_condition=used"
              items={usedToShow}
            />
          ) : null}
          <PromoCards cards={promoCards} />
          <FeaturedStores stores={storesToShow} />
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
  onFetchLandingListings: func,
};

const mapStateToProps = state => {
  const { pageAssetsData, inProgress, error } = state.hostedAssets || {};
  const featuredListingData = state.featuredListings || {};

  const getListingEntitiesById = listingIds => getListingsById(state, listingIds);

  return {
    pageAssetsData,
    featuredListingData,
    getListingEntitiesById,
    inProgress,
    error,
    featuredStores: selectLandingStores(state),
    featuredLoading: selectLandingListingsLoading(state),
    storefrontSlug: selectStorefrontSlug(state),
  };
};

const mapDispatchToProps = dispatch => ({
  onFetchFeaturedListings: (sectionId, parentPage, listingImageConfig, allSections) =>
    dispatch(fetchFeaturedListings({ sectionId, parentPage, listingImageConfig, allSections })),
  onFetchLandingListings: () => dispatch(fetchLandingListings()),
  onFetchLandingStores: () => dispatch(fetchLandingStores()),
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
