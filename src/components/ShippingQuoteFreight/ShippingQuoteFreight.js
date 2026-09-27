import React, { useState } from 'react';
import classNames from 'classnames';

import { apiBaseUrl } from '../../util/api';

import css from './ShippingQuoteFreight.module.css';

// XOLOLO Envíos v2 — Sub-commit C: panel del loop de cotización del
// método "flete", renderizado en la TransactionPage.
//
// Se muestra ÚNICAMENTE cuando la tx tiene
// protectedData.xololoShipping.mode === 'freight'. La UI depende de:
//   - role (provider | customer)
//   - estado del quote en metadata.xololoShippingQuote:
//       null            → pendiente (seller cotiza / buyer espera)
//       amountSubunits + submittedAt, sin authorizedAt → cotizado
//       + authorizedAt  → autorizado (ambas partes coordinan envío)
//
// Cobro del envío: OFFLINE en v1. La "autorización" es una confirmación
// del buyer; el pago (transferencia/WhatsApp/etc) se hace fuera. En v2
// podemos meter Stripe PaymentIntent aquí.
//
// Props:
//   transaction: la entidad denormalizada de Sharetribe
//   role: 'provider' | 'customer'
//   onUpdated(nextQuote): callback opcional para que el padre refresque

const formatMxn = (subunits, currency = 'MXN') => {
  const n = Number(subunits) || 0;
  return (n / 100).toLocaleString('es-MX', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const parseAmountToSubunits = str => {
  const clean = String(str || '').replace(/[^\d.]/g, '');
  const n = Number(clean);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
};

const ShippingQuoteFreight = ({ transaction, role, onUpdated }) => {
  const attrs = transaction?.attributes || {};
  const shipping = attrs.protectedData?.xololoShipping || {};
  const quote = attrs.metadata?.xololoShippingQuote || null;
  const txId = transaction?.id?.uuid;

  const [inputAmount, setInputAmount] = useState('');
  const [inputNotes, setInputNotes] = useState('');
  const [state, setState] = useState({ status: 'idle', error: null });

  if (shipping.mode !== 'freight') return null;

  const isSeller = role === 'provider';
  const isBuyer = role === 'customer';
  const isQuoted = !!(quote?.amountSubunits && quote.submittedAt);
  const isAuthorized = !!quote?.authorizedAt;

  const callApi = async (path, body) => {
    setState({ status: 'loading', error: null });
    try {
      const res = await fetch(`${apiBaseUrl()}${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ status: 'error', error: data.error || data.details || 'Falló la operación.' });
        return null;
      }
      setState({ status: 'ok', error: null });
      if (typeof onUpdated === 'function') onUpdated(data.quote);
      return data;
    } catch (e) {
      setState({ status: 'error', error: e?.message || 'Error de red.' });
      return null;
    }
  };

  const handleSubmitQuote = async () => {
    const subunits = parseAmountToSubunits(inputAmount);
    if (!subunits) {
      setState({ status: 'error', error: 'Ingresa un monto válido (ej. 350.00).' });
      return;
    }
    const data = await callApi('/api/xololo-shipping-quote/submit', {
      transactionId: txId,
      amountSubunits: subunits,
      notes: inputNotes,
    });
    if (data) {
      setInputAmount('');
      setInputNotes('');
    }
  };

  const handleAuthorize = async () => {
    if (!window.confirm('¿Confirmas que aceptas pagar el envío por este monto?')) return;
    await callApi('/api/xololo-shipping-quote/authorize', { transactionId: txId });
  };

  // ---------- Vistas ----------

  // Autorizado: ambos ven confirmación.
  if (isAuthorized) {
    return (
      <section className={classNames(css.root, css.rootAuthorized)}>
        <h3 className={css.title}>Envío por flete · autorizado ✓</h3>
        <p className={css.text}>
          Monto autorizado: <strong>{formatMxn(quote.amountSubunits, quote.currency)}</strong>
        </p>
        <p className={css.hint}>
          {isSeller
            ? 'Ya puedes coordinar el envío directamente con el comprador (WhatsApp, transferencia, etc). El pago del flete se maneja fuera de la plataforma; el pedido de los productos ya fue pagado.'
            : 'El vendedor coordinará contigo el envío. El pago del flete se hace directamente con él (WhatsApp, transferencia, etc), fuera de Xololo.'}
        </p>
      </section>
    );
  }

  // Cotizado, esperando autorización del buyer.
  if (isQuoted) {
    return (
      <section className={classNames(css.root, css.rootQuoted)}>
        <h3 className={css.title}>Envío por flete · cotización recibida</h3>
        <p className={css.amount}>
          Monto del envío: <strong>{formatMxn(quote.amountSubunits, quote.currency)}</strong>
        </p>
        {quote.notes ? (
          <p className={css.notes}>
            <span className={css.notesLabel}>Notas del vendedor:</span> {quote.notes}
          </p>
        ) : null}
        {isBuyer ? (
          <>
            <p className={css.hint}>
              Al autorizar, el vendedor coordinará el envío contigo. El pago
              del flete se hace por fuera (WhatsApp, transferencia, etc); tu
              pago de los productos ya fue procesado por Xololo.
            </p>
            <button
              type="button"
              className={css.primaryBtn}
              onClick={handleAuthorize}
              disabled={state.status === 'loading'}
            >
              {state.status === 'loading' ? 'Autorizando…' : 'Autorizar envío'}
            </button>
          </>
        ) : (
          <p className={css.hint}>
            Esperando autorización del comprador. Recibirás una notificación
            cuando responda.
          </p>
        )}
        {state.error ? <p className={css.error}>{state.error}</p> : null}
      </section>
    );
  }

  // Sin cotizar aún.
  if (isSeller) {
    return (
      <section className={classNames(css.root, css.rootPending)}>
        <h3 className={css.title}>Cotización de envío pendiente</h3>
        <p className={css.hint}>
          El comprador eligió pagar el envío por flete. Ingresa el monto
          que le vas a cobrar por el envío para que él lo autorice.
        </p>
        <div className={css.formRow}>
          <label className={css.label}>
            Monto del envío (MXN)
            <input
              type="text"
              inputMode="decimal"
              className={css.input}
              placeholder="Ej. 350.00"
              value={inputAmount}
              onChange={e => setInputAmount(e.target.value)}
            />
          </label>
        </div>
        <div className={css.formRow}>
          <label className={css.label}>
            Notas (opcional)
            <textarea
              className={css.textarea}
              placeholder="Ej. Envío por Estafeta express, llegada 2-3 días hábiles."
              value={inputNotes}
              onChange={e => setInputNotes(e.target.value)}
              maxLength={500}
              rows={3}
            />
          </label>
        </div>
        <button
          type="button"
          className={css.primaryBtn}
          onClick={handleSubmitQuote}
          disabled={state.status === 'loading'}
        >
          {state.status === 'loading' ? 'Enviando…' : 'Enviar cotización al comprador'}
        </button>
        {state.error ? <p className={css.error}>{state.error}</p> : null}
      </section>
    );
  }

  // Buyer, aún sin cotizar.
  return (
    <section className={classNames(css.root, css.rootPending)}>
      <h3 className={css.title}>Envío por flete · esperando cotización</h3>
      <p className={css.hint}>
        Elegiste pagar el envío por flete. El vendedor te enviará una
        cotización pronto. Recibirás una notificación cuando esté lista y
        podrás autorizarla desde aquí.
      </p>
    </section>
  );
};

export default ShippingQuoteFreight;
