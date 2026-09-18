import React, { useEffect } from 'react';
import { Form as FinalForm } from 'react-final-form';
import classNames from 'classnames';

// Import configs and util modules
import appSettings from '../../../../config/settings';
import { FormattedMessage, useIntl } from '../../../../util/reactIntl';
import { propTypes } from '../../../../util/types';
import { displayDeliveryPickup, displayDeliveryShipping } from '../../../../util/configHelpers';
import {
  autocompleteSearchRequired,
  autocompletePlaceSelected,
  composeValidators,
  required,
} from '../../../../util/validators';

// Import shared components
import {
  Form,
  FieldLocationAutocompleteInput,
  Button,
  FieldCurrencyInput,
  FieldTextInput,
  FieldCheckbox,
  FieldRadioButton,
} from '../../../../components';

// Import modules from this directory
import css from './EditListingDeliveryForm.module.css';

const identity = v => v;

/**
 * The EditListingDeliveryForm component.
 *
 * @component
 * @param {Object} props - The component props
 * @param {string} props.formId - The form ID
 * @param {string} [props.className] - Custom class that extends the default class for the root element
 * @param {Function} props.onSubmit - The submit function
 * @param {string} props.saveActionMsg - The save action message
 * @param {Object} props.selectedPlace - The selected place
 * @param {string} props.marketplaceCurrency - The marketplace currency
 * @param {boolean} props.hasStockInUse - Whether the stock is in use
 * @param {boolean} props.disabled - Whether the form is disabled
 * @param {boolean} props.ready - Whether the form is ready
 * @param {boolean} props.updated - Whether the form is updated
 * @param {boolean} props.updateInProgress - Whether the form is in progress
 * @param {Object} props.fetchErrors - The fetch errors
 * @param {propTypes.error} [props.fetchErrors.showListingsError] - The show listings error
 * @param {propTypes.error} [props.fetchErrors.updateListingError] - The update listing error
 * @param {boolean} props.autoFocus - Whether the form is auto focused
 * @returns {JSX.Element} The EditListingDeliveryForm component
 */
export const EditListingDeliveryForm = props => (
  <FinalForm
    {...props}
    render={formRenderProps => {
      const {
        formId = 'EditListingDeliveryForm',
        form,
        autoFocus,
        className,
        disabled,
        ready,
        handleSubmit,
        pristine,
        invalid,
        listingTypeConfig,
        marketplaceCurrency,
        allowOrdersOfMultipleItems = false,
        saveActionMsg,
        updated,
        updateInProgress,
        fetchErrors,
        values,
      } = formRenderProps;
      const intl = useIntl();

      // This is a bug fix for Final Form.
      // Without this, React will return a warning:
      //   "Cannot update a component (`ForwardRef(Field)`)
      //   while rendering a different component (`ForwardRef(Field)`)"
      // This seems to happen because validation calls listeneres and
      // that causes state to change inside final-form.
      // https://github.com/final-form/react-final-form/issues/751
      //
      // TODO: it might not be worth the trouble to show these fields as disabled,
      // if this fix causes trouble in future dependency updates.
      const { pauseValidation, resumeValidation } = form;
      pauseValidation(false);
      useEffect(() => resumeValidation(), [values]);

      const displayShipping = displayDeliveryShipping(listingTypeConfig);
      const displayPickup = displayDeliveryPickup(listingTypeConfig);
      const displayMultipleDelivery = displayShipping && displayPickup;
      const shippingEnabled = displayShipping && values.deliveryOptions?.includes('shipping');
      const pickupEnabled = displayPickup && values.deliveryOptions?.includes('pickup');

      const addressRequiredMessage = intl.formatMessage({
        id: 'EditListingDeliveryForm.addressRequired',
      });
      const addressNotRecognizedMessage = intl.formatMessage({
        id: 'EditListingDeliveryForm.addressNotRecognized',
      });

      const optionalText = intl.formatMessage({
        id: 'EditListingDeliveryForm.optionalText',
      });

      const { updateListingError, showListingsError } = fetchErrors || {};

      const classes = classNames(css.root, className);
      const submitReady = (updated && pristine) || ready;
      const submitInProgress = updateInProgress;
      const submitDisabled =
        invalid || disabled || submitInProgress || (!shippingEnabled && !pickupEnabled);

      const shippingLabel = intl.formatMessage({ id: 'EditListingDeliveryForm.shippingLabel' });
      const pickupLabel = intl.formatMessage({ id: 'EditListingDeliveryForm.pickupLabel' });

      const pickupClasses = classNames({
        [css.deliveryOption]: displayMultipleDelivery,
        [css.disabled]: !pickupEnabled,
        [css.hidden]: !displayPickup,
      });
      const shippingClasses = classNames({
        [css.deliveryOption]: displayMultipleDelivery,
        [css.disabled]: !shippingEnabled,
        [css.hidden]: !displayShipping,
      });
      const currencyConfig = appSettings.getCurrencyFormatting(marketplaceCurrency);

      return (
        <Form className={classes} onSubmit={handleSubmit}>
          <FieldCheckbox
            id={formId ? `${formId}.pickup` : 'pickup'}
            className={classNames(css.deliveryCheckbox, { [css.hidden]: !displayMultipleDelivery })}
            name="deliveryOptions"
            label={pickupLabel}
            value="pickup"
          />
          <div className={pickupClasses}>
            {updateListingError ? (
              <p className={css.error}>
                <FormattedMessage id="EditListingDeliveryForm.updateFailed" />
              </p>
            ) : null}

            {showListingsError ? (
              <p className={css.error}>
                <FormattedMessage id="EditListingDeliveryForm.showListingFailed" />
              </p>
            ) : null}

            <FieldLocationAutocompleteInput
              disabled={!pickupEnabled}
              rootClassName={css.input}
              inputClassName={css.locationAutocompleteInput}
              iconClassName={css.locationAutocompleteInputIcon}
              predictionsClassName={css.predictionsRoot}
              validClassName={css.validLocation}
              autoFocus={autoFocus}
              name="location"
              id={`${formId}.location`}
              label={intl.formatMessage({ id: 'EditListingDeliveryForm.address' })}
              placeholder={intl.formatMessage({
                id: 'EditListingDeliveryForm.addressPlaceholder',
              })}
              useDefaultPredictions={false}
              format={identity}
              valueFromForm={values.location}
              validate={
                pickupEnabled
                  ? composeValidators(
                      autocompleteSearchRequired(addressRequiredMessage),
                      autocompletePlaceSelected(addressNotRecognizedMessage)
                    )
                  : () => {}
              }
              hideErrorMessage={!pickupEnabled}
              // Whatever parameters are being used to calculate
              // the validation function need to be combined in such
              // a way that, when they change, this key prop
              // changes, thus reregistering this field (and its
              // validation function) with Final Form.
              // See example: https://codesandbox.io/s/changing-field-level-validators-zc8ei
              key={pickupEnabled ? 'locationValidation' : 'noLocationValidation'}
            />

            <FieldTextInput
              className={css.input}
              type="text"
              name="building"
              id={formId ? `${formId}.building` : 'building'}
              label={intl.formatMessage(
                { id: 'EditListingDeliveryForm.building' },
                { optionalText }
              )}
              placeholder={intl.formatMessage({
                id: 'EditListingDeliveryForm.buildingPlaceholder',
              })}
              disabled={!pickupEnabled}
            />

            {/* XOLOLO: recolección local puede ser gratis (default 0) o con
                cobro. Al pagar, el buyer recibe un código de 6 dígitos que
                muestra al recoger; el seller lo valida en su dashboard. */}
            <FieldCurrencyInput
              id={formId ? `${formId}.pickupPrice` : 'pickupPrice'}
              name="pickupPrice"
              className={css.input}
              label="Costo de recolección"
              placeholder="$0 = gratis"
              currencyConfig={currencyConfig}
              disabled={!pickupEnabled}
            />
            <p className={css.xxHint}>
              Deja en $0 si la recolección es gratis. Al pagar, el buyer recibe
              un código de 6 dígitos que te muestra al recoger.
            </p>
          </div>

          <FieldCheckbox
            id={formId ? `${formId}.shipping` : 'shipping'}
            className={classNames(css.deliveryCheckbox, { [css.hidden]: !displayMultipleDelivery })}
            name="deliveryOptions"
            label={shippingLabel}
            value="shipping"
          />

          <div className={shippingClasses}>
            {/* XOLOLO: modo de precio del envío.
                - flat: seller pone un costo fijo (comportamiento default de Sharetribe).
                - carrier: costo se calcula al momento del checkout usando Skydropx
                  con el peso/dimensiones del producto y el CP del buyer. */}
            <fieldset className={css.xxShippingModeGroup} disabled={!shippingEnabled}>
              <legend className={css.xxShippingModeLegend}>Cómo defines el costo</legend>
              <FieldRadioButton
                id={`${formId}.shippingPricingMode.flat`}
                name="shippingPricingMode"
                label="Precio fijo (yo lo pongo)"
                value="flat"
              />
              <FieldRadioButton
                id={`${formId}.shippingPricingMode.carrier`}
                name="shippingPricingMode"
                label="Cotizar con paquetería (Skydropx)"
                value="carrier"
              />
            </fieldset>

            {values.shippingPricingMode === 'flat' || !values.shippingPricingMode ? (
              <>
                <FieldCurrencyInput
                  id={
                    formId
                      ? `${formId}.shippingPriceInSubunitsOneItem`
                      : 'shippingPriceInSubunitsOneItem'
                  }
                  name="shippingPriceInSubunitsOneItem"
                  className={css.input}
                  label={intl.formatMessage({
                    id: 'EditListingDeliveryForm.shippingOneItemLabel',
                  })}
                  placeholder={intl.formatMessage({
                    id: 'EditListingDeliveryForm.shippingOneItemPlaceholder',
                  })}
                  currencyConfig={currencyConfig}
                  disabled={!shippingEnabled}
                  validate={
                    shippingEnabled && values.shippingPricingMode !== 'carrier'
                      ? required(
                          intl.formatMessage({
                            id: 'EditListingDeliveryForm.shippingOneItemRequired',
                          })
                        )
                      : null
                  }
                  hideErrorMessage={!shippingEnabled}
                  key={shippingEnabled ? 'oneItemValidation' : 'noOneItemValidation'}
                />

                {allowOrdersOfMultipleItems ? (
                  <FieldCurrencyInput
                    id={
                      formId
                        ? `${formId}.shippingPriceInSubunitsAdditionalItems`
                        : 'shippingPriceInSubunitsAdditionalItems'
                    }
                    name="shippingPriceInSubunitsAdditionalItems"
                    className={css.input}
                    label={intl.formatMessage({
                      id: 'EditListingDeliveryForm.shippingAdditionalItemsLabel',
                    })}
                    placeholder={intl.formatMessage({
                      id: 'EditListingDeliveryForm.shippingAdditionalItemsPlaceholder',
                    })}
                    currencyConfig={currencyConfig}
                    disabled={!shippingEnabled}
                    validate={
                      shippingEnabled && values.shippingPricingMode !== 'carrier'
                        ? required(
                            intl.formatMessage({
                              id: 'EditListingDeliveryForm.shippingAdditionalItemsRequired',
                            })
                          )
                        : null
                    }
                    hideErrorMessage={!shippingEnabled}
                    key={
                      shippingEnabled ? 'additionalItemsValidation' : 'noAdditionalItemsValidation'
                    }
                  />
                ) : null}
              </>
            ) : null}

            {values.shippingPricingMode === 'carrier' ? (
              <>
                {/* Peso + dimensiones son requeridos para cotizar en Skydropx.
                    Todos en unidades métricas (gramos y cm) — la API los pide así. */}
                <div className={css.xxDimensionsGrid}>
                  <FieldTextInput
                    id={`${formId}.weightGrams`}
                    name="weightGrams"
                    className={css.input}
                    type="number"
                    min="1"
                    label="Peso (gramos)"
                    placeholder="500"
                    validate={
                      shippingEnabled && values.shippingPricingMode === 'carrier'
                        ? required('El peso es requerido para cotizar el envío.')
                        : null
                    }
                    hideErrorMessage={!shippingEnabled}
                  />
                  <FieldTextInput
                    id={`${formId}.dimensionLengthCm`}
                    name="dimensionLengthCm"
                    className={css.input}
                    type="number"
                    min="1"
                    label="Largo (cm)"
                    placeholder="20"
                    validate={
                      shippingEnabled && values.shippingPricingMode === 'carrier'
                        ? required('Requerido.')
                        : null
                    }
                    hideErrorMessage={!shippingEnabled}
                  />
                  <FieldTextInput
                    id={`${formId}.dimensionWidthCm`}
                    name="dimensionWidthCm"
                    className={css.input}
                    type="number"
                    min="1"
                    label="Ancho (cm)"
                    placeholder="15"
                    validate={
                      shippingEnabled && values.shippingPricingMode === 'carrier'
                        ? required('Requerido.')
                        : null
                    }
                    hideErrorMessage={!shippingEnabled}
                  />
                  <FieldTextInput
                    id={`${formId}.dimensionHeightCm`}
                    name="dimensionHeightCm"
                    className={css.input}
                    type="number"
                    min="1"
                    label="Alto (cm)"
                    placeholder="10"
                    validate={
                      shippingEnabled && values.shippingPricingMode === 'carrier'
                        ? required('Requerido.')
                        : null
                    }
                    hideErrorMessage={!shippingEnabled}
                  />
                </div>
                <p className={css.xxHint}>
                  Peso y dimensiones del paquete cerrado. Se usan al momento del
                  checkout para cotizar en Skydropx contra el CP del buyer.
                </p>
              </>
            ) : null}

            {/* XOLOLO: promo "envío gratis" — el seller absorbe el costo. Si
                está activo, el buyer ve "Envío gratis 🎁" y en el checkout
                Xololo no le cobra por el envío. Aplica tanto a precio fijo
                como a cotización dinámica. */}
            <FieldCheckbox
              id={`${formId}.sellerCoversShipping`}
              name="sellerCoversShipping"
              label="🎁 Ofrezco envío gratis (yo absorbo el costo)"
              value="yes"
            />
            <p className={css.xxHint}>
              Si lo activas, el buyer verá &quot;Envío gratis&quot; y no se le
              cobrará el envío en el checkout. El costo lo asumes tú.
            </p>
          </div>

          <Button
            className={css.submitButton}
            type="submit"
            inProgress={submitInProgress}
            disabled={submitDisabled}
            ready={submitReady}
          >
            {saveActionMsg}
          </Button>
        </Form>
      );
    }}
  />
);

export default EditListingDeliveryForm;
