import React, { useEffect, useRef, useState } from 'react';
import classNames from 'classnames';

import { FormattedMessage, intlShape } from '../../../util/reactIntl';
import * as validators from '../../../util/validators';
import { apiBaseUrl } from '../../../util/api';
import getCountryCodes from '../../../translations/countryCodes';

import { FieldSelect, FieldTextInput, Heading } from '../../../components';

import css from './ShippingDetails.module.css';

// XOLOLO: hook que consulta /api/postal-code cuando el buyer escribe
// 5 dígitos válidos y devuelve {state, city, colonies}. Debounce 400ms
// para no golpear el endpoint por cada tecla. Devuelve status:
//  - 'idle'   : sin lookup activo (CP < 5 dígitos, o country ≠ MX)
//  - 'loading': fetch en curso
//  - 'ok'     : data cargada
//  - 'error'  : CP inválido, no encontrado o backend down (mostrar
//               inputs manuales como fallback)
const usePostalCodeLookup = (cp, countryCode) => {
  const [state, setState] = useState({ status: 'idle', data: null, error: null });
  const timerRef = useRef(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setState(prev => (prev.status === 'idle' ? prev : { status: 'idle', data: null, error: null }));

    // Sólo aplica a México. Si el buyer eligió otro país, el CP se
    // llena a mano (no todos los países tienen el mismo formato ni
    // API disponible en v1).
    if (countryCode && countryCode !== 'MX') return;
    if (!/^\d{5}$/.test(String(cp || '').trim())) return;

    timerRef.current = setTimeout(async () => {
      setState({ status: 'loading', data: null, error: null });
      try {
        const res = await fetch(`${apiBaseUrl()}/api/postal-code?cp=${cp}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setState({ status: 'error', data: null, error: data.error || 'lookup_failed' });
          return;
        }
        setState({ status: 'ok', data, error: null });
      } catch (e) {
        setState({ status: 'error', data: null, error: 'network' });
      }
    }, 400);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [cp, countryCode]);

  return state;
};

/**
 * A component that displays the shipping details form on the checkout page.
 *
 * @component
 * @param {Object} props
 * @param {string} props.rootClassName - The root class name for the shipping details
 * @param {string} props.className - The class name for the shipping details
 * @param {string} props.locale - The locale
 * @param {intlShape} props.intl - The intl object
 * @param {boolean} props.disabled - Whether the form is disabled
 * @param {Object} props.formApi - The form API from React Final Form
 * @param {Object} props.values - Current form values (from Final Form render props)
 * @param {string} props.fieldId - The field ID
 */
const ShippingDetails = props => {
  const { rootClassName, className, locale, intl, disabled, formApi, values, fieldId } = props;
  const classes = classNames(rootClassName || css.root, className);

  const countryCodes = getCountryCodes(locale);

  const cp = values?.recipientPostal;
  const country = values?.recipientCountry;
  const lookup = usePostalCodeLookup(cp, country);
  const isMexico = !country || country === 'MX';

  // Auto-fill state + city cuando el lookup responde (sólo si el
  // usuario no las ha tecleado manualmente en esta sesión — respetamos
  // valores existentes para no pisar ediciones).
  useEffect(() => {
    if (lookup.status !== 'ok' || !lookup.data) return;
    const { state, city } = lookup.data;
    if (state && !values?.recipientState) {
      formApi.change('recipientState', state);
    }
    if (city && !values?.recipientCity) {
      formApi.change('recipientCity', city);
    }
    // Si la colonia actual no está en las opciones nuevas, la limpiamos
    // para forzar al buyer a re-elegir (evita quedar con colonia del CP
    // anterior).
    const currentColonia = values?.recipientNeighborhood;
    if (currentColonia && !lookup.data.colonies.includes(currentColonia)) {
      formApi.change('recipientNeighborhood', undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookup.status, lookup.data]);

  const colonyOptions =
    lookup.status === 'ok' && Array.isArray(lookup.data?.colonies) ? lookup.data.colonies : [];
  const showColoniaSelect = isMexico && colonyOptions.length > 0;

  return (
    <div className={classes}>
      <Heading as="h3" rootClassName={css.heading}>
        <FormattedMessage id="ShippingDetails.title" />
      </Heading>
      <FieldTextInput
        id={`${fieldId}.recipientName`}
        name="recipientName"
        disabled={disabled}
        className={css.fieldFullWidth}
        type="text"
        autoComplete="shipping name"
        label={intl.formatMessage({ id: 'ShippingDetails.recipientNameLabel' })}
        placeholder={intl.formatMessage({
          id: 'ShippingDetails.recipientNamePlaceholder',
        })}
        validate={validators.required(
          intl.formatMessage({ id: 'ShippingDetails.recipientNameRequired' })
        )}
        onUnmount={() => formApi.change('recipientName', undefined)}
      />
      <FieldTextInput
        id={`${fieldId}.recipientPhoneNumber`}
        name="recipientPhoneNumber"
        disabled={disabled}
        className={css.fieldFullWidth}
        type="text"
        autoComplete="shipping phoneNumber"
        label={intl.formatMessage({ id: 'ShippingDetails.recipientPhoneNumberLabel' })}
        placeholder={intl.formatMessage({
          id: 'ShippingDetails.recipientPhoneNumberPlaceholder',
        })}
        validate={validators.required(
          intl.formatMessage({ id: 'ShippingDetails.recipientPhoneNumberRequired' })
        )}
        onUnmount={() => formApi.change('recipientPhoneNumber', undefined)}
      />

      <FieldSelect
        id={`${fieldId}.recipientCountry`}
        name="recipientCountry"
        disabled={disabled}
        className={css.fieldFullWidth}
        label={intl.formatMessage({ id: 'ShippingDetails.countryLabel' })}
        validate={validators.required(
          intl.formatMessage({ id: 'ShippingDetails.countryRequired' })
        )}
        defaultValue="MX"
      >
        <option disabled value="">
          {intl.formatMessage({ id: 'ShippingDetails.countryPlaceholder' })}
        </option>
        {countryCodes.map(c => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </FieldSelect>

      {/* CP arriba (para dispara el lookup antes de que llenen el resto) */}
      <div className={css.formRow}>
        <FieldTextInput
          id={`${fieldId}.recipientPostalCode`}
          name="recipientPostal"
          disabled={disabled}
          className={css.field}
          type="text"
          inputMode={isMexico ? 'numeric' : 'text'}
          maxLength={isMexico ? 5 : undefined}
          autoComplete="shipping postal-code"
          label={intl.formatMessage({ id: 'ShippingDetails.postalCodeLabel' })}
          placeholder={intl.formatMessage({
            id: 'ShippingDetails.postalCodePlaceholder',
          })}
          validate={validators.required(
            intl.formatMessage({ id: 'ShippingDetails.postalCodeRequired' })
          )}
          onUnmount={() => formApi.change('recipientPostal', undefined)}
        />
        <FieldTextInput
          id={`${fieldId}.recipientState`}
          name="recipientState"
          disabled={disabled || (isMexico && lookup.status === 'ok')}
          className={css.field}
          type="text"
          autoComplete="shipping address-level1"
          label={intl.formatMessage({ id: 'ShippingDetails.stateLabel' })}
          placeholder={intl.formatMessage({ id: 'ShippingDetails.statePlaceholder' })}
          validate={validators.required(
            intl.formatMessage({ id: 'ShippingDetails.stateRequired' })
          )}
          onUnmount={() => formApi.change('recipientState', undefined)}
        />
      </div>

      {isMexico && lookup.status === 'loading' ? (
        <p className={css.lookupHint}>Buscando datos del código postal…</p>
      ) : null}
      {isMexico && lookup.status === 'error' && cp && /^\d{5}$/.test(String(cp)) ? (
        <p className={css.lookupHintWarn}>
          No pudimos autocompletar por CP. Escribe estado, ciudad y colonia a mano.
        </p>
      ) : null}

      <div className={css.formRow}>
        <FieldTextInput
          id={`${fieldId}.recipientCity`}
          name="recipientCity"
          disabled={disabled}
          className={css.field}
          type="text"
          autoComplete="shipping address-level2"
          label={intl.formatMessage({ id: 'ShippingDetails.cityLabel' })}
          placeholder={intl.formatMessage({ id: 'ShippingDetails.cityPlaceholder' })}
          validate={validators.required(intl.formatMessage({ id: 'ShippingDetails.cityRequired' }))}
          onUnmount={() => formApi.change('recipientCity', undefined)}
        />
        {showColoniaSelect ? (
          <FieldSelect
            id={`${fieldId}.recipientNeighborhood`}
            name="recipientNeighborhood"
            disabled={disabled}
            className={css.field}
            label={intl.formatMessage({ id: 'ShippingDetails.neighborhoodLabel' })}
            validate={validators.required(
              intl.formatMessage({ id: 'ShippingDetails.neighborhoodRequired' })
            )}
          >
            <option disabled value="">
              {intl.formatMessage({ id: 'ShippingDetails.neighborhoodPlaceholder' })}
            </option>
            {colonyOptions.map(colonia => (
              <option key={colonia} value={colonia}>
                {colonia}
              </option>
            ))}
          </FieldSelect>
        ) : (
          <FieldTextInput
            id={`${fieldId}.recipientNeighborhood`}
            name="recipientNeighborhood"
            disabled={disabled}
            className={css.field}
            type="text"
            label={intl.formatMessage({ id: 'ShippingDetails.neighborhoodLabel' })}
            placeholder={intl.formatMessage({ id: 'ShippingDetails.neighborhoodPlaceholder' })}
            validate={validators.required(
              intl.formatMessage({ id: 'ShippingDetails.neighborhoodRequired' })
            )}
            onUnmount={() => formApi.change('recipientNeighborhood', undefined)}
          />
        )}
      </div>

      <div className={css.formRow}>
        <FieldTextInput
          id={`${fieldId}.recipientAddressLine1`}
          name="recipientAddressLine1"
          disabled={disabled}
          className={css.field}
          type="text"
          autoComplete="shipping address-line1"
          label={intl.formatMessage({ id: 'ShippingDetails.addressLine1Label' })}
          placeholder={intl.formatMessage({
            id: 'ShippingDetails.addressLine1Placeholder',
          })}
          validate={validators.required(
            intl.formatMessage({ id: 'ShippingDetails.addressLine1Required' })
          )}
          onUnmount={() => formApi.change('recipientAddressLine1', undefined)}
        />
        <FieldTextInput
          id={`${fieldId}.recipientAddressLine2`}
          name="recipientAddressLine2"
          disabled={disabled}
          className={css.field}
          type="text"
          autoComplete="shipping address-line2"
          label={intl.formatMessage(
            { id: 'ShippingDetails.addressLine2Label' },
            { optionalText: intl.formatMessage({ id: 'ShippingDetails.optionalText' }) }
          )}
          placeholder={intl.formatMessage({
            id: 'ShippingDetails.addressLine2Placeholder',
          })}
          onUnmount={() => formApi.change('recipientAddressLine2', undefined)}
        />
      </div>

      <FieldTextInput
        id={`${fieldId}.recipientReferences`}
        name="recipientReferences"
        type="textarea"
        rows={3}
        disabled={disabled}
        className={css.fieldFullWidth}
        label={intl.formatMessage({ id: 'ShippingDetails.referencesLabel' })}
        placeholder={intl.formatMessage({ id: 'ShippingDetails.referencesPlaceholder' })}
        validate={validators.composeValidators(
          validators.required(
            intl.formatMessage({ id: 'ShippingDetails.referencesRequired' })
          ),
          validators.minLength(
            intl.formatMessage({ id: 'ShippingDetails.referencesTooShort' }),
            10
          )
        )}
        onUnmount={() => formApi.change('recipientReferences', undefined)}
      />
    </div>
  );
};

export default ShippingDetails;
