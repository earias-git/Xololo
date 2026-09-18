import React from 'react';
import { compose } from 'redux';
import { connect } from 'react-redux';

import { useConfiguration } from '../../context/configurationContext';
import { useIntl } from '../../util/reactIntl';
import { propTypes } from '../../util/types';
import { ensureCurrentUser } from '../../util/data';
import {
  showCreateListingLinkForUser,
  showPaymentDetailsForUser,
} from '../../util/userHelpers';

import { isScrollingDisabled } from '../../ducks/ui.duck';

import { H3, Page, UserNav, LayoutSideNavigation } from '../../components';

import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import ManageStoreForm from './ManageStoreForm/ManageStoreForm';

import { saveStore, saveStoreClear } from './ManageStorePage.duck';
import css from './ManageStorePage.module.css';

// XOLOLO: página /account/store donde el seller edita su storefront.
// Muestra el formulario con todos los campos custom que van a publicData.
// Cuando se guardan, la actualización propaga al slice `user` (via
// setCurrentUser dentro del thunk), así que la próxima carga del
// storefront ya trae los datos nuevos. También se invalidan las cachés
// de los endpoints (5 min TTL en el server) por lo que puede tardar un
// poco en verse el cambio en el listado de tiendas destacadas del home.

const CATEGORY_OPTIONS = new Set([
  'artesanias', 'hogar', 'moda', 'belleza', 'alimentos',
  'tecnologia', 'mascotas', 'papeleria', 'turismo', 'servicios-pro',
]);

const cleanValues = raw => {
  const trim = v => (typeof v === 'string' ? v.trim() : v);
  const out = {
    slug: trim(raw.slug) || null,
    shortDescription: trim(raw.shortDescription) || null,
    longDescription: trim(raw.longDescription) || null,
    brandPrimaryColor: trim(raw.brandPrimaryColor) || null,
    brandSecondaryColor: trim(raw.brandSecondaryColor) || null,
    logoUrl: trim(raw.logoUrl) || null,
    bannerUrl: trim(raw.bannerUrl) || null,
    whatsapp: raw.whatsapp ? String(raw.whatsapp).replace(/[^\d]/g, '') : null,
    instagram: trim(raw.instagram)?.replace(/^@/, '') || null,
    facebook: trim(raw.facebook) || null,
    legalName: trim(raw.legalName) || null,
    address: trim(raw.address) || null,
    primaryCategory: CATEGORY_OPTIONS.has(raw.primaryCategory) ? raw.primaryCategory : null,
    showCalendar: raw.showCalendar === 'yes' ? 'yes' : 'no',
  };
  return out;
};

export const ManageStorePageComponent = props => {
  const config = useConfiguration();
  const intl = useIntl();
  const {
    currentUser,
    scrollingDisabled,
    saveStoreInProgress,
    saveStoreError,
    storeSaved,
    onSaveStore,
    onChange,
  } = props;

  const user = ensureCurrentUser(currentUser);
  const publicData = user.attributes?.profile?.publicData || {};

  const initialValues = {
    slug: publicData.slug || '',
    shortDescription: publicData.shortDescription || '',
    longDescription: publicData.longDescription || '',
    brandPrimaryColor: publicData.brandPrimaryColor || '',
    brandSecondaryColor: publicData.brandSecondaryColor || '',
    logoUrl: publicData.logoUrl || '',
    bannerUrl: publicData.bannerUrl || '',
    whatsapp: publicData.whatsapp || '',
    instagram: publicData.instagram || '',
    facebook: publicData.facebook || '',
    legalName: publicData.legalName || '',
    address: publicData.address || '',
    primaryCategory: publicData.primaryCategory || '',
    showCalendar: publicData.showCalendar === 'yes' ? 'yes' : 'no',
  };

  const handleSubmit = values => {
    return onSaveStore(cleanValues(values));
  };

  const showManageListingsLink = showCreateListingLinkForUser(config, currentUser);
  const { showPayoutDetails, showPaymentMethods } = showPaymentDetailsForUser(config, currentUser);
  const accountSettingsNavProps = {
    currentPage: 'ManageStorePage',
    showPaymentMethods,
    showPayoutDetails,
  };

  const storefrontHost = publicData.slug
    ? typeof window !== 'undefined' && /localhost/.test(window.location.hostname)
      ? `http://${publicData.slug}.localhost:3000`
      : `https://${publicData.slug}.xololo.mx`
    : null;

  return (
    <Page title="Mi tienda" scrollingDisabled={scrollingDisabled}>
      <LayoutSideNavigation
        topbar={
          <>
            <TopbarContainer
              desktopClassName={css.desktopTopbar}
              mobileClassName={css.mobileTopbar}
            />
            <UserNav
              currentPage="ManageStorePage"
              showManageListingsLink={showManageListingsLink}
            />
          </>
        }
        sideNav={null}
        useAccountSettingsNav
        accountSettingsNavProps={accountSettingsNavProps}
        footer={<FooterContainer />}
        intl={intl}
      >
        <div className={css.content}>
          <H3 as="h1">Mi tienda</H3>
          <p className={css.subheading}>
            Personaliza cómo se ve tu storefront (subdominio) en Xololo. Los
            cambios se aplican de inmediato en tu tienda pública.
          </p>
          {storefrontHost ? (
            <p className={css.livePreview}>
              Tu tienda actual:{' '}
              <a href={storefrontHost} target="_blank" rel="noopener noreferrer">
                {storefrontHost.replace(/^https?:\/\//, '')} ↗
              </a>
            </p>
          ) : null}
          {user.id ? (
            <ManageStoreForm
              className={css.form}
              initialValues={initialValues}
              onSubmit={handleSubmit}
              onChange={onChange}
              inProgress={saveStoreInProgress}
              ready={storeSaved}
              saveStoreError={saveStoreError}
            />
          ) : null}
        </div>
      </LayoutSideNavigation>
    </Page>
  );
};

const mapStateToProps = state => {
  const { currentUser } = state.user;
  const { saveStoreInProgress, saveStoreError, storeSaved } = state.ManageStorePage;
  return {
    currentUser,
    scrollingDisabled: isScrollingDisabled(state),
    saveStoreInProgress,
    saveStoreError,
    storeSaved,
  };
};

const mapDispatchToProps = dispatch => ({
  onSaveStore: publicData => dispatch(saveStore(publicData)),
  onChange: () => dispatch(saveStoreClear()),
});

const ManageStorePage = compose(
  connect(
    mapStateToProps,
    mapDispatchToProps
  )
)(ManageStorePageComponent);

export default ManageStorePage;
