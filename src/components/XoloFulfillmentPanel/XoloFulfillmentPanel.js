import React, { useState, useRef, useEffect } from 'react';

import {
  verifyDeliveryCode,
  txMarkReady,
  txMarkDispatched,
  freightQuote,
  freightCreatePaymentIntent,
} from '../../util/api';
import { publishableKey as stripePublishableKey } from '../../config/configStripe';

import css from './XoloFulfillmentPanel.module.css';

// XOLOLO Envíos v2 · panel de fulfillment ramificado por
// (xoloShipping.mode, xoloShipping.stage, role). Consume el shape
// `stateData.xoloShipping` que produce TransactionPage.stateDataPurchase.
// Sólo se renderiza cuando processState === 'purchased' y mode != 'none'.
//
// Se compone de sub-componentes por (mode, stage, role):
//   Seller (provider):
//     - MarkReadyButton         (pickup / localDelivery / freight sin readyAt)
//     - MarkDispatchedButton    (localDelivery ready, o freight authorized)
//     - DeliveryCodeInput       (awaiting_code: pickup / localDelivery / freight)
//     - FreightQuoteForm        (freight, quoting)
//     - FreightWaitingBanner    (freight, quoted → buyer autoriza)
//     - Carrier: se delega al OrderFulfillmentPanel existente
//       (no re-implementamos label pipeline; ver renderCarrierSellerHint).
//   Buyer (customer):
//     - StagePreparing / StageReady   (info-only)
//     - DeliveryCodeCard              (awaiting_code: pickup/localDelivery/freight)
//     - FreightWaitingQuote           (freight, quoting: seller cotizando)
//     - FreightAuthorizePayment       (freight, quoted: pagar el envío)
//     - CarrierTrackingCard           (carrier: tracking en vivo)
//
// Errores: los sub-componentes muestran un mensaje inline y dejan el
// botón activable para reintentar. No hay retry automático (el usuario
// decide).

const CURRENCY_LABEL = { MXN: '$', USD: 'US$' };
const money = (subunits, currency = 'MXN') => {
  if (subunits == null) return '';
  const amount = (Number(subunits) / 100).toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${CURRENCY_LABEL[currency] || '$'}${amount} ${currency}`;
};

// ────────────────────────────────────────────────────────────────
// Botones ligeros (mark-ready, mark-dispatched)
// ────────────────────────────────────────────────────────────────
const ActionButton = ({ label, onClick, inProgress, disabled, secondary }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled || inProgress}
    className={secondary ? css.buttonSecondary : css.button}
  >
    {inProgress ? 'Procesando…' : label}
  </button>
);

const MarkReadyButton = ({ transactionId, onDone }) => {
  const [inProgress, setInProgress] = useState(false);
  const [error, setError] = useState(null);
  const handle = async () => {
    setInProgress(true);
    setError(null);
    try {
      await txMarkReady({ transactionId });
      onDone && onDone();
    } catch (e) {
      setError('No pudimos marcar como listo. Intenta de nuevo.');
    } finally {
      setInProgress(false);
    }
  };
  return (
    <>
      <ActionButton label="Marcar producto como listo" onClick={handle} inProgress={inProgress} />
      {error ? <div className={css.error}>{error}</div> : null}
    </>
  );
};

const MarkDispatchedButton = ({ transactionId, label, onDone }) => {
  const [inProgress, setInProgress] = useState(false);
  const [error, setError] = useState(null);
  const handle = async () => {
    setInProgress(true);
    setError(null);
    try {
      await txMarkDispatched({ transactionId });
      onDone && onDone();
    } catch (e) {
      const errKey = e?.data?.error || e?.message;
      const map = {
        not_applicable_mode: 'Este pedido no aplica para "despachado" (revisa el método de envío).',
        already_set: 'Ya lo habías marcado antes. Recarga la página.',
        not_authorized_yet:
          'El comprador aún no autoriza el pago del envío. Espera unos segundos y recarga.',
        unauthorized: 'Sesión expirada. Recarga la página.',
        invalid_request: 'Falta información. Recarga la página.',
        internal: 'Error del servidor. Reintenta en unos segundos.',
      };
      setError(map[errKey] || `No pudimos marcar como despachado (${errKey || 'error'}).`);
      // eslint-disable-next-line no-console
      console.error('[markDispatched] error:', e?.data || e);
    } finally {
      setInProgress(false);
    }
  };
  return (
    <>
      <ActionButton label={label} onClick={handle} inProgress={inProgress} />
      {error ? <div className={css.error}>{error}</div> : null}
    </>
  );
};

// ────────────────────────────────────────────────────────────────
// DeliveryCodeCard (buyer): muestra los 6 dígitos con botón copiar.
// ────────────────────────────────────────────────────────────────
const DeliveryCodeCard = ({ code, mode }) => {
  const [copied, setCopied] = useState(false);
  const help = {
    pickup:
      'Muestra este código al vendedor cuando llegues a recoger tu pedido. Con el código correcto la orden queda marcada como entregada automáticamente.',
    localDelivery:
      'Muestra este código al vendedor o chofer cuando te entregue el pedido. Con el código correcto la orden queda marcada como entregada automáticamente.',
    freight:
      'Muestra este código al chofer que te entregue el pedido. Con el código correcto la orden queda marcada como entregada automáticamente.',
  };
  const doCopy = () => {
    try {
      navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      /* no-op */
    }
  };
  return (
    <div className={css.codeCard}>
      <p className={css.codeLabel}>Tu código de entrega</p>
      <p className={css.codeDigits}>{code}</p>
      <button type="button" onClick={doCopy} className={css.copyBtn}>
        {copied ? '✓ Copiado' : 'Copiar código'}
      </button>
      <p className={css.codeHelp}>{help[mode] || help.pickup}</p>
    </div>
  );
};

// ────────────────────────────────────────────────────────────────
// DeliveryCodeInput (seller): form de 6 casillas + verify.
// ────────────────────────────────────────────────────────────────
const DeliveryCodeInput = ({ transactionId, onVerified }) => {
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [inProgress, setInProgress] = useState(false);
  const [error, setError] = useState(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState(null);
  const refs = [useRef(), useRef(), useRef(), useRef(), useRef(), useRef()];

  const setDigit = (i, value) => {
    const clean = String(value).replace(/\D/g, '').slice(0, 1);
    const next = digits.slice();
    next[i] = clean;
    setDigits(next);
    // Auto-advance to next input.
    if (clean && i < 5) refs[i + 1].current?.focus();
  };

  const onKeyDown = (i, e) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      refs[i - 1].current?.focus();
    }
  };

  const onPaste = e => {
    const pasted = String(e.clipboardData.getData('text') || '')
      .replace(/\D/g, '')
      .slice(0, 6);
    if (pasted.length === 6) {
      e.preventDefault();
      setDigits(pasted.split(''));
      refs[5].current?.focus();
    }
  };

  const submit = async () => {
    const code = digits.join('');
    if (code.length !== 6) {
      setError('Ingresa los 6 dígitos.');
      return;
    }
    setInProgress(true);
    setError(null);
    try {
      await verifyDeliveryCode({ transactionId, code });
      onVerified && onVerified();
    } catch (e) {
      // El wrapper post() debería rechazar con el body — normalizamos.
      const body = e?.data || e?.body || {};
      const err = body.error;
      if (err === 'wrong_code') {
        setAttemptsRemaining(body.attemptsRemaining);
        setError(
          body.blocked
            ? 'Código bloqueado tras 3 intentos. Contacta a Xololo.'
            : `Código incorrecto. Te quedan ${body.attemptsRemaining} intentos.`
        );
        setDigits(['', '', '', '', '', '']);
        refs[0].current?.focus();
      } else if (err === 'already_verified') {
        setError('Este código ya fue verificado.');
        onVerified && onVerified();
      } else if (err === 'code_blocked') {
        setError('Código bloqueado. Contacta a Xololo para desbloquear.');
      } else if (err === 'no_delivery_code') {
        setError('Esta orden no tiene código de entrega asignado.');
      } else if (err === 'unauthorized') {
        setError('Sesión expirada. Recarga la página.');
      } else {
        setError('No pudimos verificar el código. Intenta de nuevo.');
      }
    } finally {
      setInProgress(false);
    }
  };

  useEffect(() => {
    refs[0].current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <p className={css.subtitle}>
        Pídele al comprador que te muestre su código de 6 dígitos y captúralo aquí. Al confirmarlo,
        la orden queda marcada como entregada.
      </p>
      <div className={css.codeInputRow}>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={refs[i]}
            className={css.codeInputBox}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={1}
            value={d}
            onChange={e => setDigit(i, e.target.value)}
            onKeyDown={e => onKeyDown(i, e)}
            onPaste={i === 0 ? onPaste : undefined}
            disabled={inProgress}
          />
        ))}
      </div>
      <ActionButton
        label="Verificar código"
        onClick={submit}
        inProgress={inProgress}
        disabled={digits.join('').length !== 6}
      />
      {error ? <div className={css.error}>{error}</div> : null}
      {attemptsRemaining === 0 ? (
        <div className={css.error}>
          Código bloqueado. Contacta a Xololo (soporte) para desbloquear la entrega.
        </div>
      ) : null}
    </>
  );
};

// ────────────────────────────────────────────────────────────────
// FreightQuoteForm (seller): input monto + descripción + carrier.
// ────────────────────────────────────────────────────────────────
const FreightQuoteForm = ({ transactionId, initialAmount, initialDescription, initialCarrier, onQuoted }) => {
  const [amountMxn, setAmountMxn] = useState(initialAmount ? String(initialAmount / 100) : '');
  const [description, setDescription] = useState(initialDescription || '');
  const [carrier, setCarrier] = useState(initialCarrier || '');
  const [inProgress, setInProgress] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    setError(null);
    const parsedMxn = Number(amountMxn);
    if (!Number.isFinite(parsedMxn) || parsedMxn <= 0) {
      setError('Ingresa un monto en pesos mayor a 0.');
      return;
    }
    if (!description.trim()) {
      setError('Describe brevemente el envío (paquetería, plazo, etc.).');
      return;
    }
    setInProgress(true);
    try {
      const amountSubunits = Math.round(parsedMxn * 100);
      await freightQuote({
        transactionId,
        amountSubunits,
        description: description.trim(),
        carrierName: carrier.trim() || undefined,
      });
      onQuoted && onQuoted();
    } catch (e) {
      const err = e?.data?.error || e?.body?.error;
      if (err === 'already_authorized') {
        setError('El comprador ya autorizó una cotización anterior — no se puede modificar.');
      } else {
        setError('No pudimos guardar la cotización. Intenta de nuevo.');
      }
    } finally {
      setInProgress(false);
    }
  };

  return (
    <>
      <p className={css.subtitle}>
        Cotiza el envío de esta orden. El comprador verá el monto y podrá autorizarlo y pagarlo
        para que puedas despachar.
      </p>
      <div className={css.freightRow}>
        <div>
          <p className={css.freightLabel}>Monto del envío (MXN)</p>
          <input
            className={css.freightInput}
            type="number"
            min="0"
            step="0.01"
            placeholder="Ej. 350.00"
            value={amountMxn}
            onChange={e => setAmountMxn(e.target.value)}
            disabled={inProgress}
          />
        </div>
        <div>
          <p className={css.freightLabel}>Detalle para el comprador</p>
          <textarea
            className={css.freightInput}
            rows={3}
            placeholder="Ej. Envío por flete Estafeta, entrega 3-5 días hábiles."
            value={description}
            onChange={e => setDescription(e.target.value)}
            disabled={inProgress}
          />
        </div>
        <div>
          <p className={css.freightLabel}>Paquetería / carrier (opcional)</p>
          <input
            className={css.freightInput}
            type="text"
            placeholder="Ej. Estafeta Terrestre"
            value={carrier}
            onChange={e => setCarrier(e.target.value)}
            disabled={inProgress}
          />
        </div>
      </div>
      <ActionButton label="Enviar cotización al comprador" onClick={submit} inProgress={inProgress} />
      {error ? <div className={css.error}>{error}</div> : null}
    </>
  );
};

// ────────────────────────────────────────────────────────────────
// FreightAuthorizePayment (buyer): pagar el envío cotizado con Stripe.
// Usa window.Stripe (mismo patrón que StripePaymentForm) — no requiere
// @stripe/react-stripe-js. Renderiza un PaymentElement inline con el
// clientSecret que devuelve /api/freight/create-payment-intent.
// ────────────────────────────────────────────────────────────────
const FreightAuthorizePayment = ({
  transactionId,
  quotedAmount,
  quotedCurrency,
  quoteDescription,
  quoteCarrierName,
}) => {
  const [inProgress, setInProgress] = useState(false);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const stripeRef = useRef(null);
  const elementsRef = useRef(null);
  const clientSecretRef = useRef(null);
  const mountRef = useRef(null);

  // Paso 1: crear PI + montar Elements al hacer click en "Autorizar y
  // pagar". No lo hacemos al montar para evitar crear PIs a buyers
  // que nunca lleguen a este punto.
  const beginAuthorization = async () => {
    setInProgress(true);
    setError(null);
    try {
      if (!window.Stripe) {
        setError('Stripe.js aún no cargó. Espera unos segundos y reintenta.');
        return;
      }
      if (!stripePublishableKey) {
        setError('Configuración de pagos no disponible. Contacta a Xololo.');
        return;
      }
      const resp = await freightCreatePaymentIntent({ transactionId });
      if (!resp?.clientSecret) {
        setError('El servidor no devolvió el token de pago. Recarga y reintenta.');
        return;
      }
      clientSecretRef.current = resp.clientSecret;
      const stripe = window.Stripe(stripePublishableKey);
      stripeRef.current = stripe;
      const elements = stripe.elements({ clientSecret: resp.clientSecret });
      elementsRef.current = elements;
      const paymentElement = elements.create('payment');
      setReady(true);
      setTimeout(() => paymentElement.mount(mountRef.current), 0);
    } catch (e) {
      // Mapeo de errores del server. Preservamos el detalle para que
      // sepamos qué falló en vez de "no pudimos iniciar el pago" genérico.
      const errKey = e?.data?.error || e?.message;
      const map = {
        invalid_request: 'Falta información en la solicitud (recarga la página).',
        unauthorized: 'Sesión expirada. Recarga la página e inicia sesión.',
        transaction_not_found: 'No encontramos esta orden. Recarga la página.',
        not_freight_mode: 'Esta orden no es de envío por flete.',
        not_quoted_yet: 'El vendedor aún no envía cotización. Espera unos minutos.',
        already_authorized: 'Ya autorizaste este pago. Recarga la página para verlo.',
        stripe_missing: 'Pagos no configurados en el servidor. Contacta a Xololo.',
        internal: 'Error interno del servidor. Reintenta en unos segundos.',
      };
      setError(map[errKey] || `No pudimos iniciar el pago (${errKey || 'error'}).`);
      // eslint-disable-next-line no-console
      console.error('[freight authorize] error:', e?.data || e);
    } finally {
      setInProgress(false);
    }
  };

  const confirmPayment = async () => {
    if (!stripeRef.current || !elementsRef.current) return;
    setInProgress(true);
    setError(null);
    try {
      const { error: confirmError, paymentIntent } = await stripeRef.current.confirmPayment({
        elements: elementsRef.current,
        confirmParams: {
          return_url: window.location.href,
        },
        redirect: 'if_required',
      });
      if (confirmError) {
        setError(confirmError.message || 'El pago no se pudo procesar.');
      } else if (paymentIntent && paymentIntent.status === 'succeeded') {
        setSucceeded(true);
      } else {
        // Estados intermedios (processing, requires_action que redirigió, etc.)
        setSucceeded(true);
      }
    } catch (e) {
      setError('Error al confirmar el pago. Intenta de nuevo.');
    } finally {
      setInProgress(false);
    }
  };

  if (succeeded) {
    return (
      <div className={css.success}>
        ¡Pago recibido! El vendedor ya puede despachar tu pedido. La página se actualizará en unos
        segundos.
      </div>
    );
  }

  return (
    <>
      <div className={css.freightQuoted}>
        <p className={css.freightQuotedAmount}>{money(quotedAmount, quotedCurrency || 'MXN')}</p>
        <p className={css.freightQuotedDesc}>{quoteDescription}</p>
        {quoteCarrierName ? (
          <p className={css.freightQuotedDesc}>Paquetería: {quoteCarrierName}</p>
        ) : null}
      </div>
      {!ready ? (
        <>
          <ActionButton
            label={`Autorizar y pagar ${money(quotedAmount, quotedCurrency || 'MXN')}`}
            onClick={beginAuthorization}
            inProgress={inProgress}
          />
          {error ? <div className={css.error}>{error}</div> : null}
        </>
      ) : (
        <>
          <div ref={mountRef} style={{ marginBottom: 12 }} />
          <ActionButton label="Confirmar pago" onClick={confirmPayment} inProgress={inProgress} />
          {error ? <div className={css.error}>{error}</div> : null}
        </>
      )}
    </>
  );
};

// ────────────────────────────────────────────────────────────────
// Wrapper principal — ramifica por (mode, stage, role)
// ────────────────────────────────────────────────────────────────
const XoloFulfillmentPanel = ({ stateData, transaction, transactionRole, onRefresh }) => {
  const xs = stateData?.xoloShipping;
  if (!xs || xs.mode === 'none') return null;
  if (stateData.processState !== 'purchased') return null;

  const transactionId = transaction?.id?.uuid;
  if (!transactionId) return null;

  const { mode, stage, flags, deliveryCode, quotePending } = xs;
  const isCustomer = transactionRole === 'customer';
  const isProvider = transactionRole === 'provider';

  // ── Vista del BUYER ──────────────────────────────────────────
  if (isCustomer) {
    // Freight — casos especiales antes del awaiting_code.
    // Orden lógico: cotizando → cotizado (autoriza y paga) →
    // pagado/preparando → listo → en camino → código.
    if (mode === 'freight') {
      if (stage === 'quoting' || quotePending) {
        return (
          <div className={css.root}>
            <h3 className={css.title}>Cotizando envío</h3>
            <div className={css.stageInfo}>
              El vendedor está cotizando el envío de tu pedido. Te llegará una notificación en
              cuanto tenga el monto.
            </div>
          </div>
        );
      }
      if (stage === 'quoted') {
        return (
          <div className={css.root}>
            <h3 className={css.title}>Envío cotizado — Autoriza el pago</h3>
            <FreightAuthorizePayment
              transactionId={transactionId}
              quotedAmount={flags.quotedAmount}
              quotedCurrency={flags.quotedCurrency}
              quoteDescription={flags.quoteDescription}
              quoteCarrierName={flags.quoteCarrierName}
            />
          </div>
        );
      }
      // Post-autorización: buyer pagó, seller está preparando.
      // 'preparing' aparece cuando el seller aún no marcó ready.
      if (stage === 'preparing') {
        return (
          <div className={css.root}>
            <h3 className={css.title}>Vendedor preparando tu pedido</h3>
            <div className={css.stageInfo}>
              Pagaste el envío. El vendedor está preparando tu pedido. Recibirás un aviso cuando
              esté listo para su envío.
            </div>
          </div>
        );
      }
      if (stage === 'ready') {
        return (
          <div className={css.root}>
            <h3 className={css.title}>Pedido listo</h3>
            <div className={css.stageInfo}>
              Tu pedido está listo. El vendedor lo despachará y te contactará para coordinar la
              entrega.
            </div>
          </div>
        );
      }
      // Freight con dispatched: chofer/paquetería en camino, buyer
      // necesita ver su código para dárselo al chofer al llegar.
      if (stage === 'awaiting_code' && deliveryCode) {
        return (
          <div className={css.root}>
            <h3 className={css.title}>En camino — Muéstrale tu código al chofer</h3>
            <DeliveryCodeCard code={deliveryCode} mode="freight" />
          </div>
        );
      }
    }

    // Carrier — mostrar tracking si lo hay
    if (mode === 'carrier') {
      if (!flags.trackingNumber) {
        return (
          <div className={css.root}>
            <h3 className={css.title}>Vendedor preparando el envío</h3>
            <div className={css.stageInfo}>
              El vendedor está generando la guía de envío con la paquetería.
            </div>
          </div>
        );
      }
      return (
        <div className={css.root}>
          <h3 className={css.title}>Envío en curso</h3>
          <div className={css.stageInfo}>
            <span className={css.stageInfoTitle}>
              {flags.carrierName || 'Paquetería'} · {flags.trackingNumber}
            </span>
            {flags.currentStatus ? <>Estado: {flags.currentStatus}</> : 'Preparando envío'}
            {flags.trackingUrl ? (
              <>
                <br />
                <a
                  href={flags.trackingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={css.trackingLink}
                >
                  Rastrear paquete →
                </a>
              </>
            ) : null}
          </div>
        </div>
      );
    }

    // pickup / localDelivery — flujos con código
    if (mode === 'pickup' || mode === 'localDelivery') {
      if (stage === 'preparing') {
        return (
          <div className={css.root}>
            <h3 className={css.title}>Vendedor preparando tu pedido</h3>
            <div className={css.stageInfo}>
              El vendedor está preparando tu pedido. Recibirás un aviso cuando esté listo.
            </div>
          </div>
        );
      }
      if (stage === 'ready' && mode === 'localDelivery') {
        return (
          <div className={css.root}>
            <h3 className={css.title}>Pedido listo</h3>
            <div className={css.stageInfo}>
              Tu pedido está listo. El vendedor te contactará para coordinar la entrega.
            </div>
          </div>
        );
      }
      if (stage === 'awaiting_code' && deliveryCode) {
        return (
          <div className={css.root}>
            <h3 className={css.title}>
              {mode === 'pickup' ? 'Listo para recolectar' : 'En camino'}
            </h3>
            <DeliveryCodeCard code={deliveryCode} mode={mode} />
          </div>
        );
      }
    }

    return null;
  }

  // ── Vista del SELLER ─────────────────────────────────────────
  if (isProvider) {
    // Carrier: delegamos al OrderFulfillmentPanel existente (fuera de
    // este archivo). Aquí no renderizamos nada para no duplicar UI.
    if (mode === 'carrier') return null;

    if (mode === 'pickup' || mode === 'localDelivery' || mode === 'freight') {
      // Freight tiene su propio orden: cotizar → esperar autorización →
      // preparar → marcar listo → despachar → código. El seller nunca
      // debe preparar antes de que el buyer autorice el pago del envío.
      if (mode === 'freight' && stage === 'quoting') {
        return (
          <div className={css.root}>
            <h3 className={css.title}>Cotiza el envío</h3>
            <p className={css.subtitle}>
              El comprador ya pagó el producto. Antes de preparar el pedido, envíale la cotización
              del envío por flete. Se le cobrará este monto por Stripe y podrás empezar a preparar
              cuando lo autorice.
            </p>
            <FreightQuoteForm transactionId={transactionId} onQuoted={onRefresh} />
          </div>
        );
      }
      if (mode === 'freight' && stage === 'quoted') {
        return (
          <div className={css.root}>
            <h3 className={css.title}>Cotización enviada — Esperando autorización</h3>
            <div className={css.freightQuoted}>
              <p className={css.freightQuotedAmount}>
                {money(flags.quotedAmount, flags.quotedCurrency || 'MXN')}
              </p>
              <p className={css.freightQuotedDesc}>{flags.quoteDescription}</p>
              {flags.quoteCarrierName ? (
                <p className={css.freightQuotedDesc}>Paquetería: {flags.quoteCarrierName}</p>
              ) : null}
            </div>
            <p className={css.subtitle}>
              El comprador debe autorizar y pagar el envío antes de que puedas preparar el pedido.
              Puedes editar la cotización mientras no autorice.
            </p>
            <FreightQuoteForm
              transactionId={transactionId}
              initialAmount={flags.quotedAmount}
              initialDescription={flags.quoteDescription}
              initialCarrier={flags.quoteCarrierName}
              onQuoted={onRefresh}
            />
          </div>
        );
      }

      // Pickup y localDelivery arrancan directo en preparing (sin cotizar).
      // Freight en preparing sólo ocurre DESPUÉS de que el buyer autorizó
      // el pago — la máquina de estados de computeStage lo garantiza.
      if (stage === 'preparing') {
        return (
          <div className={css.root}>
            <h3 className={css.title}>Prepara el pedido</h3>
            <p className={css.subtitle}>
              {mode === 'freight'
                ? 'El comprador ya pagó el envío. Prepara el producto y márcalo listo para despacharlo.'
                : 'Cuando tengas el producto listo, marca esta orden para que el comprador vea el siguiente paso.'}
            </p>
            <MarkReadyButton transactionId={transactionId} onDone={onRefresh} />
          </div>
        );
      }
      if (mode === 'localDelivery' && stage === 'ready') {
        return (
          <div className={css.root}>
            <h3 className={css.title}>Listo — Salir a entregar</h3>
            <p className={css.subtitle}>
              Marca cuando estés en camino al domicilio del comprador. Al llegar, pídele su código
              de 6 dígitos para confirmar la entrega.
            </p>
            <MarkDispatchedButton
              transactionId={transactionId}
              label="Salgo a entregar"
              onDone={onRefresh}
            />
          </div>
        );
      }
      if (mode === 'freight' && stage === 'ready') {
        return (
          <div className={css.root}>
            <h3 className={css.title}>Producto listo — Marcar despachado</h3>
            <p className={css.subtitle}>
              Cuando el chofer/paquetería recoja el paquete, marca como despachado. Al entregar,
              pide al comprador su código de 6 dígitos.
            </p>
            <MarkDispatchedButton
              transactionId={transactionId}
              label="Marcar como despachado"
              onDone={onRefresh}
            />
          </div>
        );
      }
      if (stage === 'awaiting_code') {
        return (
          <div className={css.root}>
            <h3 className={css.title}>Confirmar entrega con código</h3>
            <DeliveryCodeInput transactionId={transactionId} onVerified={onRefresh} />
          </div>
        );
      }
    }
    return null;
  }

  return null;
};

export default XoloFulfillmentPanel;
