import React from 'react';

import { FormattedMessage, intlShape } from '../../util/reactIntl';
import { formatMoney } from '../../util/currency';
import { LINE_ITEM_ITEM, propTypes } from '../../util/types';

import css from './OrderBreakdown.module.css';

/**
 * XOLOLO Cart.5: cuando el carrito tiene 2+ productos del mismo seller,
 * el server manda 2+ `line-item/item` (primary + additionalCartItems).
 * `LineItemBasePriceMaybe` sólo renderiza el PRIMERO (usa `.find()`),
 * así que sin este componente los items adicionales quedan invisibles
 * en el desglose aunque el precio total sí los incluye. Muestra los
 * items del índice 1 en adelante, cada uno con su lineTotal.
 *
 * @component
 * @param {Object} props
 * @param {Array<propTypes.lineItem>} props.lineItems
 * @param {intlShape} props.intl
 * @returns {JSX.Element|null}
 */
const LineItemAdditionalItemsMaybe = props => {
  // `titles`: array de títulos de los items adicionales, indexado
  // 1:1 con los line-item/item posiciones 2..N (excluye el primary).
  const { lineItems, intl, titles } = props;

  const itemLineItems = lineItems.filter(li => li.code === LINE_ITEM_ITEM && !li.reversal);
  const additionalItems = itemLineItems.slice(1);

  if (additionalItems.length === 0) return null;

  return (
    <>
      {additionalItems.map((li, idx) => {
        const quantity = li.units ? li.units.toString() : li.quantity ? li.quantity.toString() : null;
        const unitPrice = formatMoney(intl, li.unitPrice);
        const total = formatMoney(intl, li.lineTotal);
        const title = titles?.[idx];
        return (
          <div key={`additional-item-${idx}`} className={css.lineItem}>
            <span className={css.itemLabel}>
              {title ? (
                <>
                  <span>{title}</span>
                  <br />
                  <small style={{ color: 'var(--colorGrey500)', fontSize: '13px' }}>
                    {quantity} × {unitPrice}
                  </small>
                </>
              ) : (
                <FormattedMessage
                  id="OrderBreakdown.baseUnitQuantity"
                  values={{ unitPrice, quantity }}
                />
              )}
            </span>
            <span className={css.itemValue}>{total}</span>
          </div>
        );
      })}
    </>
  );
};

export default LineItemAdditionalItemsMaybe;
