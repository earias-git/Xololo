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

// XOLOLO: helpers de dirección estructurada. Cada dirección se guarda
// como objeto con 5 campos + los checkboxes viven al lado (bool) para
// que el form recuerde la elección "same as legal" del seller. Ver
// docs/LOGISTICS_V1.md §1.
const cleanAddress = raw => {
  const trim = v => (typeof v === 'string' ? v.trim() : '');
  const street = trim(raw?.street);
  const colonia = trim(raw?.colonia);
  const postalCode = String(raw?.postalCode || '').replace(/[^\d]/g, '').slice(0, 5);
  const city = trim(raw?.city);
  const state = trim(raw?.state);
  // Si TODOS los campos están vacíos, devolvemos null (no persistimos).
  if (!street && !colonia && !postalCode && !city && !state) return null;
  return { street, colonia, postalCode, city, state };
};

const cleanValues = raw => {
  const trim = v => (typeof v === 'string' ? v.trim() : v);

  const legalAddress = cleanAddress(raw.legalAddress);
  const commercialSameAsLegal = !!raw.commercialSameAsLegal;
  const pickupSameAsLegal = !!raw.pickupSameAsLegal;
  const commercialAddress = commercialSameAsLegal
    ? legalAddress
    : cleanAddress(raw.commercialAddress);
  const pickupAddress = pickupSameAsLegal
    ? legalAddress
    : cleanAddress(raw.pickupAddress);
  // El CP de origen (para cotizar Skydropx) se hereda del pickupAddress.
  const originPostalCode = pickupAddress?.postalCode || legalAddress?.postalCode || null;

  const out = {
    slug: trim(raw.slug) || null,
    shortDescription: trim(raw.shortDescription) || null,
    longDescription: trim(raw.longDescription) || null,
    brandPrimaryColor: trim(raw.brandPrimaryColor) || null,
    brandSecondaryColor: trim(raw.brandSecondaryColor) || null,
    logoUrl: trim(raw.logoUrl) || null,
    bannerUrl: trim(raw.bannerUrl) || null,
    bannerUrl2: trim(raw.bannerUrl2) || null,
    bannerUrl3: trim(raw.bannerUrl3) || null,
    whatsapp: raw.whatsapp ? String(raw.whatsapp).replace(/[^\d]/g, '') : null,
    instagram: trim(raw.instagram)?.replace(/^@/, '') || null,
    facebook: trim(raw.facebook) || null,
    legalName: trim(raw.legalName) || null,
    // XOLOLO: 3 direcciones estructuradas (v1 política de logística).
    legalAddress,
    commercialAddress,
    pickupAddress,
    commercialSameAsLegal,
    pickupSameAsLegal,
    pickupReferences: trim(raw.pickupReferences) || null,
    // El campo original 'address' (string libre) queda deprecado.
    // Nulificamos para migrar cuentas viejas al nuevo schema.
    address: null,
    originPostalCode,
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

  // XOLOLO: hidratamos las 3 direcciones. Si la cuenta viene del schema
  // viejo (solo `address` como string) mostramos el string en el campo
  // "street" del legal para que el seller lo revise y complete los otros
  // campos al re-guardar. Es una migración lazy (per-user, no batch).
  const emptyAddr = { street: '', colonia: '', postalCode: '', city: '', state: '' };
  const legacyAddressAsStreet =
    publicData.address && typeof publicData.address === 'string' && !publicData.legalAddress
      ? { ...emptyAddr, street: publicData.address }
      : null;

  const initialValues = {
    slug: publicData.slug || '',
    shortDescription: publicData.shortDescription || '',
    longDescription: publicData.longDescription || '',
    brandPrimaryColor: publicData.brandPrimaryColor || '',
    brandSecondaryColor: publicData.brandSecondaryColor || '',
    logoUrl: publicData.logoUrl || '',
    bannerUrl: publicData.bannerUrl || '',
    bannerUrl2: publicData.bannerUrl2 || '',
    bannerUrl3: publicData.bannerUrl3 || '',
    whatsapp: publicData.whatsapp || '',
    instagram: publicData.instagram || '',
    facebook: publicData.facebook || '',
    legalName: publicData.legalName || '',
    // 3 direcciones estructuradas + checkboxes de auto-rellenar.
    legalAddress: publicData.legalAddress || legacyAddressAsStreet || { ...emptyAddr },
    commercialAddress: publicData.commercialAddress || { ...emptyAddr },
    pickupAddress: publicData.pickupAddress || { ...emptyAddr },
    // Los flags "same as legal": true por default en cuentas nuevas
    // (menor fricción). Cuentas existentes conservan lo guardado.
    commercialSameAsLegal:
      typeof publicData.commercialSameAsLegal === 'boolean'
        ? publicData.commercialSameAsLegal
        : !publicData.commercialAddress,
    pickupSameAsLegal:
      typeof publicData.pickupSameAsLegal === 'boolean'
        ? publicData.pickupSameAsLegal
        : !publicData.pickupAddress,
    pickupReferences: publicData.pickupReferences || '',
    // originPostalCode ya no se captura directo — se hereda del pickupAddress.
    originPostalCode: publicData.originPostalCode || '',
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
