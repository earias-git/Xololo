import React, { useState } from 'react';
import classNames from 'classnames';

// Import configs and util modules
import { FormattedMessage } from '../../../../util/reactIntl';
import {
  LISTING_STATE_DRAFT,
  STOCK_INFINITE_MULTIPLE_ITEMS,
  STOCK_MULTIPLE_ITEMS,
  propTypes,
} from '../../../../util/types';
import { types as sdkTypes } from '../../../../util/sdkLoader';
import { getShippingMethodsFromListing } from '../../../../util/xololoShippingMethods';

// Import shared components
import { H3, ListingLink } from '../../../../components';

// Import modules from this directory
import EditListingDeliveryForm from './EditListingDeliveryForm';
import css from './EditListingDeliveryPanel.module.css';

const { Money } = sdkTypes;

// XOLOLO Envíos v2: initialValues del nuevo modelo xololoMethods.
// Lee desde publicData.xololoShippingMethods si existe; si no, deriva
// desde el legacy — así los listings viejos entran al form con los
// checkboxes ya marcados según su config anterior. FieldCheckbox usa
// arrays: presencia del value = enabled.
const getInitialValues = props => {
  const { listing, marketplaceCurrency } = props;
  const currency = listing?.attributes?.price?.currency || marketplaceCurrency;
  const xoloMethodsCfg = getShippingMethodsFromListing(listing);
  const localPriceSubunits = Number(xoloMethodsCfg.localDelivery.priceSubunits) || 0;
  const sk = xoloMethodsCfg.skydropxCarrier;
  return {
    xololoMethods: {
      pickup: {
        enabled: xoloMethodsCfg.pickup.enabled ? ['true'] : [],
        instructions: xoloMethodsCfg.pickup.instructions || '',
      },
      localDelivery: {
        enabled: xoloMethodsCfg.localDelivery.enabled ? ['true'] : [],
        price: localPriceSubunits > 0 ? new Money(localPriceSubunits, currency) : null,
        zoneDescription: xoloMethodsCfg.localDelivery.zoneDescription || '',
      },
      skydropxCarrier: {
        enabled: sk.enabled ? ['true'] : [],
        sellerCoversShipping: sk.sellerCoversShipping ? ['true'] : [],
        weightGrams: sk.weightGrams != null ? String(sk.weightGrams) : '',
        dimensionLengthCm: sk.dimensionLengthCm != null ? String(sk.dimensionLengthCm) : '',
        dimensionWidthCm: sk.dimensionWidthCm != null ? String(sk.dimensionWidthCm) : '',
        dimensionHeightCm: sk.dimensionHeightCm != null ? String(sk.dimensionHeightCm) : '',
      },
      freight: {
        enabled: xoloMethodsCfg.freight.enabled ? ['true'] : [],
      },
    },
  };
};

/**
 * The EditListingDeliveryPanel component.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.className]
 * @param {string} [props.rootClassName]
 * @param {propTypes.ownListing} props.listing
 * @param {Array<Object>} props.listingTypes
 * @param {string} props.marketplaceCurrency
 * @param {boolean} props.disabled
 * @param {boolean} props.ready
 * @param {Function} props.onSubmit
 * @param {string} props.submitButtonText
 * @param {boolean} props.panelUpdated
 * @param {boolean} props.updateInProgress
 * @param {Object} props.errors
 * @returns {JSX.Element}
 */
const EditListingDeliveryPanel = props => {
  const [state, setState] = useState({ initialValues: getInitialValues(props) });

  const {
    className,
    rootClassName,
    listing,
    listingTypes,
    marketplaceCurrency,
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
  const isPublished = listing?.id && listing?.attributes.state !== LISTING_STATE_DRAFT;
  const priceCurrencyValid = listing?.attributes?.price?.currency === marketplaceCurrency;
  const listingType = listing?.attributes?.publicData?.listingType;
  const listingTypeConfig = listingTypes.find(conf => conf.listingType === listingType);
  const allowOrdersOfMultipleItems = [STOCK_MULTIPLE_ITEMS, STOCK_INFINITE_MULTIPLE_ITEMS].includes(
    listingTypeConfig?.stockType
  );

  const panelHeadingProps = isPublished
    ? {
        id: 'EditListingDeliveryPanel.title',
        values: { listingTitle: <ListingLink listing={listing} />, lineBreak: <br /> },
        messageProps: { listingTitle: listing.attributes.title },
      }
    : {
        id: 'EditListingDeliveryPanel.createListingTitle',
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
        <EditListingDeliveryForm
          className={css.form}
          initialValues={state.initialValues}
          onSubmit={values => {
            const { xololoMethods } = values;

            // XOLOLO Envíos v2: normaliza el shape del form al que
            // persistimos en publicData. FieldCheckbox guarda enabled
            // como array — presencia = true.
            const xoloIsOn = v => Array.isArray(v) && v.length > 0;
            const xololoShippingMethods = {
              pickup: {
                enabled: xoloIsOn(xololoMethods?.pickup?.enabled),
                instructions: xololoMethods?.pickup?.instructions || '',
              },
              localDelivery: {
                enabled: xoloIsOn(xololoMethods?.localDelivery?.enabled),
                priceSubunits: xololoMethods?.localDelivery?.price?.amount ?? 0,
                zoneDescription: xololoMethods?.localDelivery?.zoneDescription || '',
              },
              skydropxCarrier: {
                enabled: xoloIsOn(xololoMethods?.skydropxCarrier?.enabled),
                sellerCoversShipping: xoloIsOn(
                  xololoMethods?.skydropxCarrier?.sellerCoversShipping
                ),
                weightGrams: xololoMethods?.skydropxCarrier?.weightGrams
                  ? Number(xololoMethods.skydropxCarrier.weightGrams)
                  : null,
                dimensionLengthCm: xololoMethods?.skydropxCarrier?.dimensionLengthCm
                  ? Number(xololoMethods.skydropxCarrier.dimensionLengthCm)
                  : null,
                dimensionWidthCm: xololoMethods?.skydropxCarrier?.dimensionWidthCm
                  ? Number(xololoMethods.skydropxCarrier.dimensionWidthCm)
                  : null,
                dimensionHeightCm: xololoMethods?.skydropxCarrier?.dimensionHeightCm
                  ? Number(xololoMethods.skydropxCarrier.dimensionHeightCm)
                  : null,
              },
              freight: {
                enabled: xoloIsOn(xololoMethods?.freight?.enabled),
              },
            };

            // XOLOLO: derivamos los flags legacy (pickupEnabled/
            // shippingEnabled) desde v2 para que la UI de Sharetribe y
            // cualquier consumer viejo que los lea sigan viendo estado
            // consistente. El checkout usa `xololoShippingMethods` como
            // fuente de verdad — ver server/api-util/lineItems.js.
            const pickupEnabled = xololoShippingMethods.pickup.enabled;
            const shippingEnabled =
              xololoShippingMethods.localDelivery.enabled ||
              xololoShippingMethods.skydropxCarrier.enabled ||
              xololoShippingMethods.freight.enabled;

            const updateValues = {
              publicData: {
                pickupEnabled,
                shippingEnabled,
                xololoShippingMethods,
              },
            };

            setState({ initialValues: { xololoMethods } });
            onSubmit(updateValues);
          }}
          listingTypeConfig={listingTypeConfig}
          marketplaceCurrency={marketplaceCurrency}
          allowOrdersOfMultipleItems={allowOrdersOfMultipleItems}
          saveActionMsg={submitButtonText}
          disabled={disabled}
          ready={ready}
          updated={panelUpdated}
          updateInProgress={updateInProgress}
          fetchErrors={errors}
          autoFocus
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

export default EditListingDeliveryPanel;
