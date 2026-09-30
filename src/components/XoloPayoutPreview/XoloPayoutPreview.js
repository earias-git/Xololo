import React, { useEffect, useState } from 'react';

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

// Acepta tres formas de amount para robustez frente a distintos
// callsites: (1) subunits en integer, (2) Money instance con .amount,
// (3) string numérico. FieldCurrencyInput a veces expone el value
// como Money post-blur y como string durante la edición inicial.
const resolveSubunits = raw => {
  if (raw == null) return null;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof raw === 'object' && 'amount' in raw) return Number(raw.amount);
  return null;
};

const XoloPayoutPreview = ({ amountSubunits, price, currency: currencyProp, heading }) => {
  // XOLOLO: client-only render (mounted-gate) para evitar mismatches
  // de hydration cuando values de FinalForm difieren entre server y
  // client (Money instances, initial values, etc.). El server siempre
  // renderiza null; el cliente lo agrega tras hidratación.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  // Prefer `price` (Money instance) si viene, fallback a amountSubunits.
  const raw = price != null ? price : amountSubunits;
  const amount = resolveSubunits(raw);
  if (!Number.isFinite(amount) || amount <= 0) {
    return (
      <div className={css.root}>
        {heading ? <p className={css.heading}>{heading}</p> : null}
        <div className={`${css.row} ${css.muted}`}>
          <span>Ingresa un precio para ver el desglose de fees y cuánto recibirás.</span>
        </div>
      </div>
    );
  }
  const currency =
    (typeof price === 'object' && price?.currency) || currencyProp || 'MXN';
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
