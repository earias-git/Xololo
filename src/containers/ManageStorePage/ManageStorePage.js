import React from 'react';
import { compose } from 'redux';
import { connect } from 'react-redux';

import { useConfiguration } from '../../context/configurationContext';
import { useIntl } from '../../util/reactIntl';
import { propTypes } from '../../util/types';
import { ensureCurrentUser } from '../../util/data';
import { showCreateListingLinkForUser, showPaymentDetailsForUser } from '../../util/userHelpers';

import { isScrollingDisabled } from '../../ducks/ui.duck';

import { H3, NamedRedirect, Page, UserNav, LayoutSideNavigation } from '../../components';
import { SELLER_MODES, getSellerMode } from '../../util/xololoSellerMode';

import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import ManageStoreForm from './ManageStoreForm/ManageStoreForm';
import CommunitiesPanel from './CommunitiesPanel/CommunitiesPanel';

import {
  saveStore,
  saveStoreClear,
  publishStorefrontDraft,
  discardStorefrontDraft,
} from './ManageStorePage.duck';
import {
  BRANDING_FIELDS,
  readEffectiveBranding,
  hasActiveDraft,
  buildDraftPatch,
  buildPublishPatch,
  buildDiscardPatch,
} from '../../util/xololoStorefrontDraft';
import css from './ManageStorePage.module.css';

// XOLOLO: página /account/store donde el seller edita su storefront.
// Muestra el formulario con todos los campos custom que van a publicData.
// Cuando se guardan, la actualización propaga al slice `user` (via
// setCurrentUser dentro del thunk), así que la próxima carga del
// storefront ya trae los datos nuevos. También se invalidan las cachés
// de los endpoints (5 min TTL en el server) por lo que puede tardar un
// poco en verse el cambio en el listado de tiendas destacadas del home.

const CATEGORY_OPTIONS = new Set([
  'artesanias',
  'hogar',
  'moda',
  'belleza',
  'alimentos',
  'tecnologia',
  'mascotas',
  'papeleria',
  'turismo',
  'servicios-pro',
]);

// XOLOLO: helpers de dirección estructurada. Cada dirección se guarda
// como objeto con 5 campos + los checkboxes viven al lado (bool) para
// que el form recuerde la elección "same as legal" del seller. Ver
// docs/LOGISTICS_V1.md §1.
const cleanAddress = raw => {
  const trim = v => (typeof v === 'string' ? v.trim() : '');
  const street = trim(raw?.street);
  const colonia = trim(raw?.colonia);
  const postalCode = String(raw?.postalCode || '')
    .replace(/[^\d]/g, '')
    .slice(0, 5);
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
  const pickupAddress = pickupSameAsLegal ? legalAddress : cleanAddress(raw.pickupAddress);
  // El CP de origen (para cotizar Skydropx) se hereda del pickupAddress.
  const originPostalCode = pickupAddress?.postalCode || legalAddress?.postalCode || null;

  // XOLOLO Web Studio PR 2: split branding (va a storefrontDraft) vs resto
  // (va flat como siempre). cleanValues sólo normaliza y agrupa — el
  // routing final lo hace handleSubmit con buildDraftPatch.
  const branding = {
    brandPrimaryColor: trim(raw.brandPrimaryColor) || null,
    brandSecondaryColor: trim(raw.brandSecondaryColor) || null,
    logoUrl: trim(raw.logoUrl) || null,
    bannerUrl: trim(raw.bannerUrl) || null,
    bannerUrl2: trim(raw.bannerUrl2) || null,
    bannerUrl3: trim(raw.bannerUrl3) || null,
  };

  const other = {
    slug: trim(raw.slug) || null,
    shortDescription: trim(raw.shortDescription) || null,
    longDescription: trim(raw.longDescription) || null,
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

  return { branding, other };
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

  // XOLOLO Web Studio PR 2: branding efectivo = draft si hay, flat si no.
  // El form carga el draft para que el seller resuma su edición sin
  // perder lo que había hecho antes de cerrar el tab.
  const effectiveBranding = readEffectiveBranding(user);
  const isDraftActive = hasActiveDraft(user);

  // XOLOLO: seller casual (segunda mano particular) no tiene storefront.
  // Si llega aquí por URL directa lo mandamos a su cuenta donde puede
  // cambiar el modo si quiere abrir tienda.
  if (user.id && getSellerMode(user) === SELLER_MODES.CASUAL_RESELLER) {
    return <NamedRedirect name="ManageAccountPage" />;
  }

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
    // XOLOLO Web Studio PR 2: branding desde effectiveBranding (draft > flat).
    brandPrimaryColor: effectiveBranding.brandPrimaryColor || '',
    brandSecondaryColor: effectiveBranding.brandSecondaryColor || '',
    logoUrl: effectiveBranding.logoUrl || '',
    bannerUrl: effectiveBranding.bannerUrl || '',
    bannerUrl2: effectiveBranding.bannerUrl2 || '',
    bannerUrl3: effectiveBranding.bannerUrl3 || '',
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

  // XOLOLO Web Studio PR 2: el submit default GUARDA UN BORRADOR. El
  // branding va a publicData.storefrontDraft; el resto flat. Buyers no
  // ven cambios hasta que seller haga click en "Publicar diseño".
  const handleSubmit = values => {
    const { branding, other } = cleanValues(values);
    return onSaveStore(buildDraftPatch({ branding, other }));
  };

  const handlePublishDraft = () => {
    // Tomamos el draft del user tal como está en Sharetribe (fuente de
    // verdad). No usamos valores pendientes del form — al publicar lo
    // que vale es lo último guardado como borrador.
    return props.onPublishStorefrontDraft(buildPublishPatch({ user }));
  };

  const handleDiscardDraft = () => {
    return props.onDiscardStorefrontDraft(buildDiscardPatch());
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
            Personaliza cómo se ve tu tienda en línea (subdominio) en Xololo. Los cambios se
            aplican de inmediato en tu tienda pública.
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
            <>
              {/* XOLOLO 2026-11-18 — ADR-006 PR-7: panel "Comunidades"
                  arriba del form principal. Seller ve a qué comunidades
                  pertenece y puede unirse a nuevas desde aquí. */}
              <CommunitiesPanel />
              <ManageStoreForm
                className={css.form}
                initialValues={initialValues}
                onSubmit={handleSubmit}
                onChange={onChange}
                inProgress={saveStoreInProgress}
                ready={storeSaved}
                saveStoreError={saveStoreError}
                /* XOLOLO Web Studio PR 2: props del modelo staging. */
                hasDraft={isDraftActive}
                onPublishDraft={handlePublishDraft}
                onDiscardDraft={handleDiscardDraft}
                publishDraftInProgress={props.publishDraftInProgress}
                publishDraftError={props.publishDraftError}
                draftPublished={props.draftPublished}
                discardDraftInProgress={props.discardDraftInProgress}
                discardDraftError={props.discardDraftError}
              />
            </>
          ) : null}
        </div>
      </LayoutSideNavigation>
    </Page>
  );
};

const mapStateToProps = state => {
  const { currentUser } = state.user;
  const {
    saveStoreInProgress,
    saveStoreError,
    storeSaved,
    publishDraftInProgress,
    publishDraftError,
    draftPublished,
    discardDraftInProgress,
    discardDraftError,
  } = state.ManageStorePage;
  return {
    currentUser,
    scrollingDisabled: isScrollingDisabled(state),
    saveStoreInProgress,
    saveStoreError,
    storeSaved,
    publishDraftInProgress,
    publishDraftError,
    draftPublished,
    discardDraftInProgress,
    discardDraftError,
  };
};

const mapDispatchToProps = dispatch => ({
  onSaveStore: publicData => dispatch(saveStore(publicData)),
  onPublishStorefrontDraft: publicData => dispatch(publishStorefrontDraft(publicData)),
  onDiscardStorefrontDraft: publicData => dispatch(discardStorefrontDraft(publicData)),
  onChange: () => dispatch(saveStoreClear()),
});

const ManageStorePage = compose(connect(mapStateToProps, mapDispatchToProps))(
  ManageStorePageComponent
);

export default ManageStorePage;
