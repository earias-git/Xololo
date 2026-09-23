import React from 'react';

import { FormattedMessage, intlShape } from '../../util/reactIntl';
import { formatMoney } from '../../util/currency';
import { LINE_ITEM_XOLOLO_SERVICE_FEE, propTypes } from '../../util/types';

import css from './OrderBreakdown.module.css';

/**
 * XOLOLO: cargo fijo de $14 + IVA por transacción (costos
 * administrativos y servicios digitales de terceros) — se descuenta
 * del payout del seller, nunca se le suma al comprador. Sólo visible
 * en la vista del provider (mismo patrón que LineItemProviderCommissionMaybe).
 *
 * @component
 * @param {Object} props
 * @param {Array<propTypes.lineItem>} props.lineItems - The line items to render
 * @param {boolean} props.isProvider - Whether the current viewer is the provider
 * @param {intlShape} props.intl - The intl object
 * @returns {JSX.Element}
 */
const LineItemXololoServiceFeeMaybe = props => {
  const { lineItems, isProvider, intl } = props;

  const feeLineItem = lineItems.find(
    item => item.code === LINE_ITEM_XOLOLO_SERVICE_FEE && !item.reversal
  );

  return isProvider && feeLineItem ? (
    <div className={css.lineItem}>
      <span className={css.itemLabel}>
        <FormattedMessage id="OrderBreakdown.xololoServiceFee" />
      </span>
      <span className={css.itemValue}>{formatMoney(intl, feeLineItem.lineTotal)}</span>
    </div>
  ) : null;
};

export default LineItemXololoServiceFeeMaybe;
