import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import classNames from 'classnames';

// Import configs and util modules
import { FormattedMessage } from '../../../../util/reactIntl';
import { LISTING_STATE_DRAFT, propTypes } from '../../../../util/types';
import { types as sdkTypes } from '../../../../util/sdkLoader';
import { isPriceVariationsEnabled } from '../../../../util/configHelpers';
import { isValidCurrencyForTransactionProcess } from '../../../../util/fieldHelpers';
import { FIXED, isBookingProcess } from '../../../../transactions/transaction';
import { getTaxProfile } from '../../../../util/xololoTaxProfile';
import { SELLER_MODES, getSellerMode } from '../../../../util/xololoSellerMode';

// Import shared components
import { H3, ListingLink } from '../../../../components';

// Import modules from this directory
import EditListingPricingForm from './EditListingPricingForm';
import {
  getInitialValuesForPriceVariants,
  handleSubmitValuesForPriceVariants,
} from './BookingPriceVariants';
import {
  getInitialValuesForStartTimeInterval,
  handleSubmitValuesForStartTimeInterval,
} from './StartTimeInverval';
import css from './EditListingPricingPanel.module.css';

const { Money } = sdkTypes;

const getListingTypeConfig = (publicData, listingTypes) => {
  const selectedListingType = publicData.listingType;
  return listingTypes.find(conf => conf.listingType === selectedListingType);
};

// NOTE: components that handle price variants and start time interval are currently
// exporting helper functions that handle the initial values and the submission values.
// This is a tentative approach to contain logic in one place.
const getInitialValues = props => {
  const { listing, listingTypes, defaultCondition = 'new' } = props;
  const { publicData } = listing?.attributes || {};
  const { unitType, taxClassification, condition, usedCondition } = publicData || {};
  const listingTypeConfig = getListingTypeConfig(publicData, listingTypes);
  // Note: publicData contains priceVariationsEnabled if listing is created with priceVariations enabled.
  const isPriceVariationsInUse = isPriceVariationsEnabled(publicData, listingTypeConfig);

  // XOLOLO: hidratar los campos del form desde publicData.taxClassification.
  // El form opera con dos campos simples (checkbox + code); el objeto completo
  // con reviewStatus/declaredAt se arma en el submit.
  const taxClassificationInitial = taxClassification?.code
    ? {
        hasTaxSpecialClassification: true,
        taxClassificationCode: taxClassification.code,
        // XOLOLO: si ya aceptó el manifiesto en el pasado, lo trae
        // marcado para no obligarlo a re-aceptar en cada edición.
        taxClassificationAccepted: !!taxClassification.declarationAccepted,
      }
    : {};

  // XOLOLO: condición del artículo. Si el listing ya tenía valor, lo
  // respetamos. Si es nuevo, usamos defaultCondition del caller (los
  // sellers casual lo reciben con 'used' pre-seleccionado).
  const conditionInitial = {
    condition: condition === 'used' ? 'used' : condition === 'new' ? 'new' : defaultCondition,
  };

  // XOLOLO: nivel de estado del artículo usado.
  const usedConditionInitial = usedCondition ? { usedCondition } : {};

  return unitType === FIXED || isPriceVariationsInUse
    ? {
        ...getInitialValuesForPriceVariants(props, isPriceVariationsInUse),
        ...getInitialValuesForStartTimeInterval(props),
        ...taxClassificationInitial,
        ...conditionInitial,
        ...usedConditionInitial,
      }
    : {
        price: listing?.attributes?.price,
        ...taxClassificationInitial,
        ...conditionInitial,
        ...usedConditionInitial,
      };
};

// XOLOLO: construye el payload persistido en publicData.taxClassification
// a partir de los valores del form. Reglas:
//   - Si no marcó la casilla, no eligió código, o NO aceptó el manifiesto
//     bajo protesta → limpia la clasificación con null (preserva nada).
//   - Si marcó + eligió + aceptó, y es nuevo listing o cambio de código →
//     nueva declaración con reviewStatus='pending' + declarationAccepted.
//   - Mismo código que el persistido → preserva reviewStatus/reviewedBy/at.
// El gate antifraude (#39) revisa 'pending' en /ops antes de aplicar override.
const TAX_DECLARATION_TERMS_VERSION = 'v1-2026-10';

const buildTaxClassificationUpdate = (values, listing) => {
  const existing = listing?.attributes?.publicData?.taxClassification || null;
  const hasSpecial = !!values?.hasTaxSpecialClassification;
  const code = values?.taxClassificationCode;
  const accepted = !!values?.taxClassificationAccepted;

  // Sin checkbox, sin código, o SIN manifiesto aceptado → no se persiste.
  // Esto obliga al seller a aceptar explícitamente el manifiesto para que
  // la clasificación tenga efecto legal en Xololo.
  if (!hasSpecial || !code || !accepted) {
    return existing ? { taxClassification: null } : {};
  }

  if (existing && existing.code === code) {
    return { taxClassification: existing };
  }

  return {
    taxClassification: {
      code,
      declaredAt: new Date().toISOString(),
      declarationAccepted: true,
      declarationTermsVersion: TAX_DECLARATION_TERMS_VERSION,
      reviewStatus: 'pending',
      reviewedBy: null,
      reviewedAt: null,
    },
  };
};

// This is needed to show the listing's price consistently over XHR calls.
// I.e. we don't change the API entity saved to Redux store.
// Instead, we use a temporary entity inside the form's state.
const getOptimisticListing = (listing, updateValues) => {
  const tmpListing = {
    ...listing,
    attributes: {
      ...listing.attributes,
      ...updateValues,
      publicData: {
        ...listing.attributes?.publicData,
        ...updateValues?.publicData,
      },
    },
  };
  return tmpListing;
};

/**
 * The EditListingPricingPanel component.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.className] - Custom class that extends the default class for the root element
 * @param {string} [props.rootClassName] - Custom class that overrides the default class for the root element
 * @param {propTypes.ownListing} props.listing - The listing object
 * @param {string} props.marketplaceCurrency - The marketplace currency
 * @param {number} props.listingMinimumPriceSubUnits - The listing minimum price sub units
 * @param {boolean} props.disabled - Whether the form is disabled
 * @param {boolean} props.ready - Whether the form is ready
 * @param {Function} props.onSubmit - The submit function
 * @param {string} props.submitButtonText - The submit button text
 * @param {Array<propTypes.listingType>} props.listingTypes - The listing types
 * @param {boolean} props.panelUpdated - Whether the panel is updated
 * @param {boolean} props.updateInProgress - Whether the panel is updating
 * @param {Object} props.errors - The errors
 * @returns {JSX.Element}
 */
const EditListingPricingPanel = props => {
  // XOLOLO: perfil fiscal + modo del seller. Se lee aquí (en vez de en
  // getInitialValues) para que useSelector respete reglas de hooks.
  const currentUser = useSelector(state => state.user?.currentUser);
  const sellerTaxProfile = getTaxProfile(currentUser);
  const defaultCondition =
    getSellerMode(currentUser) === SELLER_MODES.CASUAL_RESELLER ? 'used' : 'new';
  const [state, setState] = useState({
    initialValues: getInitialValues({ ...props, defaultCondition }),
  });

  const {
    className,
    rootClassName,
    listing,
    marketplaceCurrency,
    listingMinimumPriceSubUnits,
    disabled,
    ready,
    onSubmit,
    submitButtonText,
    listingTypes,
    panelUpdated,
    updateInProgress,
    errors,
    updatePageTitle: UpdatePageTitle,
    intl,
  } = props;

  const classes = classNames(rootClassName || css.root, className);
  const initialValues = state.initialValues;
  const isPublished = listing?.id && listing?.attributes?.state !== LISTING_STATE_DRAFT;

  // currentUser/sellerTaxProfile ya se leyeron arriba (antes de useState)
  // para computar defaultCondition. personType + hasRfc modulan la
  // retención ISR 113-A y la retención por falta de RFC. La comisión
  // Xololo depende del precio del listing (COMMISSION_TIERS), no del seller.

  const publicData = listing?.attributes?.publicData;
  const listingTypeConfig = getListingTypeConfig(publicData, listingTypes);
  const transactionProcessAlias = listingTypeConfig?.transactionType?.alias;
  const process = listingTypeConfig?.transactionType?.process;
  const isBooking = isBookingProcess(process);

  // Note: publicData contains priceVariationsEnabled if listing is created with priceVariations enabled.
  const isPriceVariationsInUse = isPriceVariationsEnabled(publicData, listingTypeConfig);

  const isCompatibleCurrency = isValidCurrencyForTransactionProcess(
    transactionProcessAlias,
    marketplaceCurrency
  );

  const priceCurrencyValid = !isCompatibleCurrency
    ? false
    : marketplaceCurrency && initialValues.price instanceof Money
    ? initialValues.price.currency === marketplaceCurrency
    : !!marketplaceCurrency;
  const unitType = listing?.attributes?.publicData?.unitType;

  const panelHeadingProps = isPublished
    ? {
        id: 'EditListingPricingPanel.title',
        values: { listingTitle: <ListingLink listing={listing} />, lineBreak: <br /> },
        messageProps: { listingTitle: listing.attributes.title },
      }
    : {
        id: 'EditListingPricingPanel.createListingTitle',
        values: { lineBreak: <br /> },
        messageProps: {},
      };

  return (
    <main className={classes}>
      <UpdatePageTitle
        panelHeading={intl.formatMessage(
          { id: panelHeadingProps.id },
          { ...panelHeadingProps.messageProps }
        )}
      />
      <H3 as="h1">
        <FormattedMessage id={panelHeadingProps.id} values={{ ...panelHeadingProps.values }} />
      </H3>
      {priceCurrencyValid ? (
        <EditListingPricingForm
          className={css.form}
          initialValues={initialValues}
          categoryId={listing?.attributes?.publicData?.categoryLevel1}
          sellerTaxProfile={sellerTaxProfile}
          sellerMode={getSellerMode(currentUser)}
          onSubmit={values => {
            const { price } = values;

            // New values for listing attributes
            let updateValues = {};

            if (unitType === FIXED || isPriceVariationsInUse) {
              let publicDataUpdates = { priceVariationsEnabled: isPriceVariationsInUse };
              // NOTE: components that handle price variants and start time interval are currently
              // exporting helper functions that handle the initial values and the submission values.
              // This is a tentative approach to contain logic in one place.
              // We might remove or improve this setup in the future.

              // This adds startTimeInterval to publicData
              const startTimeIntervalChanges = handleSubmitValuesForStartTimeInterval(
                values,
                publicDataUpdates
              );
              // This adds lowest price variant to the listing.attributes.price and priceVariants to listing.attributes.publicData
              const priceVariantChanges = handleSubmitValuesForPriceVariants(
                values,
                publicDataUpdates,
                unitType,
                listingTypeConfig
              );
              updateValues = {
                ...priceVariantChanges,
                ...startTimeIntervalChanges,
                publicData: {
                  priceVariationsEnabled: isPriceVariationsInUse,
                  ...startTimeIntervalChanges.publicData,
                  ...priceVariantChanges.publicData,
                },
              };
            } else {
              const priceVariationsEnabledMaybe = isBooking
                ? {
                    publicData: {
                      priceVariationsEnabled: false,
                    },
                  }
                : {};
              updateValues = { price, ...priceVariationsEnabledMaybe };
            }

            // XOLOLO: fold tax classification into publicData sin romper
            // los otros campos de publicData que vienen de los helpers.
            const taxUpdate = buildTaxClassificationUpdate(values, listing);
            if (taxUpdate.taxClassification !== undefined) {
              updateValues = {
                ...updateValues,
                publicData: {
                  ...(updateValues.publicData || {}),
                  taxClassification: taxUpdate.taxClassification,
                },
              };
            }

            // XOLOLO: condición del artículo. SÓLO tiene sentido para
            // productos (bienes); los servicios (booking) nunca llevan
            // condition. Si llegara a existir un valor viejo persistido en
            // un servicio (migración desde versión anterior del form), lo
            // limpiamos con null al re-guardar para que no termine en la
            // sección "Segunda mano destacada" del landing.
            // XOLOLO: para casual, siempre 'used' (único modo permitido),
            // sin depender de que values.condition esté hidratado en el form.
            const isCasualSubmit =
              getSellerMode(currentUser) === SELLER_MODES.CASUAL_RESELLER;
            const conditionValue = isBooking
              ? null
              : isCasualSubmit
                ? 'used'
                : values?.condition === 'used'
                  ? 'used'
                  : 'new';
            const usedConditionValue =
              !isBooking && conditionValue === 'used' && values?.usedCondition
                ? values.usedCondition
                : null;
            updateValues = {
              ...updateValues,
              publicData: {
                ...(updateValues.publicData || {}),
                condition: conditionValue,
                usedCondition: usedConditionValue,
              },
            };

            // Save the initialValues to state
            // Otherwise, re-rendering would overwrite the values during XHR call.
            setState({
              initialValues: getInitialValues({
                listing: getOptimisticListing(listing, updateValues),
                listingTypes,
              }),
            });
            onSubmit(updateValues);
          }}
          marketplaceCurrency={marketplaceCurrency}
          unitType={unitType}
          listingTypeConfig={listingTypeConfig}
          isPriceVariationsInUse={isPriceVariationsInUse}
          listingMinimumPriceSubUnits={listingMinimumPriceSubUnits}
          saveActionMsg={submitButtonText}
          disabled={disabled}
          ready={ready}
          updated={panelUpdated}
          updateInProgress={updateInProgress}
          fetchErrors={errors}
        />
      ) : (
        <div className={css.priceCurrencyInvalid}>
          <FormattedMessage
            id="EditListingPricingPanel.listingPriceCurrencyInvalid"
            values={{ marketplaceCurrency }}
          />
        </div>
      )}
    </main>
  );
};

export default EditListingPricingPanel;
