import React, { useEffect } from 'react';
import { Form as FinalForm } from 'react-final-form';
import classNames from 'classnames';

// Import configs and util modules
import appSettings from '../../../../config/settings';
import { required } from '../../../../util/validators';

// Import shared components
import {
  Form,
  Button,
  FieldCurrencyInput,
  FieldTextInput,
  FieldCheckbox,
} from '../../../../components';

// Import modules from this directory
import css from './EditListingDeliveryForm.module.css';

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
        className,
        disabled,
        ready,
        handleSubmit,
        pristine,
        invalid,
        marketplaceCurrency,
        saveActionMsg,
        updated,
        updateInProgress,
        values,
      } = formRenderProps;

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

      const classes = classNames(css.root, className);
      const submitReady = (updated && pristine) || ready;
      const submitInProgress = updateInProgress;
      // XOLOLO Envíos v2: submit permitido cuando el seller marca AL
      // MENOS un método v2. FieldCheckbox con `value` guarda ['true']|[]
      // (array), y `!!array` es siempre true — hay que checar length.
      // Aceptamos también boolean true por defensa.
      const xoloIsOnRobust = v => (Array.isArray(v) ? v.length > 0 : v === true);
      const xoloMethods = values.xololoMethods || {};
      const xoloPickupOn = xoloIsOnRobust(xoloMethods.pickup?.enabled);
      const xoloLocalOn = xoloIsOnRobust(xoloMethods.localDelivery?.enabled);
      const xoloSkydropxOn = xoloIsOnRobust(xoloMethods.skydropxCarrier?.enabled);
      const xoloFreightOn = xoloIsOnRobust(xoloMethods.freight?.enabled);
      const xoloHasAny = xoloPickupOn || xoloLocalOn || xoloSkydropxOn || xoloFreightOn;
      const submitDisabled = invalid || disabled || submitInProgress || !xoloHasAny;

      const currencyConfig = appSettings.getCurrencyFormatting(marketplaceCurrency);

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

            {/* Método 3: Skydropx (cotización con paquetería al momento del checkout) */}
            <FieldCheckbox
              id={`${formId}.xoloSkydropx`}
              className={css.deliveryCheckbox}
              name="xololoMethods.skydropxCarrier.enabled"
              label="Cotizar con paquetería (Skydropx)"
              value="true"
            />
            {xoloSkydropxOn ? (
              <div style={{ marginLeft: 28, marginBottom: 12 }}>
                <p className={css.xxHint}>
                  El buyer verá cotizaciones en vivo (Estafeta, FedEx, etc.)
                  contra su CP. Requiere peso y dimensiones del paquete cerrado.
                </p>
                <FieldTextInput
                  id={`${formId}.xoloWeightGrams`}
                  name="xololoMethods.skydropxCarrier.weightGrams"
                  className={css.input}
                  type="number"
                  label="Peso del paquete (gramos)"
                  placeholder="Ej. 1500"
                  validate={required('El peso es requerido.')}
                />
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <FieldTextInput
                    id={`${formId}.xoloDimLength`}
                    name="xololoMethods.skydropxCarrier.dimensionLengthCm"
                    className={css.input}
                    type="number"
                    label="Largo (cm)"
                    placeholder="Ej. 30"
                    validate={required('Requerido.')}
                  />
                  <FieldTextInput
                    id={`${formId}.xoloDimWidth`}
                    name="xololoMethods.skydropxCarrier.dimensionWidthCm"
                    className={css.input}
                    type="number"
                    label="Ancho (cm)"
                    placeholder="Ej. 20"
                    validate={required('Requerido.')}
                  />
                  <FieldTextInput
                    id={`${formId}.xoloDimHeight`}
                    name="xololoMethods.skydropxCarrier.dimensionHeightCm"
                    className={css.input}
                    type="number"
                    label="Alto (cm)"
                    placeholder="Ej. 15"
                    validate={required('Requerido.')}
                  />
                </div>
                <FieldCheckbox
                  id={`${formId}.xoloSellerCovers`}
                  name="xololoMethods.skydropxCarrier.sellerCoversShipping"
                  label="🎁 Yo absorbo el costo del envío (el buyer ve 'Envío gratis')"
                  value="true"
                />
              </div>
            ) : null}

            {/* Método 4: Flete por cotizar (Fase 1 = placeholder) */}
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
