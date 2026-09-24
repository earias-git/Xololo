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
  const { lineItems, intl } = props;

  const itemLineItems = lineItems.filter(li => li.code === LINE_ITEM_ITEM && !li.reversal);
  const additionalItems = itemLineItems.slice(1);

  if (additionalItems.length === 0) return null;

  return (
    <>
      {additionalItems.map((li, idx) => {
        const quantity = li.units ? li.units.toString() : li.quantity ? li.quantity.toString() : null;
        const unitPrice = formatMoney(intl, li.unitPrice);
        const total = formatMoney(intl, li.lineTotal);
        return (
          <div key={`additional-item-${idx}`} className={css.lineItem}>
            <span className={css.itemLabel}>
              <FormattedMessage
                id="OrderBreakdown.baseUnitQuantity"
                values={{ unitPrice, quantity }}
              />
            </span>
            <span className={css.itemValue}>{total}</span>
          </div>
        );
      })}
    </>
  );
};

export default LineItemAdditionalItemsMaybe;
