import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { Helmet } from 'react-helmet-async';

import { apiBaseUrl } from '../../util/api';
import { isScrollingDisabled } from '../../ducks/ui.duck';
import { Page, LayoutSingleColumn } from '../../components';
import TopbarContainer from '../../containers/TopbarContainer/TopbarContainer';
import FooterContainer from '../../containers/FooterContainer/FooterContainer';

import css from './CotizarEnvioPage.module.css';

// XOLOLO feature #28 · F1. Cotizador PÚBLICO de guías de paquetería.
// Cualquier persona (seller o no) puede cotizar un envío con precio
// Xololo (12.5% sobre Skydropx + seguro opcional). F1 solo muestra la
// cotización — el "Comprar guía" llega en F2.
//
// El form es intencionalmente mínimo: CP origen, CP destino, peso,
// dimensiones. Datos del remitente/destinatario se piden hasta F2
// (cuando el buyer realmente va a comprar y necesitamos esos datos
// para la etiqueta). Mantener el form corto en F1 reduce fricción.

const INITIAL_FORM = {
  originCp: '',
  destCp: '',
  weight: '',
  length: '',
  width: '',
  height: '',
  declaredValue: '',
  includeInsurance: false,
};

const formatMoney = n =>
  new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  }).format(Number(n) || 0);

const CotizarEnvioPage = () => {
  const scrollingDisabled = useSelector(isScrollingDisabled);
  const [form, setForm] = useState(INITIAL_FORM);
  const [state, setState] = useState({ status: 'idle', data: null, error: null });

  const setField = (name, value) => setForm(f => ({ ...f, [name]: value }));

  const canSubmit = () => {
    const cp = s => /^\d{5}$/.test(String(s));
    const n = v => Number(v) > 0;
    return (
      cp(form.originCp) &&
      cp(form.destCp) &&
      n(form.weight) &&
      n(form.length) &&
      n(form.width) &&
      n(form.height) &&
      (!form.includeInsurance || n(form.declaredValue))
    );
  };

  const handleSubmit = async e => {
    e.preventDefault();
    if (!canSubmit() || state.status === 'loading') return;
    setState({ status: 'loading', data: null, error: null });
    try {
      const res = await fetch(`${apiBaseUrl()}/api/public-shipping-quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: { postal_code: form.originCp },
          to: { postal_code: form.destCp },
          parcel: {
            weight: Number(form.weight),
            length: Number(form.length),
            width: Number(form.width),
            height: Number(form.height),
          },
          declaredValue: form.includeInsurance ? Number(form.declaredValue) : 0,
          includeInsurance: !!form.includeInsurance,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ status: 'error', data: null, error: data?.details || data?.error || 'Error' });
        return;
      }
      setState({ status: 'ok', data, error: null });
    } catch (err) {
      setState({ status: 'error', data: null, error: err?.message || 'Error de red' });
    }
  };

  const rates = state.data?.rates || [];

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
            <h1 className={css.title}>Cotiza tu envío</h1>
            <p className={css.subtitle}>
              Compara precios entre Estafeta, FedEx, DHL, Paquetexpress y más —
              paga una sola guía al mejor precio con Xololo. Sin registro para
              cotizar.
            </p>
          </header>

          <form className={css.form} onSubmit={handleSubmit}>
            <div className={css.row}>
              <label className={css.field}>
                <span>Código postal de origen</span>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={5}
                  placeholder="91000"
                  value={form.originCp}
                  onChange={e => setField('originCp', e.target.value.replace(/\D/g, ''))}
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
                  value={form.destCp}
                  onChange={e => setField('destCp', e.target.value.replace(/\D/g, ''))}
                  required
                />
              </label>
            </div>

            <fieldset className={css.fieldset}>
              <legend>Datos del paquete</legend>
              <div className={css.row}>
                <label className={css.field}>
                  <span>Peso (kg)</span>
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    placeholder="1.5"
                    value={form.weight}
                    onChange={e => setField('weight', e.target.value)}
                    required
                  />
                </label>
                <label className={css.field}>
                  <span>Largo (cm)</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    placeholder="30"
                    value={form.length}
                    onChange={e => setField('length', e.target.value)}
                    required
                  />
                </label>
                <label className={css.field}>
                  <span>Ancho (cm)</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    placeholder="20"
                    value={form.width}
                    onChange={e => setField('width', e.target.value)}
                    required
                  />
                </label>
                <label className={css.field}>
                  <span>Alto (cm)</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    placeholder="15"
                    value={form.height}
                    onChange={e => setField('height', e.target.value)}
                    required
                  />
                </label>
              </div>
            </fieldset>

            <fieldset className={css.fieldset}>
              <legend>Seguro (opcional)</legend>
              <label className={css.checkboxField}>
                <input
                  type="checkbox"
                  checked={form.includeInsurance}
                  onChange={e => setField('includeInsurance', e.target.checked)}
                />
                <span>
                  Quiero asegurar el paquete contra pérdida o daño (cobertura
                  hasta $100,000 MXN; el costo exacto se muestra al cotizar)
                </span>
              </label>
              {form.includeInsurance ? (
                <label className={css.field}>
                  <span>Valor declarado del contenido (MXN)</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    placeholder="2500"
                    value={form.declaredValue}
                    onChange={e => setField('declaredValue', e.target.value)}
                    required
                  />
                </label>
              ) : null}
            </fieldset>

            <button
              type="submit"
              className={css.submitBtn}
              disabled={!canSubmit() || state.status === 'loading'}
            >
              {state.status === 'loading' ? 'Cotizando…' : 'Cotizar envío'}
            </button>
          </form>

          {state.status === 'error' ? (
            <div className={css.errorBox}>
              <strong>No pudimos cotizar.</strong> {state.error}
            </div>
          ) : null}

          {state.status === 'ok' && rates.length === 0 ? (
            <div className={css.emptyBox}>
              <p>
                Ninguna paquetería devolvió tarifa para estos datos. Revisa el
                CP o las dimensiones y vuelve a intentar.
              </p>
            </div>
          ) : null}

          {state.status === 'ok' && rates.length > 0 ? (
            <section className={css.resultsRoot}>
              <h2 className={css.resultsTitle}>Opciones disponibles</h2>
              <p className={css.resultsHint}>
                Precios incluyen todo. {form.includeInsurance ? 'Con seguro contra pérdida o daño.' : 'Sin seguro — puedes añadirlo volviendo a cotizar.'}
              </p>
              {state.data?.insurance?.coverageExceeded ? (
                <p className={css.coverageWarning}>
                  ⚠️ El seguro cubre hasta $100,000 MXN. Declaraste un valor
                  mayor — el excedente no quedará cubierto. Si necesitas
                  cobertura adicional, contáctanos.
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
                      <button type="button" className={css.rateBuyBtn} disabled title="Próximamente">
                        Comprar guía
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <p className={css.resultsFoot}>
                La compra de guía estará disponible muy pronto. Mientras,
                puedes cotizar sin límite.
              </p>
            </section>
          ) : null}
        </div>
      </LayoutSingleColumn>
    </Page>
  );
};

export default CotizarEnvioPage;
