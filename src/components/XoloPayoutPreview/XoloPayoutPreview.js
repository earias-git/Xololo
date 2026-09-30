import React from 'react';

import { computeFreightBreakdown } from '../../util/freightFees';

import css from './XoloPayoutPreview.module.css';

// XOLOLO: preview del payout que recibe el seller. Se usa en:
//   - EditListingPricingForm: al definir precio del producto/servicio.
//   - EditListingDeliveryForm: al definir costo de localDelivery.
//   - FreightQuoteForm (via inline): al cotizar un envío por flete.
//
// La fórmula es la misma que aplica el server en compras normales
// (server/api-util/xololoFees.js: 3.6% + IVA + $14 fijo + IVA) y en
// cobros de flete (server/api-util/freightFees.js) — el modelo fiscal
// es consistente. Reutilizamos computeFreightBreakdown que ya lo
// implementa.
//
// Props:
//   amountSubunits: monto en centavos (integer). Si <=0 o no numérico,
//                   no renderiza nada.
//   currency: 'MXN' por default.
//   heading: opcional, título del bloque.

const CURRENCY_LABEL = { MXN: '$', USD: 'US$' };
const money = (subunits, currency = 'MXN') => {
  const n = Number(subunits) || 0;
  const amount = (n / 100).toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${CURRENCY_LABEL[currency] || '$'}${amount} ${currency}`;
};

const XoloPayoutPreview = ({ amountSubunits, currency = 'MXN', heading }) => {
  const amount = Number(amountSubunits);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const bd = computeFreightBreakdown(Math.round(amount));
  return (
    <div className={css.root}>
      {heading ? <p className={css.heading}>{heading}</p> : null}
      <div className={css.row}>
        <span>Precio (el comprador paga)</span>
        <span>{money(bd.fleteSubunits, currency)}</span>
      </div>
      <div className={`${css.row} ${css.muted}`}>
        <span>Motor de Cobro ({bd.labels.motorCobro})</span>
        <span>−{money(bd.motorCobroSubunits + bd.ivaMotorSubunits, currency)}</span>
      </div>
      <div className={`${css.row} ${css.muted}`}>
        <span>Serv. Administrativos Xololo ({bd.labels.xololoAdmin})</span>
        <span>−{money(bd.xololoAdminSubunits + bd.ivaXololoAdminSubunits, currency)}</span>
      </div>
      {bd.retIsrSubunits > 0 ? (
        <div className={`${css.row} ${css.muted}`}>
          <span>Retención ISR ({bd.labels.retIsr})</span>
          <span>−{money(bd.retIsrSubunits, currency)}</span>
        </div>
      ) : null}
      {bd.retIvaSubunits > 0 ? (
        <div className={`${css.row} ${css.muted}`}>
          <span>Retención IVA ({bd.labels.retIva})</span>
          <span>−{money(bd.retIvaSubunits, currency)}</span>
        </div>
      ) : null}
      <div className={`${css.row} ${css.total}`}>
        <span>Recibirás</span>
        <span>{money(bd.sellerReceivesSubunits, currency)}</span>
      </div>
    </div>
  );
};

export default XoloPayoutPreview;
