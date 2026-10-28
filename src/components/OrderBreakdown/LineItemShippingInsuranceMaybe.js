import React from 'react';
import { FormattedMessage, intlShape } from '../../util/reactIntl';
import { formatMoney } from '../../util/currency';
import { propTypes } from '../../util/types';

import css from './OrderBreakdown.module.css';

// XOLOLO Junta 2026-10-26: línea separada para el seguro Skydropx SOS.
// Se renderiza sólo cuando el buyer contrató la Protección SOS en el
// checkout. El total ya trae el margen Xololo aplicado — el buyer
// nunca ve "+12.5%", sólo el precio final.
const LINE_ITEM_SHIPPING_INSURANCE = 'line-item/shipping-insurance';

/**
 * @param {Object} props
 * @param {Array<propTypes.lineItem>} props.lineItems
 * @param {intlShape} props.intl
 * @returns {JSX.Element|null}
 */
const LineItemShippingInsuranceMaybe = props => {
  const { lineItems, intl } = props;

  const insuranceLineItem = lineItems.find(
    item => item.code === LINE_ITEM_SHIPPING_INSURANCE && !item.reversal
  );

  return insuranceLineItem ? (
    <div className={css.lineItem}>
      <span className={css.itemLabel}>
        <FormattedMessage id="OrderBreakdown.shippingInsurance" defaultMessage="Protección SOS" />
      </span>
      <span className={css.itemValue}>{formatMoney(intl, insuranceLineItem.lineTotal)}</span>
    </div>
  ) : null;
};

export default LineItemShippingInsuranceMaybe;
