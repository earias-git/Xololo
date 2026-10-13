import React, { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { Helmet } from 'react-helmet-async';

import { apiBaseUrl } from '../../util/api';
import { useMxPostalCode } from '../../util/useMxPostalCode';
import { publishableKey as stripePublishableKey } from '../../config/configStripe';
import { isScrollingDisabled } from '../../ducks/ui.duck';
import { Page, LayoutSingleColumn } from '../../components';
import TopbarContainer from '../../containers/TopbarContainer/TopbarContainer';
import FooterContainer from '../../containers/FooterContainer/FooterContainer';

import css from './CotizarEnvioPage.module.css';

// XOLOLO feature #28 · Cotizador PÚBLICO de guías de paquetería.
// Wizard de 2 pasos dentro de la misma página:
//   PASO 1 (F1) — Cotización: CP origen/destino + paquete + seguro
//                 opcional → lista de rates con precio Xololo.
//   PASO 2 (F2a) — Datos: remitente + destinatario + pickup/drop-off.
//                 Al final (F2b-d) se procesará el pago, generará la
//                 guía Skydropx y enviará los emails. En F2a sólo
//                 persistimos los datos capturados y mostramos un
//                 placeholder "próximamente" — así validamos el UX del
//                 formulario sin arriesgar pagos reales.

const INITIAL_QUOTE_FORM = {
  originCp: '',
  destCp: '',
  weight: '',
  length: '',
  width: '',
  height: '',
  declaredValue: '',
  includeInsurance: false,
};

const EMPTY_PARTY = {
  name: '',
  phone: '',
  email: '',
  street: '',
  exterior: '',
  interior: '',
  colonia: '',
  city: '',
  state: '',
  postalCode: '',
  references: '',
};

const INITIAL_PURCHASE_FORM = {
  from: { ...EMPTY_PARTY },
  to: { ...EMPTY_PARTY },
  pickupMode: 'dropoff', // 'dropoff' | 'pickup'
  contentDescription: '',
};

const formatMoney = n =>
  new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  }).format(Number(n) || 0);

// Validadores reutilizables
const isCP = s => /^\d{5}$/.test(String(s || ''));
const isPhone = s => /^\+?\d[\d\s-]{7,}$/.test(String(s || '').trim());
const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
const hasText = s => String(s || '').trim().length > 0;

// XOLOLO feature #28: subcomponente para capturar los datos de una
// parte (remitente o destinatario). Lookup del CP automático contra
// /api/postal-code:
//   - Auto-rellena city/state cuando el CP tiene 5 dígitos y hay match.
//     Respetamos lo que el user ya haya escrito (no sobrescribimos).
//   - Convierte el input de colonia en <select> con las colonias del CP
//     + opción "Otra colonia…" para los casos que SEPOMEX no cubra.
const PartyForm = ({ label, value, onFieldChange, emailRequired }) => {
  const lookup = useMxPostalCode(value.postalCode);
  const colonies = lookup.data?.colonies || [];
  const prevCpRef = useRef(null);
  const [coloniaMode, setColoniaMode] = useState('auto'); // 'auto' | 'manual'

  // Auto-rellena city/state cuando el CP acaba de completarse (nuevo
  // valor distinto al anterior). No pisa valores escritos a mano por el
  // user si el lookup trae lo mismo que ya tenían.
  useEffect(() => {
    if (lookup.status !== 'ok' || !lookup.data) return;
    const cp = lookup.data.postalCode;
    if (prevCpRef.current === cp) return;
    prevCpRef.current = cp;
    if (lookup.data.city && !value.city) onFieldChange('city', lookup.data.city);
    if (lookup.data.state && !value.state) onFieldChange('state', lookup.data.state);
    // Reset modo colonia al llegar un CP nuevo con dataset.
    setColoniaMode('auto');
    // Si ya hay una colonia escrita que no está en la lista nueva, pasa a manual.
    if (value.colonia && !(lookup.data.colonies || []).includes(value.colonia)) {
      setColoniaMode('manual');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookup.status, lookup.data?.postalCode]);

  const showColoniaDropdown = coloniaMode === 'auto' && colonies.length > 0;

  return (
    <fieldset className={css.fieldset}>
      <legend>{label}</legend>
      <div className={css.row}>
        <label className={css.field}>
          <span>Nombre completo</span>
          <input type="text" value={value.name}
            onChange={e => onFieldChange('name', e.target.value)} required />
        </label>
        <label className={css.field}>
          <span>Teléfono (10 dígitos)</span>
          <input type="tel" inputMode="tel" value={value.phone}
            onChange={e => onFieldChange('phone', e.target.value)} required />
        </label>
        <label className={css.field}>
          <span>Email {emailRequired ? '(para la guía)' : '(opcional)'}</span>
          <input type="email" value={value.email}
            onChange={e => onFieldChange('email', e.target.value)}
            required={emailRequired} />
        </label>
      </div>
      <div className={css.row}>
        <label className={css.field}>
          <span>Código postal</span>
          <input type="text" inputMode="numeric" maxLength={5} value={value.postalCode}
            onChange={e => onFieldChange('postalCode', e.target.value.replace(/\D/g, ''))}
            required />
          {lookup.status === 'loading' ? (
            <small className={css.hintMuted}>Buscando datos del CP…</small>
          ) : null}
          {lookup.status === 'error' ? (
            <small className={css.hintMuted}>
              No encontramos el CP. Llena los campos manualmente.
            </small>
          ) : null}
        </label>
        <label className={css.field} style={{ gridColumn: 'span 2' }}>
          <span>Calle</span>
          <input type="text" value={value.street}
            onChange={e => onFieldChange('street', e.target.value)} required />
        </label>
      </div>
      <div className={css.row}>
        <label className={css.field}>
          <span>No. exterior</span>
          <input type="text" value={value.exterior}
            onChange={e => onFieldChange('exterior', e.target.value)} required />
        </label>
        <label className={css.field}>
          <span>No. interior (opcional)</span>
          <input type="text" value={value.interior}
            onChange={e => onFieldChange('interior', e.target.value)} />
        </label>
        <label className={css.field} style={{ gridColumn: 'span 2' }}>
          <span>Colonia</span>
          {showColoniaDropdown ? (
            <select
              value={value.colonia}
              onChange={e => {
                if (e.target.value === '__other__') {
                  setColoniaMode('manual');
                  onFieldChange('colonia', '');
                } else {
                  onFieldChange('colonia', e.target.value);
                }
              }}
              required
            >
              <option value="">Selecciona tu colonia…</option>
              {colonies.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
              <option value="__other__">Otra colonia (escribir a mano)</option>
            </select>
          ) : (
            <input type="text" value={value.colonia}
              onChange={e => onFieldChange('colonia', e.target.value)} required />
          )}
        </label>
      </div>
      <div className={css.row}>
        <label className={css.field}>
          <span>Ciudad / Municipio</span>
          <input type="text" value={value.city}
            onChange={e => onFieldChange('city', e.target.value)} required />
        </label>
        <label className={css.field}>
          <span>Estado</span>
          <input type="text" value={value.state}
            onChange={e => onFieldChange('state', e.target.value)} required />
        </label>
      </div>
      <label className={css.field}>
        <span>Referencias (opcional)</span>
        <input type="text" placeholder="entre tal y cual calle, color fachada…"
          value={value.references}
          onChange={e => onFieldChange('references', e.target.value)} />
      </label>
    </fieldset>
  );
};

// XOLOLO feature #28 · F2b. Bloque inline de Stripe Elements para el
// pago de la guía pública. Patrón window.Stripe + stripe.elements, el
// mismo que usamos en XoloFulfillmentPanel (ver docs ahí). Scripts.js
// garantiza que js.stripe.com/v3 ya está cargado en el <head>.
const StripePaymentBlock = ({ clientSecret, amountMxn, onSucceeded, onCancel }) => {
  const [status, setStatus] = useState('mounting'); // mounting | ready | processing | error | succeeded
  const [error, setError] = useState(null);
  const stripeRef = useRef(null);
  const elementsRef = useRef(null);
  const mountRef = useRef(null);

  useEffect(() => {
    if (!clientSecret) return;
    if (!window.Stripe) {
      setError('Stripe.js aún no cargó. Recarga la página y reintenta.');
      setStatus('error');
      return;
    }
    if (!stripePublishableKey) {
      setError('Pagos no configurados. Contacta a soporte.');
      setStatus('error');
      return;
    }
    const stripe = window.Stripe(stripePublishableKey);
    stripeRef.current = stripe;
    const elements = stripe.elements({ clientSecret });
    elementsRef.current = elements;
    const paymentEl = elements.create('payment');
    paymentEl.mount(mountRef.current);
    setStatus('ready');
    return () => {
      try { paymentEl.unmount(); } catch (_e) {}
    };
  }, [clientSecret]);

  const confirm = async () => {
    if (!stripeRef.current || !elementsRef.current) return;
    setStatus('processing');
    setError(null);
    try {
      const { error: confirmError, paymentIntent } = await stripeRef.current.confirmPayment({
        elements: elementsRef.current,
        confirmParams: { return_url: window.location.href },
        redirect: 'if_required',
      });
      if (confirmError) {
        setError(confirmError.message || 'El pago no se pudo procesar.');
        setStatus('error');
        return;
      }
      if (paymentIntent && (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing')) {
        setStatus('succeeded');
        onSucceeded?.(paymentIntent);
      } else {
        setError('Pago en estado inesperado. Revisa tu correo o intenta de nuevo.');
        setStatus('error');
      }
    } catch (e) {
      setError('Error al confirmar el pago. Intenta de nuevo.');
      setStatus('error');
    }
  };

  return (
    <div className={css.stripeBlock}>
      <h3 className={css.stripeTitle}>Método de pago</h3>
      <p className={css.stripeHint}>
        Cobro seguro procesado por Stripe. Monto a pagar:{' '}
        <strong>
          {new Intl.NumberFormat('es-MX', {
            style: 'currency',
            currency: 'MXN',
          }).format(amountMxn)}
        </strong>
      </p>
      <div ref={mountRef} className={css.stripeMount} />
      {error ? <p className={css.errorInline}>{error}</p> : null}
      <div className={css.purchaseActions}>
        <button type="button" className={css.secondaryBtn} onClick={onCancel}
          disabled={status === 'processing'}>
          ← Cancelar
        </button>
        <button
          type="button"
          className={css.submitBtn}
          onClick={confirm}
          disabled={status !== 'ready' && status !== 'error'}
        >
          {status === 'processing' ? 'Procesando pago…' : 'Confirmar pago'}
        </button>
      </div>
    </div>
  );
};

const CotizarEnvioPage = () => {
  const scrollingDisabled = useSelector(isScrollingDisabled);
  const [step, setStep] = useState(1);
  const [quoteForm, setQuoteForm] = useState(INITIAL_QUOTE_FORM);
  const [quoteState, setQuoteState] = useState({ status: 'idle', data: null, error: null });
  const [selectedRateId, setSelectedRateId] = useState(null);
  const [purchaseForm, setPurchaseForm] = useState(INITIAL_PURCHASE_FORM);
  // status: idle | loading (creando PI) | paying (mostrando Stripe
  // Elements) | succeeded (pago OK, en espera de generación de guía) |
  // error
  const [purchaseState, setPurchaseState] = useState({
    status: 'idle',
    error: null,
    clientSecret: null,
    paymentIntentId: null,
  });

  const setQuoteField = (name, value) => setQuoteForm(f => ({ ...f, [name]: value }));
  const setPartyField = (side, name, value) =>
    setPurchaseForm(f => ({ ...f, [side]: { ...f[side], [name]: value } }));
  const setPurchaseField = (name, value) =>
    setPurchaseForm(f => ({ ...f, [name]: value }));

  const canSubmitQuote = () =>
    isCP(quoteForm.originCp) &&
    isCP(quoteForm.destCp) &&
    Number(quoteForm.weight) > 0 &&
    Number(quoteForm.length) > 0 &&
    Number(quoteForm.width) > 0 &&
    Number(quoteForm.height) > 0 &&
    (!quoteForm.includeInsurance || Number(quoteForm.declaredValue) > 0);

  const handleQuoteSubmit = async e => {
    e.preventDefault();
    if (!canSubmitQuote() || quoteState.status === 'loading') return;
    setQuoteState({ status: 'loading', data: null, error: null });
    try {
      const res = await fetch(`${apiBaseUrl()}/api/public-shipping-quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: { postal_code: quoteForm.originCp },
          to: { postal_code: quoteForm.destCp },
          parcel: {
            weight: Number(quoteForm.weight),
            length: Number(quoteForm.length),
            width: Number(quoteForm.width),
            height: Number(quoteForm.height),
          },
          declaredValue: quoteForm.includeInsurance ? Number(quoteForm.declaredValue) : 0,
          includeInsurance: !!quoteForm.includeInsurance,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setQuoteState({ status: 'error', data: null, error: data?.details || data?.error || 'Error' });
        return;
      }
      setQuoteState({ status: 'ok', data, error: null });
    } catch (err) {
      setQuoteState({ status: 'error', data: null, error: err?.message || 'Error de red' });
    }
  };

  const handleRateSelect = rateId => {
    setSelectedRateId(rateId);
    // Pre-rellenamos CPs y nos vamos al paso 2.
    setPurchaseForm(f => ({
      ...f,
      from: { ...f.from, postalCode: quoteForm.originCp },
      to: { ...f.to, postalCode: quoteForm.destCp },
    }));
    setStep(2);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const validateParty = (p, { emailRequired }) =>
    hasText(p.name) &&
    isPhone(p.phone) &&
    (!emailRequired || isEmail(p.email)) &&
    hasText(p.street) &&
    hasText(p.exterior) &&
    hasText(p.colonia) &&
    hasText(p.city) &&
    hasText(p.state) &&
    isCP(p.postalCode);

  // El email del remitente SIEMPRE es requerido (ahí llegan la guía y
  // el tracking); el del destinatario es opcional para F2a.
  const canSubmitPurchase = () =>
    hasText(purchaseForm.contentDescription) &&
    validateParty(purchaseForm.from, { emailRequired: true }) &&
    validateParty(purchaseForm.to, { emailRequired: false });

  const handlePurchaseSubmit = async e => {
    e.preventDefault();
    if (!canSubmitPurchase() || purchaseState.status === 'loading') return;
    setPurchaseState({
      status: 'loading',
      error: null,
      clientSecret: null,
      paymentIntentId: null,
    });
    const payload = {
      quotationId: quoteState.data?.quotationId,
      rateId: selectedRateId,
      publicTotal: selectedRate?.publicTotal,
      includeInsurance: quoteForm.includeInsurance,
      parcel: {
        weight: Number(quoteForm.weight),
        length: Number(quoteForm.length),
        width: Number(quoteForm.width),
        height: Number(quoteForm.height),
      },
      declaredValue: quoteForm.includeInsurance ? Number(quoteForm.declaredValue) : 0,
      from: purchaseForm.from,
      to: purchaseForm.to,
      pickupMode: purchaseForm.pickupMode,
      contentDescription: purchaseForm.contentDescription,
    };
    try {
      const res = await fetch(`${apiBaseUrl()}/api/public-shipping-create-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.clientSecret) {
        setPurchaseState({
          status: 'error',
          error: data?.details || data?.error || 'No pudimos iniciar el pago.',
          clientSecret: null,
          paymentIntentId: null,
        });
        return;
      }
      setPurchaseState({
        status: 'paying',
        error: null,
        clientSecret: data.clientSecret,
        paymentIntentId: data.paymentIntentId,
      });
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    } catch (err) {
      setPurchaseState({
        status: 'error',
        error: err?.message || 'Error de red al iniciar el pago.',
        clientSecret: null,
        paymentIntentId: null,
      });
    }
  };

  const [guideStatus, setGuideStatus] = useState({
    phase: 'idle', // 'idle' | 'polling' | 'ready' | 'timeout'
    labelUrl: null,
    trackingNumber: null,
    shipmentId: null,
  });

  const handlePaymentSucceeded = () => {
    setPurchaseState(s => ({ ...s, status: 'succeeded' }));
    setGuideStatus({ phase: 'polling', labelUrl: null, trackingNumber: null, shipmentId: null });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const handlePaymentCancel = () => {
    setPurchaseState({ status: 'idle', error: null, clientSecret: null, paymentIntentId: null });
  };

  // F2c: polling del status de la guía después del pago exitoso.
  // Cada 3s consulta /api/public-shipping-status hasta que status=ready
  // (hay labelUrl) o 90s (timeout). El fallback inline del endpoint
  // garantiza que la primera consulta ya dispare la generación si el
  // webhook aún no procesó.
  useEffect(() => {
    if (guideStatus.phase !== 'polling') return;
    if (!purchaseState.paymentIntentId) return;
    const piId = purchaseState.paymentIntentId;
    const started = Date.now();
    const MAX_MS = 90000;
    let aborted = false;
    let timer = null;

    const poll = async () => {
      if (aborted) return;
      try {
        const res = await fetch(
          `${apiBaseUrl()}/api/public-shipping-status?pi=${encodeURIComponent(piId)}`
        );
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.status === 'ready' && data.labelUrl) {
          setGuideStatus({
            phase: 'ready',
            labelUrl: data.labelUrl,
            trackingNumber: data.trackingNumber || null,
            shipmentId: data.shipmentId || null,
          });
          return;
        }
      } catch (_e) {
        // Silencioso: seguimos reintentando.
      }
      if (Date.now() - started > MAX_MS) {
        setGuideStatus(s => ({ ...s, phase: 'timeout' }));
        return;
      }
      timer = setTimeout(poll, 3000);
    };
    poll();

    return () => {
      aborted = true;
      if (timer) clearTimeout(timer);
    };
  }, [guideStatus.phase, purchaseState.paymentIntentId]);

  const rates = quoteState.data?.rates || [];
  const selectedRate = rates.find(r => r.id === selectedRateId) || null;

  const renderStep1 = () => (
    <>
      <form className={css.form} onSubmit={handleQuoteSubmit}>
        <div className={css.row}>
          <label className={css.field}>
            <span>Código postal de origen</span>
            <input
              type="text"
              inputMode="numeric"
              maxLength={5}
              placeholder="91000"
              value={quoteForm.originCp}
              onChange={e => setQuoteField('originCp', e.target.value.replace(/\D/g, ''))}
              required
            />
          </label>
          <label className={css.field}>
            <span>Código postal de destino</span>
            <input
              type="text"
              inputMode="numeric"
              maxLength={5}
              placeholder="01000"
              value={quoteForm.destCp}
              onChange={e => setQuoteField('destCp', e.target.value.replace(/\D/g, ''))}
              required
            />
          </label>
        </div>

        <fieldset className={css.fieldset}>
          <legend>Datos del paquete</legend>
          <div className={css.row}>
            <label className={css.field}>
              <span>Peso (kg)</span>
              <input type="number" min="0.1" step="0.1" placeholder="1.5"
                value={quoteForm.weight}
                onChange={e => setQuoteField('weight', e.target.value)} required />
            </label>
            <label className={css.field}>
              <span>Largo (cm)</span>
              <input type="number" min="1" step="1" placeholder="30"
                value={quoteForm.length}
                onChange={e => setQuoteField('length', e.target.value)} required />
            </label>
            <label className={css.field}>
              <span>Ancho (cm)</span>
              <input type="number" min="1" step="1" placeholder="20"
                value={quoteForm.width}
                onChange={e => setQuoteField('width', e.target.value)} required />
            </label>
            <label className={css.field}>
              <span>Alto (cm)</span>
              <input type="number" min="1" step="1" placeholder="15"
                value={quoteForm.height}
                onChange={e => setQuoteField('height', e.target.value)} required />
            </label>
          </div>
        </fieldset>

        <fieldset className={css.fieldset}>
          <legend>Seguro (opcional)</legend>
          <label className={css.checkboxField}>
            <input
              type="checkbox"
              checked={quoteForm.includeInsurance}
              onChange={e => setQuoteField('includeInsurance', e.target.checked)}
            />
            <span>
              Quiero asegurar el paquete contra pérdida o daño (cobertura
              hasta $100,000 MXN; el costo exacto se muestra al cotizar)
            </span>
          </label>
          {quoteForm.includeInsurance ? (
            <label className={css.field}>
              <span>Valor declarado del contenido (MXN)</span>
              <input type="number" min="1" step="1" placeholder="2500"
                value={quoteForm.declaredValue}
                onChange={e => setQuoteField('declaredValue', e.target.value)} required />
            </label>
          ) : null}
        </fieldset>

        <button
          type="submit"
          className={css.submitBtn}
          disabled={!canSubmitQuote() || quoteState.status === 'loading'}
        >
          {quoteState.status === 'loading' ? 'Cotizando…' : 'Cotizar envío'}
        </button>
      </form>

      {quoteState.status === 'loading' ? (
        <div className={css.loadingEmpathic} role="status" aria-live="polite">
          <div className={css.loadingEmoji} aria-hidden>☕</div>
          <div>
            <strong>Preparando tu cotización…</strong>
            <p>
              Estamos consultando los precios en vivo de las paqueterías.
              Esto puede tardar unos segundos — mientras, agárrate un café
              o estira las piernas. ⏱️
            </p>
          </div>
        </div>
      ) : null}

      {quoteState.status === 'error' ? (
        <div className={css.errorBox}>
          <strong>No pudimos cotizar.</strong> {quoteState.error}
        </div>
      ) : null}

      {quoteState.status === 'ok' && rates.length === 0 ? (
        <div className={css.emptyBox}>
          <p>Ninguna paquetería devolvió tarifa para estos datos. Revisa el CP o las dimensiones.</p>
        </div>
      ) : null}

      {quoteState.status === 'ok' && rates.length > 0 ? (
        <section className={css.resultsRoot}>
          <h2 className={css.resultsTitle}>Opciones disponibles</h2>
          <p className={css.resultsHint}>
            Precios incluyen todo. {quoteForm.includeInsurance ? 'Con seguro contra pérdida o daño.' : 'Sin seguro — puedes añadirlo volviendo a cotizar.'}
          </p>
          {quoteState.data?.insurance?.coverageExceeded ? (
            <p className={css.coverageWarning}>
              ⚠️ El seguro cubre hasta $100,000 MXN. Declaraste un valor
              mayor — el excedente no quedará cubierto.
            </p>
          ) : null}
          <ul className={css.rateList}>
            {rates.map(r => (
              <li key={r.id} className={css.rateCard}>
                <div className={css.rateMain}>
                  <strong className={css.rateCarrier}>{r.carrier}</strong>
                  <span className={css.rateService}>{r.service}</span>
                  {r.days ? (
                    <span className={css.rateDays}>Entrega en ~{r.days} días hábiles</span>
                  ) : null}
                </div>
                <div className={css.rateSide}>
                  <strong className={css.ratePrice}>{formatMoney(r.publicTotal)}</strong>
                  <button
                    type="button"
                    className={css.rateBuyBtn}
                    onClick={() => handleRateSelect(r.id)}
                  >
                    Comprar guía
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {/* XOLOLO: explicación por qué varían precios y tiempos entre
              servicios del mismo carrier + aviso de paqueterías que no
              respondieron para esta combinación. */}
          <aside className={css.pricingExplainer}>
            <h3>¿Por qué varían los precios?</h3>
            <p>
              Cada paquetería tiene varios servicios (Standard, Express,
              Overnight, etc.) con diferente red logística, cobertura
              geográfica, tipo de transporte (terrestre vs aéreo) y
              condiciones de garantía. Un servicio "Express" puede ser
              más caro aunque tarde parecido porque incluye recolección
              a domicilio, cobertura más amplia o compromiso de entrega
              en ventana específica.
            </p>
            <p>
              Los precios y días los proporciona cada paquetería en
              tiempo real — Xololo no los fija ni los garantiza. Verifica
              siempre condiciones del servicio antes de comprar.
            </p>
            {quoteState.data?.unavailableCount > 0 ? (
              <p className={css.unavailableNote}>
                <strong>
                  {quoteState.data.unavailableCount}{' '}
                  {quoteState.data.unavailableCount === 1 ? 'servicio' : 'servicios'} no
                  disponible{quoteState.data.unavailableCount === 1 ? '' : 's'} para esta ruta/paquete
                  {quoteState.data.unavailableCarriers?.length > 0
                    ? ` (${quoteState.data.unavailableCarriers.join(', ')})`
                    : ''}.
                </strong>{' '}
                Las paqueterías no respondieron por restricciones de peso,
                dimensiones o cobertura. Si necesitas una opción específica,
                ajusta el paquete o contáctanos.
              </p>
            ) : null}
          </aside>
        </section>
      ) : null}
    </>
  );

  const renderParty = (side, label, opts) => (
    <PartyForm
      key={side}
      label={label}
      value={purchaseForm[side]}
      onFieldChange={(k, v) => setPartyField(side, k, v)}
      emailRequired={opts.emailRequired}
    />
  );

  const renderStep2 = () => (
    <>
      <div className={css.selectedRateSummary}>
        <div>
          <small>Paqueter&iacute;a seleccionada</small>
          <strong>{selectedRate?.carrier} · {selectedRate?.service}</strong>
          {selectedRate?.days ? <span> · ~{selectedRate.days} días hábiles</span> : null}
        </div>
        <div className={css.selectedRateSide}>
          <strong>{formatMoney(selectedRate?.publicTotal)}</strong>
          <button type="button" className={css.linkBtn} onClick={() => setStep(1)}>
            Cambiar
          </button>
        </div>
      </div>

      <form className={css.form} onSubmit={handlePurchaseSubmit}>
        {renderParty('from', '¿Quién envía? (remitente)', { emailRequired: true })}
        {renderParty('to', '¿A quién le llega? (destinatario)', { emailRequired: false })}

        <fieldset className={css.fieldset}>
          <legend>Recolección del paquete</legend>
          <label className={css.radioField}>
            <input
              type="radio"
              name="pickupMode"
              value="dropoff"
              checked={purchaseForm.pickupMode === 'dropoff'}
              onChange={e => setPurchaseField('pickupMode', e.target.value)}
            />
            <span>
              <strong>Drop-off en sucursal</strong> — imprimo la guía y entrego
              el paquete en una sucursal del carrier (gratis).
            </span>
          </label>
          <label className={css.radioField}>
            <input
              type="radio"
              name="pickupMode"
              value="pickup"
              checked={purchaseForm.pickupMode === 'pickup'}
              onChange={e => setPurchaseField('pickupMode', e.target.value)}
            />
            <span>
              <strong>Pickup a domicilio</strong> — el carrier recoge en la
              dirección del remitente (puede tener costo extra según carrier).
            </span>
          </label>
        </fieldset>

        <fieldset className={css.fieldset}>
          <legend>Contenido del paquete</legend>
          <label className={css.field}>
            <span>Describe qué envías (requerido por SAT)</span>
            <input type="text" placeholder="Ropa, libros, electrónica, artesanía…"
              value={purchaseForm.contentDescription}
              onChange={e => setPurchaseField('contentDescription', e.target.value)}
              required />
          </label>
        </fieldset>

        <div className={css.purchaseActions}>
          <button
            type="button"
            className={css.secondaryBtn}
            onClick={() => setStep(1)}
            disabled={purchaseState.status === 'loading' || purchaseState.status === 'paying'}
          >
            ← Volver
          </button>
          <button
            type="submit"
            className={css.submitBtn}
            disabled={
              !canSubmitPurchase() ||
              purchaseState.status === 'loading' ||
              purchaseState.status === 'paying'
            }
          >
            {purchaseState.status === 'loading'
              ? 'Preparando pago…'
              : purchaseState.status === 'paying'
              ? 'Pago en curso…'
              : `Continuar al pago · ${formatMoney(selectedRate?.publicTotal)}`}
          </button>
        </div>
      </form>

      {purchaseState.status === 'error' && !purchaseState.clientSecret ? (
        <div className={css.errorBox}>
          <strong>No pudimos iniciar el pago.</strong> {purchaseState.error}
        </div>
      ) : null}

      {purchaseState.status === 'paying' && purchaseState.clientSecret ? (
        <StripePaymentBlock
          clientSecret={purchaseState.clientSecret}
          amountMxn={selectedRate?.publicTotal || 0}
          onSucceeded={handlePaymentSucceeded}
          onCancel={handlePaymentCancel}
        />
      ) : null}
    </>
  );

  const renderStep3 = () => (
    <div className={css.successRoot}>
      <div className={css.successEmoji} aria-hidden>🎉</div>
      <h2 className={css.successTitle}>¡Pago recibido!</h2>

      {guideStatus.phase === 'ready' ? (
        <>
          <p className={css.successText}>
            Tu guía ya está lista. Descárgala e imprímela — después
            entrégala pegada al paquete en la sucursal del carrier
            (o entrégala al mensajero si elegiste pickup a domicilio).
          </p>
          {guideStatus.trackingNumber ? (
            <p className={css.successText}>
              Número de rastreo:{' '}
              <strong><code>{guideStatus.trackingNumber}</code></strong>
            </p>
          ) : null}
          <div className={css.successCta}>
            <a
              className={css.submitBtn}
              href={guideStatus.labelUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              📄 Descargar guía PDF
            </a>
          </div>
        </>
      ) : guideStatus.phase === 'timeout' ? (
        <p className={css.successText}>
          Tu pago se recibió correctamente, pero la generación de la guía
          está tardando más de lo normal. Te la enviaremos por correo a{' '}
          <strong>{purchaseForm.from.email}</strong> en cuanto esté lista
          (con el PDF adjunto). Si no la recibes en los próximos minutos,
          escríbenos a soporte@xololo.mx con tu número de orden.
        </p>
      ) : (
        <>
          <p className={css.successText}>
            Estamos generando tu guía con la paquetería seleccionada —
            esto suele tardar menos de un minuto. La verás aquí abajo en
            cuanto esté lista, y además la mandaremos con el PDF adjunto a{' '}
            <strong>{purchaseForm.from.email}</strong>.
          </p>
          <div className={css.loadingEmpathic}>
            <div className={css.loadingEmoji} aria-hidden>📬</div>
            <div>
              <strong>Preparando tu guía…</strong>
              <p>
                Skydropx y la paquetería están emitiendo tu etiqueta. En
                un momento aparece aquí lista para descargar.
              </p>
            </div>
          </div>
        </>
      )}

      <p className={css.successFoot}>
        Guarda este número de orden por si necesitas soporte:{' '}
        <code>{purchaseState.paymentIntentId || 'pendiente'}</code>
      </p>
    </div>
  );

  return (
    <Page title="Cotizar envío — Xololo" scrollingDisabled={scrollingDisabled}>
      <Helmet>
        <meta
          name="description"
          content="Cotiza y compra guías de paquetería al mejor precio con Xololo. Estafeta, FedEx, DHL, Paquetexpress y más."
        />
      </Helmet>
      <LayoutSingleColumn topbar={<TopbarContainer />} footer={<FooterContainer />}>
        <div className={css.root}>
          {purchaseState.status !== 'succeeded' ? (
            <header className={css.header}>
              <h1 className={css.title}>
                {step === 1 ? 'Cotiza tu envío' : 'Datos del envío'}
              </h1>
              <p className={css.subtitle}>
                {step === 1
                  ? 'Compara precios entre Estafeta, FedEx, DHL, Paquetexpress y más — paga una sola guía al mejor precio. Sin registro para cotizar.'
                  : 'Completa los datos del remitente y destinatario. Al pagar, generamos tu guía y te la enviamos por email.'}
              </p>
              <ol className={css.steps} aria-label="Progreso">
                <li className={step === 1 ? css.stepActive : css.stepDone}>1. Cotización</li>
                <li
                  className={
                    step === 2
                      ? purchaseState.status === 'paying'
                        ? css.stepDone
                        : css.stepActive
                      : ''
                  }
                >
                  2. Datos
                </li>
                <li className={purchaseState.status === 'paying' ? css.stepActive : ''}>
                  3. Pago
                </li>
              </ol>
            </header>
          ) : null}

          {purchaseState.status === 'succeeded'
            ? renderStep3()
            : step === 1
            ? renderStep1()
            : renderStep2()}
        </div>
      </LayoutSingleColumn>
    </Page>
  );
};

export default CotizarEnvioPage;
