import React from 'react';
import classNames from 'classnames';

import css from './XololoShippingMethodSelector.module.css';

// XOLOLO Envíos v2: selector de método de entrega en el checkout.
//
// Se renderiza cuando el primary listing tiene
// publicData.xololoShippingMethods con al menos un método habilitado.
// El buyer elige UNO de los métodos y el value se persiste en
// values.selectedShippingMethod (via formApi.change en el padre).
//
// El servidor lo consume en:
//   - server/api-util/lineItems.js → shipping-fee del line item.
//   - server/api/initiate-privileged.js → protectedData.xololoShipping.
//
// Props:
//   methods: shape retornado por getShippingMethodsFromListing()
//   value:   'pickup' | 'localDelivery' | 'freight' | null
//   onChange(next): callback con la nueva selección
//   currencyFormatter(subunits): función que formatea $ (viene del padre
//     porque ya tenemos intl/formatMoney allí)

const XololoShippingMethodSelector = ({
  methods,
  value,
  defaultMethod,
  onChange,
  currencyFormatter,
}) => {
  const list = [];
  if (methods?.pickup?.enabled) {
    list.push({
      key: 'pickup',
      title: 'Recolección en domicilio del vendedor',
      priceLabel: 'Gratis',
      note: methods.pickup.instructions || 'El vendedor te compartirá los detalles después de la compra.',
    });
  }
  if (methods?.localDelivery?.enabled) {
    const priceSubunits = Number(methods.localDelivery.priceSubunits) || 0;
    list.push({
      key: 'localDelivery',
      title: 'Envío en zona local',
      priceLabel: currencyFormatter(priceSubunits),
      note: methods.localDelivery.zoneDescription
        ? `Cobertura: ${methods.localDelivery.zoneDescription}`
        : 'Consulta con el vendedor si tu dirección está dentro de la zona.',
    });
  }
  if (methods?.skydropxCarrier?.enabled) {
    list.push({
      key: 'skydropxCarrier',
      title: 'Envío por paquetería',
      priceLabel: methods.skydropxCarrier.sellerCoversShipping ? 'Gratis' : 'Cotización en línea',
      note: methods.skydropxCarrier.sellerCoversShipping
        ? 'El vendedor cubre el costo del envío.'
        : 'Verás cotizaciones en vivo (Estafeta, FedEx, etc.) al capturar tu dirección abajo.',
    });
  }
  if (methods?.freight?.enabled) {
    list.push({
      key: 'freight',
      title: 'Envío por flete (cotizar después)',
      priceLabel: 'Por cotizar',
      note:
        'El vendedor te enviará el costo del envío tras la compra. Pagarás sólo los productos ahora y autorizarás el flete cuando recibas la cotización.',
    });
  }

  if (list.length === 0) {
    return (
      <div className={css.empty}>
        Este producto no tiene métodos de entrega configurados aún.
        Contacta al vendedor.
      </div>
    );
  }

  // XOLOLO Bug envíos v2: si el buyer no ha elegido explícitamente,
  // usamos `defaultMethod` para que el radio se vea pre-seleccionado.
  // Sin este fallback la primera vez se veían todas sin marcar y al
  // hacer clic la selección "no pegaba" por conflicto con initialValues
  // del form (que re-inicializaba en cada re-speculate).
  const effectiveValue = value || defaultMethod || null;

  return (
    <div className={css.root}>
      <h4 className={css.title}>¿Cómo quieres recibir tu pedido?</h4>
      <ul className={css.list}>
        {list.map(m => {
          const checked = effectiveValue === m.key;
          return (
            <li
              key={m.key}
              className={classNames(css.item, { [css.itemChecked]: checked })}
            >
              <label className={css.label}>
                <input
                  type="radio"
                  name="xololoShippingMethod"
                  value={m.key}
                  checked={checked}
                  onChange={() => onChange(m.key)}
                  className={css.radio}
                />
                <div className={css.itemBody}>
                  <div className={css.itemHeader}>
                    <span className={css.itemTitle}>{m.title}</span>
                    <span className={css.itemPrice}>{m.priceLabel}</span>
                  </div>
                  <div className={css.itemNote}>{m.note}</div>
                </div>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default XololoShippingMethodSelector;
