import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import classNames from 'classnames';

// Import configs and util modules
import { FormattedMessage } from '../../../../util/reactIntl';
import { LISTING_STATE_DRAFT, STOCK_INFINITE_ITEMS, propTypes } from '../../../../util/types';
import { types as sdkTypes } from '../../../../util/sdkLoader';
import { isValidCurrencyForTransactionProcess } from '../../../../util/fieldHelpers';
import { getTaxProfile } from '../../../../util/xololoTaxProfile';
import { SELLER_MODES, getSellerMode } from '../../../../util/xololoSellerMode';
import { apiBaseUrl } from '../../../../util/api';
// Note: SELLER_MODES used by the Form for isCasual check downstream.

// Import shared components
import { H3, ListingLink } from '../../../../components';

// Import modules from this directory
import EditListingPricingAndStockForm from './EditListingPricingAndStockForm';
import css from './EditListingPricingAndStockPanel.module.css';

const { Money } = sdkTypes;
const BILLIARD = 1000000000000000;

const getListingTypeConfig = (publicData, listingTypes) => {
  const selectedListingType = publicData.listingType;
  return listingTypes.find(conf => conf.listingType === selectedListingType);
};

const getInitialValues = props => {
  const { listing, listingTypes, defaultCondition = 'new' } = props;
  const isPublished = listing?.id && listing?.attributes?.state !== LISTING_STATE_DRAFT;
  const price = listing?.attributes?.price;
  const currentStock = listing?.currentStock;

  const publicData = listing?.attributes?.publicData;
  const listingTypeConfig = getListingTypeConfig(publicData, listingTypes);
  const hasInfiniteStock = STOCK_INFINITE_ITEMS.includes(listingTypeConfig?.stockType);

  // The listing resource has a relationship: `currentStock`,
  // which you should include when making API calls.
  // Note: infinite stock is refilled to billiard using "stockUpdateMaybe"
  const currentStockQuantity = currentStock?.attributes?.quantity;
  const stock =
    currentStockQuantity != null
      ? currentStockQuantity
      : isPublished
      ? 0
      : hasInfiniteStock
      ? BILLIARD
      : 1;
  const stockTypeInfinity = [];

  // XOLOLO: hidratar los campos del form desde publicData.taxClassification
  // (gate antifraude #39). El form opera con dos campos simples; el objeto
  // completo con reviewStatus/declaredAt se arma al submit.
  const taxClassification = publicData?.taxClassification;
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
    condition:
      publicData?.condition === 'used'
        ? 'used'
        : publicData?.condition === 'new'
          ? 'new'
          : defaultCondition,
  };

  // XOLOLO: nivel de estado del artículo usado.
  const usedConditionInitial = publicData?.usedCondition
    ? { usedCondition: publicData.usedCondition }
    : {};

  return {
    price,
    stock,
    stockTypeInfinity,
    ...taxClassificationInitial,
    ...conditionInitial,
    ...usedConditionInitial,
  };
};

// XOLOLO: construye el payload persistido en publicData.taxClassification
// a partir de los valores del form. Reglas (idéntico al PricingPanel):
//   - Sin checkbox, sin código, o SIN manifiesto aceptado → null.
//   - Con todo marcado y nuevo código → persiste con declarationAccepted +
//     declarationTermsVersion + reviewStatus='pending'.
//   - Mismo código que el persistido → preserva reviewStatus/reviewedBy/at.
const TAX_DECLARATION_TERMS_VERSION = 'v1-2026-10';

const buildTaxClassificationUpdate = (values, listing) => {
  const existing = listing?.attributes?.publicData?.taxClassification || null;
  const hasSpecial = !!values?.hasTaxSpecialClassification;
  const code = values?.taxClassificationCode;
  const accepted = !!values?.taxClassificationAccepted;

  if (!hasSpecial || !code || !accepted) {
    return existing ? { taxClassification: null } : null;
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

/**
 * The EditListingPricingAndStockPanel component.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.className] - Custom class that extends the default class for the root element
 * @param {string} [props.rootClassName] - Custom class that overrides the default class for the root element
 * @param {propTypes.ownListing} props.listing - The listing object
 * @param {string} props.marketplaceCurrency - The marketplace currency (e.g. 'USD')
 * @param {number} props.listingMinimumPriceSubUnits - The listing minimum price sub units
 * @param {Array<propTypes.listingType>} props.listingTypes - The listing types
 * @param {boolean} props.disabled - Whether the form is disabled
 * @param {boolean} props.ready - Whether the form is ready
 * @param {Function} props.onSubmit - The submit function
 * @param {string} props.submitButtonText - The submit button text
 * @param {boolean} props.panelUpdated - Whether the panel is updated
 * @param {boolean} props.updateInProgress - Whether the update is in progress
 * @param {Object} props.errors - The errors object
 * @returns {JSX.Element}
 */
const EditListingPricingAndStockPanel = props => {
  // XOLOLO: perfil fiscal + modo del seller. Default 'used' para casual.
  const currentUser = useSelector(state => state.user?.currentUser);
  const sellerTaxProfile = getTaxProfile(currentUser);
  const defaultCondition =
    getSellerMode(currentUser) === SELLER_MODES.CASUAL_RESELLER ? 'used' : 'new';
  // State is needed since re-rendering would overwrite the values during XHR call.
  const [state, setState] = useState({
    initialValues: getInitialValues({ ...props, defaultCondition }),
  });

  const {
    className,
    rootClassName,
    listing,
    marketplaceCurrency,
    listingMinimumPriceSubUnits,
    listingTypes,
    disabled,
    ready,
    onSubmit,
    submitButtonText,
    panelUpdated,
    updateInProgress,
    errors,
    updatePageTitle: UpdatePageTitle,
    intl,
  } = props;

  const classes = classNames(rootClassName || css.root, className);
  const initialValues = state.initialValues;

  // currentUser y sellerTaxProfile ya se leyeron arriba.

  // Form needs to know data from listingType
  const publicData = listing?.attributes?.publicData;
  const unitType = publicData.unitType;
  const listingTypeConfig = getListingTypeConfig(publicData, listingTypes);
  const transactionProcessAlias = listingTypeConfig.transactionType.alias;

  const hasInfiniteStock = STOCK_INFINITE_ITEMS.includes(listingTypeConfig?.stockType);

  const isPublished = listing?.id && listing?.attributes?.state !== LISTING_STATE_DRAFT;

  // Don't render the form if the assigned currency is different from the marketplace currency
  // or if transaction process is incompatible with selected currency
  const isStripeCompatibleCurrency = isValidCurrencyForTransactionProcess(
    transactionProcessAlias,
    marketplaceCurrency,
    'stripe'
  );
  const priceCurrencyValid = !isStripeCompatibleCurrency
    ? false
    : marketplaceCurrency && initialValues.price instanceof Money
    ? initialValues.price?.currency === marketplaceCurrency
    : !!marketplaceCurrency;

  const panelHeadingProps = isPublished
    ? {
        id: 'EditListingPricingAndStockPanel.title',
        values: { listingTitle: <ListingLink listing={listing} />, lineBreak: <br /> },
        messageProps: { listingTitle: listing.attributes.title },
      }
    : {
        id: 'EditListingPricingAndStockPanel.createListingTitle',
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
        <EditListingPricingAndStockForm
          className={css.form}
          initialValues={initialValues}
          categoryId={listing?.attributes?.publicData?.categoryLevel1}
          sellerTaxProfile={sellerTaxProfile}
          sellerMode={getSellerMode(currentUser)}
          isEvent={publicData?.isEvent === true}
          eventCapacity={publicData?.event?.capacity || null}
          onSubmit={values => {
            const { price, stockTypeInfinity } = values;

            // XOLOLO: para eventos usamos event.capacity como stock automático
            // (declarado en Características). El seller no lo re-captura en
            // este panel — evita divergencia entre cupo del evento y stock
            // del listing.
            const isEventListing = publicData?.isEvent === true;
            const stock = isEventListing
              ? Number(publicData?.event?.capacity) || Number(values.stock) || 0
              : values.stock;

            // Update stock only if the value has changed, or stock is infinity in stockType,
            // but not current stock is a small number (might happen with old listings)
            // NOTE: this is going to be used on a separate call to API
            // in EditListingPage.duck.js: sdk.stock.compareAndSet();

            const hasStockTypeInfinityChecked = stockTypeInfinity?.[0] === 'infinity';
            const hasNoCurrentStock = listing?.currentStock?.attributes?.quantity == null;
            const hasStockQuantityChanged = stock && stock !== initialValues.stock;
            // currentStockQuantity is null or undefined, return null - otherwise use the value
            const oldTotal = hasNoCurrentStock ? null : initialValues.stock;
            const stockUpdateMaybe =
              hasInfiniteStock && (hasNoCurrentStock || hasStockTypeInfinityChecked)
                ? {
                    stockUpdate: {
                      oldTotal,
                      newTotal: BILLIARD,
                    },
                  }
                : hasNoCurrentStock || hasStockQuantityChanged
                ? {
                    stockUpdate: {
                      oldTotal,
                      newTotal: stock,
                    },
                  }
                : {};

            // XOLOLO: añade publicData.taxClassification al update.
            // Para casual, condition siempre es 'used' (único modo que puede
            // publicar). Esto hidrata correctamente listings viejos que
            // quedaron sin publicData.condition persistido.
            const isCasualSubmit =
              getSellerMode(currentUser) === SELLER_MODES.CASUAL_RESELLER;
            const taxUpdate = buildTaxClassificationUpdate(
              isCasualSubmit ? { ...values, condition: 'used' } : values,
              listing
            );
            const conditionValue = isCasualSubmit
              ? 'used'
              : values?.condition === 'used'
                ? 'used'
                : 'new';
            // XOLOLO: nivel de estado — null si el seller no eligió aún
            // (o si volvió a 'new'); el buyer sólo lo verá cuando venga
            // definido y la condition sea 'used'.
            const usedConditionValue =
              conditionValue === 'used' && values?.usedCondition
                ? values.usedCondition
                : null;
            const publicDataPayload = {
              ...(taxUpdate ? { taxClassification: taxUpdate.taxClassification } : {}),
              condition: conditionValue,
              usedCondition: usedConditionValue,
            };

            // New values for listing attributes
            const updateValues = {
              price,
              ...stockUpdateMaybe,
              publicData: publicDataPayload,
            };
            // Save the initialValues to state
            // Otherwise, re-rendering would overwrite the values during XHR call.
            setState({
              initialValues: {
                price,
                stock: stockUpdateMaybe?.stockUpdate?.newTotal || stock,
                stockTypeInfinity,
              },
            });
            const submitResult = onSubmit(updateValues);
            // XOLOLO #39: si el seller declaró clasificación especial,
            // disparamos el análisis de IA en background apenas el
            // update propague en Sharetribe. Precarga el aiReview para
            // que Ops lo vea sin esperar al botón manual.
            // Fire-and-forget: fallos de la IA no bloquean el flujo del
            // seller — Ops siempre puede re-correrla desde /ops.
            const payloadTax = publicDataPayload.taxClassification;
            if (payloadTax?.code && listing?.id?.uuid && submitResult?.then) {
              submitResult
                .then(() => {
                  // Pequeño delay para dar tiempo a Sharetribe de
                  // persistir el update antes de que el server lea el
                  // listing.
                  setTimeout(() => {
                    fetch(`${apiBaseUrl()}/api/seller-tax-ai-classify`, {
                      method: 'POST',
                      credentials: 'include',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ listingId: listing.id.uuid }),
                    }).catch(() => {
                      // Silencioso — es background, el user no espera.
                    });
                  }, 1500);
                })
                .catch(() => {
                  /* ignore */
                });
            }
          }}
          listingMinimumPriceSubUnits={listingMinimumPriceSubUnits}
          marketplaceCurrency={marketplaceCurrency}
          listingType={listingTypeConfig}
          unitType={unitType}
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
            id="EditListingPricingAndStockPanel.listingPriceCurrencyInvalid"
            values={{ marketplaceCurrency }}
          />
        </div>
      )}
    </main>
  );
};

export default EditListingPricingAndStockPanel;
