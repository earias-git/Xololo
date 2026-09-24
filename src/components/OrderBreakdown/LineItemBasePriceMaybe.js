import React from 'react';
import { FormattedMessage, intlShape } from '../../util/reactIntl';
import { formatMoney } from '../../util/currency';
import {
  LINE_ITEM_DAY,
  LINE_ITEM_FIXED,
  LINE_ITEM_HOUR,
  LINE_ITEM_NIGHT,
  LINE_ITEM_OFFER,
  LINE_ITEM_REQUEST,
  propTypes,
} from '../../util/types';

import css from './OrderBreakdown.module.css';

/**
 * A component that renders the base price as a line item.
 *
 * @component
 * @param {Object} props
 * @param {Array<propTypes.lineItem>} props.lineItems - The line items to render
 * @param {propTypes.lineItemUnitType} props.code - The code of the line item
 * @param {intlShape} props.intl - The intl object
 * @returns {JSX.Element}
 */
const LineItemBasePriceMaybe = props => {
  // XOLOLO Cart.5: `title` es el nombre del listing primary, usado
  // para etiquetar la línea cuando el carrito tiene 2+ items del
  // mismo seller (así el buyer distingue cuál es cada uno en el
  // desglose). Sólo aplica al code `line-item/item`; los otros
  // (bookings, hours) mantienen su etiqueta original.
  const { lineItems, code, intl, title } = props;
  const isNightly = code === LINE_ITEM_NIGHT;
  const isDaily = code === LINE_ITEM_DAY;
  const isHourly = code === LINE_ITEM_HOUR;
  const isFixed = code === LINE_ITEM_FIXED;
  const isRequest = code === LINE_ITEM_REQUEST;
  const isOffer = code === LINE_ITEM_OFFER;
  const translationKey = isNightly
    ? 'OrderBreakdown.baseUnitNight'
    : isDaily
    ? 'OrderBreakdown.baseUnitDay'
    : isHourly
    ? 'OrderBreakdown.baseUnitHour'
    : isFixed
    ? 'OrderBreakdown.baseUnitFixedBooking'
    : isRequest
    ? 'OrderBreakdown.baseUnitRequest'
    : isOffer
    ? 'OrderBreakdown.baseUnitOffer'
    : 'OrderBreakdown.baseUnitQuantity';

  // Find correct line-item for given code prop.
  // It should be one of the following: 'line-item/night, 'line-item/day', 'line-item/hour', 'line-item/fixed', 'line-item/item', 'line-item/offer', 'line-item/request'
  // These are defined in '../../util/types';
  const unitPurchase = lineItems.find(item => item.code === code && !item.reversal);

  const quantity = unitPurchase?.units
    ? unitPurchase.units.toString()
    : unitPurchase?.quantity
    ? unitPurchase.quantity.toString()
    : null;
  const unitPrice = unitPurchase ? formatMoney(intl, unitPurchase.unitPrice) : null;
  const total = unitPurchase ? formatMoney(intl, unitPurchase.lineTotal) : null;

  const message = unitPurchase?.seats ? (
    <FormattedMessage
      id={`${translationKey}Seats`}
      values={{ unitPrice, quantity, seats: unitPurchase.seats }}
    />
  ) : (
    <FormattedMessage id={translationKey} values={{ unitPrice, quantity }} />
  );

  // XOLOLO: si viene título (multi-cart), lo usamos como etiqueta
  // principal y el `unitPrice × quantity` va debajo, más chico.
  const useTitleLayout = !!title && code === 'line-item/item';

  return quantity && total ? (
    <div className={css.lineItem}>
      {useTitleLayout ? (
        <span className={css.itemLabel}>
          <span>{title}</span>
          <br />
          <small style={{ color: 'var(--colorGrey500)', fontSize: '13px' }}>
            {quantity} × {unitPrice}
          </small>
        </span>
      ) : (
        <span className={css.itemLabel}>{message}</span>
      )}
      <span className={css.itemValue}>{total}</span>
    </div>
  ) : null;
};

export default LineItemBasePriceMaybe;
