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
      // XOLOLO Envíos v2: submit permitido si hay AL MENOS un método
      // activo (legacy pickup/shipping O nuevo xoloMethods).
      // FieldCheckbox con `value` guarda ['true']|[] (array), y `!!array`
      // es siempre true — hay que checar length. Aceptamos también
      // boolean true por defensa (si en el futuro cambiamos el shape).
      const xoloIsOnRobust = v => (Array.isArray(v) ? v.length > 0 : v === true);
      const xoloHasAny =
        xoloIsOnRobust(values.xololoMethods?.pickup?.enabled) ||
        xoloIsOnRobust(values.xololoMethods?.localDelivery?.enabled) ||
        xoloIsOnRobust(values.xololoMethods?.freight?.enabled);
      const submitDisabled =
        invalid ||
        disabled ||
        submitInProgress ||
        (!shippingEnabled && !pickupEnabled && !xoloHasAny);

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

      // XOLOLO Envíos v2: sección nueva de 3 métodos. Vive en
      // values.xololoMethods.{pickup|localDelivery|freight}.
      // La sección legacy se OCULTA cuando cualquier método v2 está
      // activo — ver `xoloHasAny` arriba.
      const xoloMethods = values.xololoMethods || {};
      const xoloPickupOn = xoloIsOnRobust(xoloMethods.pickup?.enabled);
      const xoloLocalOn = xoloIsOnRobust(xoloMethods.localDelivery?.enabled);
      const xoloFreightOn = xoloIsOnRobust(xoloMethods.freight?.enabled);

      return (
        <Form className={classes} onSubmit={handleSubmit}>
          {/* ============================================================
              XOLOLO Envíos v2: 3 métodos configurables por listing.
              Reemplaza el modelo legacy shippingPricingMode/deliveryOptions.
              Ver src/util/xololoShippingMethods.js.
              ============================================================ */}
          <fieldset className={css.xxShippingModeGroup}>
            <legend className={css.xxShippingModeLegend}>
              Métodos de entrega (Xololo)
            </legend>
            <p className={css.xxHint}>
              Elige uno o más métodos para este producto. El comprador
              podrá seleccionar cualquiera de los que actives.
            </p>

            {/* Método 1: Pickup en domicilio del seller (siempre $0) */}
            <FieldCheckbox
              id={`${formId}.xoloPickup`}
              className={css.deliveryCheckbox}
              name="xololoMethods.pickup.enabled"
              label="Recolección en mi domicilio (sin costo)"
              value="true"
            />
            {xoloPickupOn ? (
              <div style={{ marginLeft: 28, marginBottom: 12 }}>
                <FieldTextInput
                  id={`${formId}.xoloPickupInstructions`}
                  name="xololoMethods.pickup.instructions"
                  className={css.input}
                  type="textarea"
                  label="Instrucciones para el buyer (opcional)"
                  placeholder="Ej. Recoger de 10am a 6pm en Av. Insurgentes 123, portón azul."
                />
              </div>
            ) : null}

            {/* Método 2: Envío en zona local con costo fijo */}
            <FieldCheckbox
              id={`${formId}.xoloLocalDelivery`}
              className={css.deliveryCheckbox}
              name="xololoMethods.localDelivery.enabled"
              label="Envío en zona local (costo fijo)"
              value="true"
            />
            {xoloLocalOn ? (
              <div style={{ marginLeft: 28, marginBottom: 12 }}>
                <FieldCurrencyInput
                  id={`${formId}.xoloLocalPrice`}
                  name="xololoMethods.localDelivery.price"
                  className={css.input}
                  label="Costo del envío local"
                  placeholder="$0.00"
                  currencyConfig={currencyConfig}
                  validate={required('El costo es requerido.')}
                />
                <FieldTextInput
                  id={`${formId}.xoloLocalZone`}
                  name="xololoMethods.localDelivery.zoneDescription"
                  className={css.input}
                  type="text"
                  label="Zona de cobertura"
                  placeholder="Ej. CDMX y Área Metropolitana, o Zona Sur de Guadalajara"
                  validate={required('Describe la zona donde entregas.')}
                />
              </div>
            ) : null}

            {/* Método 3: Flete por cotizar (Fase 1 = placeholder) */}
            <FieldCheckbox
              id={`${formId}.xoloFreight`}
              className={css.deliveryCheckbox}
              name="xololoMethods.freight.enabled"
              label="Envío por flete (cotizar después)"
              value="true"
            />
            {xoloFreightOn ? (
              <p className={css.xxHint} style={{ marginLeft: 28 }}>
                El buyer completa la compra pagando sólo los productos.
                Después, en el detalle del pedido, tú le cotizas el envío
                y él lo autoriza para pagarlo aparte.
              </p>
            ) : null}
          </fieldset>

          {/* ============================================================
              LEGACY: los campos de abajo se ocultan cuando el seller ya
              tiene AL MENOS un método v2 activo — el server ignora el
              legacy en ese caso (ver server/api-util/lineItems.js). Se
              mantienen visibles sólo para listings viejos que aún no
              han migrado. Al ocultarse también dejan de bloquear el
              submit por validación required.
              ============================================================ */}
          {xoloHasAny ? null : (
          <>
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
          </>
          )}

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
