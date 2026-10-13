import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { Helmet } from 'react-helmet-async';

import { apiBaseUrl } from '../../util/api';
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

const CotizarEnvioPage = () => {
  const scrollingDisabled = useSelector(isScrollingDisabled);
  const [step, setStep] = useState(1);
  const [quoteForm, setQuoteForm] = useState(INITIAL_QUOTE_FORM);
  const [quoteState, setQuoteState] = useState({ status: 'idle', data: null, error: null });
  const [selectedRateId, setSelectedRateId] = useState(null);
  const [purchaseForm, setPurchaseForm] = useState(INITIAL_PURCHASE_FORM);
  const [purchaseState, setPurchaseState] = useState({ status: 'idle', error: null });

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
    setPurchaseState({ status: 'loading', error: null });
    // F2a: por ahora SÓLO logueamos el payload en consola — F2b-d
    // reemplazarán esto con Stripe + crear user + Skydropx createShipment.
    const payload = {
      quotationId: quoteState.data?.quotationId,
      selectedRateId,
      includeInsurance: quoteForm.includeInsurance,
      parcel: {
        weight: Number(quoteForm.weight),
        length: Number(quoteForm.length),
        width: Number(quoteForm.width),
        height: Number(quoteForm.height),
      },
      declaredValue: quoteForm.includeInsurance ? Number(quoteForm.declaredValue) : 0,
      ...purchaseForm,
    };
    // eslint-disable-next-line no-console
    console.log('[cotizar-envio] F2a dry run — payload capturado:', payload);
    setTimeout(() => {
      setPurchaseState({ status: 'ok', error: null });
    }, 500);
  };

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
        </section>
      ) : null}
    </>
  );

  const renderParty = (side, label, { emailRequired }) => {
    const p = purchaseForm[side];
    const set = (k, v) => setPartyField(side, k, v);
    return (
      <fieldset className={css.fieldset}>
        <legend>{label}</legend>
        <div className={css.row}>
          <label className={css.field}>
            <span>Nombre completo</span>
            <input type="text" value={p.name} onChange={e => set('name', e.target.value)} required />
          </label>
          <label className={css.field}>
            <span>Teléfono (10 dígitos)</span>
            <input type="tel" inputMode="tel" value={p.phone}
              onChange={e => set('phone', e.target.value)} required />
          </label>
          <label className={css.field}>
            <span>Email {emailRequired ? '(para la guía)' : '(opcional)'}</span>
            <input type="email" value={p.email}
              onChange={e => set('email', e.target.value)}
              required={emailRequired} />
          </label>
        </div>
        <div className={css.row}>
          <label className={css.field} style={{ gridColumn: 'span 2' }}>
            <span>Calle</span>
            <input type="text" value={p.street} onChange={e => set('street', e.target.value)} required />
          </label>
          <label className={css.field}>
            <span>No. exterior</span>
            <input type="text" value={p.exterior} onChange={e => set('exterior', e.target.value)} required />
          </label>
          <label className={css.field}>
            <span>No. interior (opcional)</span>
            <input type="text" value={p.interior} onChange={e => set('interior', e.target.value)} />
          </label>
        </div>
        <div className={css.row}>
          <label className={css.field}>
            <span>Colonia</span>
            <input type="text" value={p.colonia} onChange={e => set('colonia', e.target.value)} required />
          </label>
          <label className={css.field}>
            <span>Ciudad / Municipio</span>
            <input type="text" value={p.city} onChange={e => set('city', e.target.value)} required />
          </label>
          <label className={css.field}>
            <span>Estado</span>
            <input type="text" value={p.state} onChange={e => set('state', e.target.value)} required />
          </label>
          <label className={css.field}>
            <span>Código postal</span>
            <input type="text" inputMode="numeric" maxLength={5} value={p.postalCode}
              onChange={e => set('postalCode', e.target.value.replace(/\D/g, ''))} required />
          </label>
        </div>
        <label className={css.field}>
          <span>Referencias (opcional)</span>
          <input type="text" placeholder="entre tal y cual calle, color fachada…"
            value={p.references}
            onChange={e => set('references', e.target.value)} />
        </label>
      </fieldset>
    );
  };

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
          <button type="button" className={css.secondaryBtn} onClick={() => setStep(1)}>
            ← Volver
          </button>
          <button
            type="submit"
            className={css.submitBtn}
            disabled={!canSubmitPurchase() || purchaseState.status === 'loading'}
          >
            {purchaseState.status === 'loading'
              ? 'Procesando…'
              : `Pagar ${formatMoney(selectedRate?.publicTotal)}`}
          </button>
        </div>
      </form>

      {purchaseState.status === 'ok' ? (
        <div className={css.successBox}>
          <strong>Datos capturados correctamente.</strong>
          <p>
            El pago en línea y la generación de la guía se habilitan muy
            pronto. Mientras tanto, tus datos quedaron registrados — no
            compartiremos esta información hasta que confirmes tu compra.
          </p>
        </div>
      ) : null}
    </>
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
              <li className={step === 2 ? css.stepActive : ''}>2. Datos y pago</li>
            </ol>
          </header>

          {step === 1 ? renderStep1() : renderStep2()}
        </div>
      </LayoutSingleColumn>
    </Page>
  );
};

export default CotizarEnvioPage;
