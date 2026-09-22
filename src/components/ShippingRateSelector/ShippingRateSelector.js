import React, { useState } from 'react';
import classNames from 'classnames';

import { apiBaseUrl } from '../../util/api';

import css from './ShippingRateSelector.module.css';

// XOLOLO: widget del checkout que cotiza envío contra Skydropx y deja al
// buyer elegir paquetería. Aparece solo cuando el listing está en modo
// carrier (shippingPricingMode='carrier'). Self-contained: maneja su
// propio state (dirección de destino, rates, rate seleccionado) y notifica
// al parent con onRateSelected(rate) al elegir uno.
//
// Escenarios manejados:
//  1. Listing con sellerCoversShipping=true → banner "Envío gratis 🎁"
//     y auto-selecciona un rate especial {carrier:'seller-cubre', total:0}.
//     El parent debe interpretarlo como "shipping fee = 0".
//  2. Listing normal → form de dirección + botón "Cotizar" → rates.
//  3. Error de cotización (422/504) → mensaje con retry.
//
// Notas de UX:
//  - El buyer llena CP/estado/municipio/colonia. Estos NO se persisten
//    aquí; la dirección real de envío la captura el ShippingDetails que
//    viene debajo (form principal del checkout).
//  - Los rates se muestran como cards (radio buttons visuales) ordenados
//    por precio. Al clickear uno se marca seleccionado y notifica parent.
//  - En mobile los cards se apilan; en desktop 2 columnas.

const QuoteRequestState = {
  IDLE: 'idle',
  LOADING: 'loading',
  SUCCESS: 'success',
  ERROR: 'error',
};

const FREE_RATE = {
  id: 'seller-covers',
  carrier: 'Xololo',
  service: 'Envío gratis',
  total: 0,
  currency: 'MXN',
  days: null,
  isFreeShipping: true,
};

const isValidDestination = d =>
  /^\d{5}$/.test(String(d.postal_code || '').trim()) &&
  String(d.area_level1 || '').trim().length > 0 &&
  String(d.area_level2 || '').trim().length > 0 &&
  String(d.area_level3 || '').trim().length > 0;

const ShippingRateSelector = props => {
  const {
    className,
    rootClassName,
    listingId,
    shippingPricingMode,
    sellerCoversShipping,
    onRateSelected,
    // XOLOLO Cart.6: cantidad del primary + items extra del carrito
    // (mismo shape que orderData.additionalCartItems: [{listingId, quantity}]).
    // Se envían al server para agregar peso/dimensiones del carrito.
    primaryQuantity,
    additionalCartItems,
  } = props;

  const [destination, setDestination] = useState({
    postal_code: '',
    area_level1: '',
    area_level2: '',
    area_level3: '',
  });
  const [state, setState] = useState({ status: QuoteRequestState.IDLE, rates: [], error: null });
  const [selectedRateId, setSelectedRateId] = useState(null);

  // Si el listing no es carrier, este componente no aplica.
  if (shippingPricingMode !== 'carrier') return null;

  const classes = classNames(rootClassName || css.root, className);

  // Escenario 1: seller absorbe. Auto-seleccionamos FREE_RATE al montar
  // y no mostramos el form de cotización.
  if (sellerCoversShipping) {
    // Notificamos una sola vez (useEffect no aplica aquí porque el effect
    // en cascada sería innecesario — parent guarda el rate al montarse).
    if (selectedRateId !== FREE_RATE.id) {
      setSelectedRateId(FREE_RATE.id);
      if (typeof onRateSelected === 'function') onRateSelected(FREE_RATE);
    }
    return (
      <section className={classes}>
        <div className={css.freeBanner}>
          <span className={css.freeBadge}>🎁</span>
          <div>
            <strong className={css.freeTitle}>Envío gratis</strong>
            <p className={css.freeSubtitle}>
              El vendedor absorbe el costo de envío en esta compra.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const changeField = (name, value) => {
    setDestination(d => ({ ...d, [name]: value }));
    // Al modificar la dirección invalidamos rates previos y selección.
    if (state.status === QuoteRequestState.SUCCESS) {
      setState({ status: QuoteRequestState.IDLE, rates: [], error: null });
      setSelectedRateId(null);
      if (typeof onRateSelected === 'function') onRateSelected(null);
    }
  };

  const fetchRates = async () => {
    if (!isValidDestination(destination)) {
      setState({
        status: QuoteRequestState.ERROR,
        rates: [],
        error: 'Completa CP (5 dígitos), estado, municipio y colonia.',
      });
      return;
    }
    setState({ status: QuoteRequestState.LOADING, rates: [], error: null });
    try {
      const hasCart = Array.isArray(additionalCartItems) && additionalCartItems.length > 0;
      const res = await fetch(`${apiBaseUrl()}/api/shipping-quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId,
          destination,
          ...(primaryQuantity ? { quantity: primaryQuantity } : {}),
          ...(hasCart ? { additionalCartItems } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Mapeamos códigos a mensajes amables.
        const msgByError = {
          origin_not_configured: 'El vendedor aún no configuró su código postal de origen.',
          listing_not_shippable:
            'Este producto no está disponible para envío por paquetería.',
          listing_incomplete:
            'El vendedor no capturó peso o dimensiones para cotizar el envío.',
          quote_timeout: 'La cotización tardó demasiado. Intenta de nuevo.',
          quote_failed: 'No pudimos cotizar el envío para esta dirección.',
        };
        throw new Error(msgByError[data.error] || 'No pudimos cotizar el envío.');
      }
      if (!data.rates || data.rates.length === 0) {
        throw new Error('Ninguna paquetería tiene cobertura para esta dirección.');
      }
      setState({ status: QuoteRequestState.SUCCESS, rates: data.rates, error: null });
    } catch (e) {
      setState({ status: QuoteRequestState.ERROR, rates: [], error: e.message });
    }
  };

  const selectRate = rate => {
    setSelectedRateId(rate.id);
    if (typeof onRateSelected === 'function') onRateSelected(rate);
  };

  return (
    <section className={classes}>
      <h3 className={css.title}>Envío a domicilio</h3>
      <p className={css.hint}>
        Ingresa la dirección de entrega para ver las paqueterías disponibles.
      </p>

      <div className={css.formGrid}>
        <label className={css.field}>
          <span className={css.label}>Código postal *</span>
          <input
            type="text"
            inputMode="numeric"
            maxLength={5}
            className={css.input}
            value={destination.postal_code}
            onChange={e => changeField('postal_code', e.target.value.replace(/\D/g, ''))}
            placeholder="91000"
          />
        </label>
        <label className={css.field}>
          <span className={css.label}>Estado *</span>
          <input
            type="text"
            className={css.input}
            value={destination.area_level1}
            onChange={e => changeField('area_level1', e.target.value)}
            placeholder="Veracruz"
          />
        </label>
        <label className={css.field}>
          <span className={css.label}>Municipio / Ciudad *</span>
          <input
            type="text"
            className={css.input}
            value={destination.area_level2}
            onChange={e => changeField('area_level2', e.target.value)}
            placeholder="Xalapa"
          />
        </label>
        <label className={css.field}>
          <span className={css.label}>Colonia *</span>
          <input
            type="text"
            className={css.input}
            value={destination.area_level3}
            onChange={e => changeField('area_level3', e.target.value)}
            placeholder="Centro"
          />
        </label>
      </div>

      <button
        type="button"
        className={css.quoteBtn}
        onClick={fetchRates}
        disabled={state.status === QuoteRequestState.LOADING}
      >
        {state.status === QuoteRequestState.LOADING
          ? 'Cotizando…'
          : state.status === QuoteRequestState.SUCCESS
          ? 'Volver a cotizar'
          : 'Ver opciones de envío'}
      </button>

      {state.status === QuoteRequestState.ERROR ? (
        <p className={css.error}>{state.error}</p>
      ) : null}

      {state.status === QuoteRequestState.SUCCESS ? (
        <div className={css.ratesGrid}>
          {state.rates.map(rate => {
            const isSelected = selectedRateId === rate.id;
            return (
              <button
                key={rate.id}
                type="button"
                className={classNames(css.rateCard, { [css.rateCardSelected]: isSelected })}
                onClick={() => selectRate(rate)}
                aria-pressed={isSelected}
              >
                <div className={css.rateCardHeader}>
                  <span className={css.rateCarrier}>{rate.carrier}</span>
                  <span className={css.ratePrice}>
                    ${rate.total.toFixed(2)} <small>{rate.currency}</small>
                  </span>
                </div>
                <div className={css.rateCardBody}>
                  <span className={css.rateService}>{rate.service}</span>
                  <span className={css.rateDays}>
                    {rate.days ? `${rate.days} día${rate.days > 1 ? 's' : ''} estimados` : '—'}
                  </span>
                </div>
                {isSelected ? <div className={css.rateCheck}>✓ Seleccionado</div> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
};

export default ShippingRateSelector;
