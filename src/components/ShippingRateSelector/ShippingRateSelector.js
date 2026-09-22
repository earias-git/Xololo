import React, { useEffect, useRef, useState } from 'react';
import classNames from 'classnames';

import { apiBaseUrl } from '../../util/api';

import css from './ShippingRateSelector.module.css';

// XOLOLO: widget de cotización de envío para el checkout. Aparece
// DEBAJO del form ShippingDetails y LEE los mismos valores (CP,
// estado, ciudad, colonia) que el buyer capturó ahí — así no puede
// haber divergencia entre el CP que se cotizó y el CP al que se
// entrega.
//
// Escenarios:
//  1. Listing con sellerCoversShipping=true → banner "Envío gratis"
//     y auto-selecciona un rate especial {carrier:'seller-cubre', total:0}.
//     Ignora los values de la dirección (no necesita cotizar).
//  2. Listing normal → apenas los 4 campos (CP + estado + ciudad +
//     colonia) están completos y válidos, cotiza automáticamente
//     (debounce 500ms). El buyer sólo elige la paquetería en las
//     tarjetas resultantes.
//  3. Si el buyer edita cualquiera de los 4 campos después de haber
//     seleccionado un rate, la selección se invalida y se re-cotiza.
//  4. Error de cotización (422/504) → mensaje con retry.

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

const QUOTE_DEBOUNCE_MS = 500;

// Construye la clave "signature" de un destino — usada para saber
// si el buyer cambió algo desde la última cotización.
const signatureOf = destination =>
  [
    (destination.postal_code || '').trim(),
    (destination.area_level1 || '').trim().toLowerCase(),
    (destination.area_level2 || '').trim().toLowerCase(),
    (destination.area_level3 || '').trim().toLowerCase(),
  ].join('|');

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
    // XOLOLO Cart.6
    primaryQuantity,
    additionalCartItems,
    // XOLOLO: destino tomado del Final Form values del ShippingDetails.
    // Shape esperado: {postal_code, area_level1, area_level2, area_level3}
    destination,
  } = props;

  const [state, setState] = useState({ status: QuoteRequestState.IDLE, rates: [], error: null });
  const [selectedRateId, setSelectedRateId] = useState(null);
  const lastSigRef = useRef(null);
  const debounceRef = useRef(null);
  const abortRef = useRef(null);

  // Escenario 1: seller absorbe. Auto-seleccionamos FREE_RATE al montar.
  // (useEffect para no llamar setState durante render — bug del template previo.)
  useEffect(() => {
    if (shippingPricingMode !== 'carrier') return;
    if (!sellerCoversShipping) return;
    if (selectedRateId === FREE_RATE.id) return;
    setSelectedRateId(FREE_RATE.id);
    if (typeof onRateSelected === 'function') onRateSelected(FREE_RATE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shippingPricingMode, sellerCoversShipping]);

  // XOLOLO: auto-cotización cuando el destino cambia y está válido.
  // Debounce para no golpear el endpoint mientras el buyer teclea.
  useEffect(() => {
    if (shippingPricingMode !== 'carrier') return;
    if (sellerCoversShipping) return;
    if (!destination) return;

    const sig = signatureOf(destination);
    if (sig === lastSigRef.current) return; // sin cambio real

    // Invalida rate previo — si cambió el CP, el rate ya no aplica.
    if (state.status === QuoteRequestState.SUCCESS || selectedRateId) {
      setState({ status: QuoteRequestState.IDLE, rates: [], error: null });
      setSelectedRateId(null);
      if (typeof onRateSelected === 'function') onRateSelected(null);
    }

    if (!isValidDestination(destination)) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      lastSigRef.current = sig;
      fetchRatesFor(destination);
    }, QUOTE_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    destination?.postal_code,
    destination?.area_level1,
    destination?.area_level2,
    destination?.area_level3,
    shippingPricingMode,
    sellerCoversShipping,
  ]);

  const fetchRatesFor = async dest => {
    // Cancela request previo si hay uno en vuelo.
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ status: QuoteRequestState.LOADING, rates: [], error: null });
    try {
      const hasCart = Array.isArray(additionalCartItems) && additionalCartItems.length > 0;
      const res = await fetch(`${apiBaseUrl()}/api/shipping-quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          listingId,
          destination: dest,
          ...(primaryQuantity ? { quantity: primaryQuantity } : {}),
          ...(hasCart ? { additionalCartItems } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
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
      if (e.name === 'AbortError') return; // request cancelado por cambio de dirección
      setState({ status: QuoteRequestState.ERROR, rates: [], error: e.message });
    }
  };

  const selectRate = rate => {
    setSelectedRateId(rate.id);
    if (typeof onRateSelected === 'function') onRateSelected(rate);
  };

  if (shippingPricingMode !== 'carrier') return null;

  const classes = classNames(rootClassName || css.root, className);

  if (sellerCoversShipping) {
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

  const destinationReady = isValidDestination(destination || {});

  return (
    <section className={classes}>
      <h3 className={css.title}>Opciones de envío</h3>
      {!destinationReady ? (
        <p className={css.hint}>
          Completa la dirección de envío arriba (CP, estado, ciudad y colonia)
          para ver las paqueterías disponibles.
        </p>
      ) : state.status === QuoteRequestState.LOADING ? (
        <p className={css.hint}>Cotizando envío a CP {destination.postal_code}…</p>
      ) : state.status === QuoteRequestState.SUCCESS ? (
        <p className={css.hint}>
          Cotización para CP {destination.postal_code} · elige tu paquetería:
        </p>
      ) : null}

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
