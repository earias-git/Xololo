import React, { useEffect, useState } from 'react';

import { computePayoutBreakdown, IVA_MODES, TAX_ACTIVITIES } from '../../util/xololoPayout';

import css from './XoloPayoutPreview.module.css';

// XOLOLO: preview del payout que recibe el seller al definir el precio
// de un producto o servicio. Muestra:
//   - Descomposición Subtotal + IVA (o IVA $0 con base legal si 0% o exento)
//   - + Paquetería que paga el cliente (si aplica)
//   - = Cliente paga total
//   - – Motor de cobro (3.6% + IVA)
//   - – Serv. administrativos ($14 + IVA)
//   - – Retención ISR plataforma (1.1% — placeholder hasta Facturapi)
//   - – Retención IVA plataforma (8% — placeholder, sólo si IVA 16%)
//   - MONTO A RECIBIR EN TU CUENTA
//   - Paquetería (pass-through a Skydropx, si aplica)
//   - Nota educativa sobre retenciones y acreditamiento de IVA de insumos.
//
// Se usa en:
//   - EditListingPricingForm, EditListingPricingAndStockForm: al definir precio.
//   - EditListingDeliveryForm: al definir costo de localDelivery.
//
// Props:
//   price | amountSubunits: monto en centavos. Si <=0 muestra mensaje helper.
//   currency: 'MXN' por default.
//   heading: título del bloque (default 'Cuánto recibirás por esta venta').
//   ivaMode: '16%' | '0%' | 'exento' — default '16%'.
//   ivaArticle: ej. "Art. 2-A I-b LIVA" — se muestra junto a IVA $0.00.
//   taxActivity: 'enajenacion' | 'transporte' | 'hospedaje' (LISR 113-A).
//     Determina la tasa de retención ISR (1.0% / 2.1% / 4%). Default
//     'enajenacion' que cubre al 99% de los sellers Xololo.
//   shippingSubunits: paquetería opcional pass-through.
//   applyWithholdings: default false (Xololo aún no es plataforma SAT).
//   sellerIsPhysicalPerson: default true.

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

const XoloPayoutPreview = ({
  amountSubunits,
  price,
  currency: currencyProp,
  heading = 'Cuánto recibirás por esta venta',
  ivaMode = IVA_MODES.GRAVADO,
  ivaArticle,
  taxActivity = TAX_ACTIVITIES.ENAJENACION_SERVICIOS,
  shippingSubunits = 0,
  applyWithholdings = false,
  sellerIsPhysicalPerson = true,
}) => {
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

  const bd = computePayoutBreakdown({
    priceSubunits: Math.round(amount),
    ivaMode,
    taxActivity,
    shippingSubunits,
    applyWithholdings,
    sellerIsPhysicalPerson,
  });

  const isGravado = ivaMode === IVA_MODES.GRAVADO;
  const isExento = ivaMode === IVA_MODES.EXENTO;
  const isTasaCero = ivaMode === IVA_MODES.TASA_CERO;
  const hasShipping = bd.shippingSubunits > 0;
  const defaultArticle = isGravado ? 'Art. 1 LIVA' : isTasaCero ? 'Art. 2-A LIVA' : 'Art. 9 LIVA';
  const ivaArticleLabel = ivaArticle || defaultArticle;

  return (
    <div className={css.root}>
      {heading ? <p className={css.heading}>{heading}</p> : null}

      {/* Descomposición: Subtotal + IVA */}
      <div className={`${css.row} ${css.muted}`}>
        <span>Subtotal (sin IVA)</span>
        <span>{money(bd.subtotalSubunits, currency)}</span>
      </div>
      <div className={`${css.row} ${css.muted}`}>
        <span>
          IVA {bd.labels.iva} <span className={css.article}>({ivaArticleLabel})</span>
        </span>
        <span>{money(bd.ivaSubunits, currency)}</span>
      </div>

      <div className={`${css.row} ${css.subtotal}`}>
        <span>Precio total del producto</span>
        <span>{money(bd.priceSubunits, currency)}</span>
      </div>

      {/* Paquetería (si aplica) */}
      {hasShipping ? (
        <>
          <div className={`${css.row} ${css.muted}`}>
            <span>+ Paquetería que paga el cliente</span>
            <span>{money(bd.shippingSubunits, currency)}</span>
          </div>
          <div className={`${css.row} ${css.subtotal}`}>
            <span>Cliente paga total</span>
            <span>{money(bd.clientPaysSubunits, currency)}</span>
          </div>
        </>
      ) : null}

      {/* Fees Xololo */}
      <div className={`${css.row} ${css.muted}`}>
        <span>− Motor de cobro ({bd.labels.motorCobro})</span>
        <span>−{money(bd.motorCobroSubunits, currency)}</span>
      </div>
      <div className={`${css.row} ${css.muted}`}>
        <span>− Serv. administrativos Xololo ({bd.labels.xololoAdmin})</span>
        <span>−{money(bd.xololoAdminSubunits, currency)}</span>
      </div>

      {/* Retenciones — placeholder hasta Facturapi + SAT. Siempre mostramos
          la línea con base legal para que el seller aprenda el modelo. La
          tasa ISR depende de la actividad fiscal del listing. */}
      <div className={`${css.row} ${css.muted}`}>
        <span>
          − Retención ISR plataforma ({bd.labels.retIsr}){' '}
          <span className={css.article}>
            (LISR 113-A ·{' '}
            {taxActivity === TAX_ACTIVITIES.HOSPEDAJE
              ? 'hospedaje'
              : taxActivity === TAX_ACTIVITIES.TRANSPORTE_ENTREGA
                ? 'transporte y entrega'
                : 'enajenación y servicios'}
            )
          </span>
        </span>
        <span>−{money(bd.retIsrSubunits, currency)}</span>
      </div>
      <div className={`${css.row} ${css.muted}`}>
        <span>
          − Retención IVA plataforma {isGravado ? `(${bd.labels.retIva})` : ''}{' '}
          <span className={css.article}>
            {isGravado ? '(LIVA 18-J)' : `(no causa IVA · ${ivaArticleLabel})`}
          </span>
        </span>
        <span>−{money(bd.retIvaSubunits, currency)}</span>
      </div>

      <div className={`${css.row} ${css.total}`}>
        <span>Monto a recibir en tu cuenta</span>
        <span>{money(bd.sellerReceivesSubunits, currency)}</span>
      </div>

      {/* Paquetería pass-through: nota al final para que el seller entienda
          que ese dinero NO entra a su cálculo — va directo a Skydropx. */}
      {hasShipping ? (
        <div className={`${css.row} ${css.passthrough}`}>
          <span>Paquetería (pass-through a Skydropx)</span>
          <span>{money(bd.shippingSubunits, currency)}</span>
        </div>
      ) : null}

      {/* Nota educativa */}
      <p className={css.footnote}>
        {bd.appliedWithholdings
          ? 'Las retenciones no son un gasto: son un pago adelantado de tu ISR/IVA que puedes acreditar al presentar tus declaraciones mensuales ante el SAT.'
          : 'Hoy no aplicamos retenciones de plataforma. Cuando Xololo quede inscrita como plataforma tecnológica ante el SAT, estas líneas tomarán valor y serán acreditables en tu declaración mensual.'}
        {isExento ? (
          <>
            {' '}
            <strong>Producto exento ({ivaArticleLabel}):</strong> no causas IVA al
            cliente, pero tampoco puedes acreditar el IVA que pagaste por tus
            insumos relacionados.
          </>
        ) : null}
        {isTasaCero ? (
          <>
            {' '}
            <strong>Producto a tasa 0% ({ivaArticleLabel}):</strong> no cobras
            IVA al cliente, pero sí puedes acreditar el IVA que pagaste por tus
            insumos en tu declaración mensual.
          </>
        ) : null}
      </p>
    </div>
  );
};

export default XoloPayoutPreview;
