import React from 'react';
import { Field } from 'react-final-form';
import classNames from 'classnames';

import { formatMoney } from '../../../util/currency';
import { types as sdkTypes } from '../../../util/sdkLoader';

import css from './XololoShippingMethodField.module.css';

// XOLOLO Envíos v2 (rediseño): selector de método de entrega en la
// ListingPage (dentro del ProductOrderForm), ANTES de "Comprar ahora".
// Guarda la selección en values.selectedShippingMethod. También
// mantiene el campo legacy `deliveryMethod` derivado para que Sharetribe
// acepte la orden (pickup → 'pickup'; local/skydropx/freight → 'shipping').
//
// Reemplaza al selector v2 del checkout — así el buyer ya llega al
// checkout con el método fijado y evitamos re-especular + reset del
// FinalForm cada vez que cambia de método.

const { Money } = sdkTypes;

// Deriva el deliveryMethod legacy (para satisfacer el proceso de
// Sharetribe) desde el método v2 elegido.
export const deriveLegacyDeliveryMethod = xoloKey => {
  if (xoloKey === 'pickup') return 'pickup';
  if (
    xoloKey === 'localDelivery' ||
    xoloKey === 'skydropxCarrier' ||
    xoloKey === 'freight'
  ) {
    return 'shipping';
  }
  return null;
};

const buildOptions = (methods, intl, currency) => {
  const opts = [];
  const money = subunits => {
    const n = Number(subunits) || 0;
    if (n === 0) return 'Gratis';
    try {
      return formatMoney(intl, new Money(Math.round(n), currency || 'MXN'));
    } catch (e) {
      return `$${(n / 100).toFixed(2)}`;
    }
  };
  if (methods?.pickup?.enabled) {
    opts.push({
      key: 'pickup',
      title: 'Recolección en domicilio del vendedor',
      priceLabel: 'Gratis',
      note: methods.pickup.instructions
        ? methods.pickup.instructions
        : 'El vendedor te compartirá los detalles después de la compra.',
    });
  }
  if (methods?.localDelivery?.enabled) {
    opts.push({
      key: 'localDelivery',
      title: 'Envío en zona local',
      priceLabel: money(methods.localDelivery.priceSubunits),
      note: methods.localDelivery.zoneDescription
        ? `Cobertura: ${methods.localDelivery.zoneDescription}`
        : 'Consulta con el vendedor si tu dirección está dentro de la zona.',
    });
  }
  if (methods?.skydropxCarrier?.enabled) {
    opts.push({
      key: 'skydropxCarrier',
      title: 'Envío por paquetería',
      priceLabel: methods.skydropxCarrier.sellerCoversShipping ? 'Gratis' : 'Cotización en línea',
      note: methods.skydropxCarrier.sellerCoversShipping
        ? 'El vendedor cubre el costo del envío.'
        : 'Verás cotizaciones en vivo (Estafeta, FedEx, etc.) al capturar tu dirección en el checkout.',
    });
  }
  if (methods?.freight?.enabled) {
    opts.push({
      key: 'freight',
      title: 'Envío por flete',
      priceLabel: 'Por cotizar',
      note:
        'El vendedor te enviará el costo del envío tras la compra. Pagas sólo los productos ahora y autorizas el flete después.',
    });
  }
  return opts;
};

const XololoShippingMethodField = ({ methods, intl, currency, formId, formApi, value }) => {
  const options = buildOptions(methods, intl, currency);

  if (options.length === 0) return null;

  return (
    <div className={css.root}>
      <h4 className={css.title}>¿Cómo quieres recibir tu pedido?</h4>
      {options.map(opt => {
        const checked = value === opt.key;
        return (
          <label
            key={opt.key}
            className={classNames(css.option, { [css.optionChecked]: checked })}
          >
            <input
              type="radio"
              name={`${formId}.xoloShippingMethod`}
              value={opt.key}
              checked={checked}
              className={css.radio}
              onChange={() => {
                // Guardamos ambos campos:
                //  - selectedShippingMethod: elegido por el buyer (v2, para Xololo)
                //  - deliveryMethod: derivado (legacy, para Sharetribe)
                formApi.change('selectedShippingMethod', opt.key);
                formApi.change('deliveryMethod', deriveLegacyDeliveryMethod(opt.key));
              }}
            />
            <div className={css.body}>
              <div className={css.header}>
                <span className={css.optionTitle}>{opt.title}</span>
                <span className={css.optionPrice}>{opt.priceLabel}</span>
              </div>
              <div className={css.optionNote}>{opt.note}</div>
            </div>
          </label>
        );
      })}
      {/* Hidden field para que Final Form persista selectedShippingMethod
          en values y pase por la validación required abajo. */}
      <Field name="selectedShippingMethod" component="input" type="hidden" />
    </div>
  );
};

export default XololoShippingMethodField;
