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

// XOLOLO Junta 2026-10-26: cotizamos con dirección completa (no solo
// CP) para que Skydropx aplique zona extendida en el precio inicial.
// Debounce más alto para no cotizar cada letra que tipea el buyer en
// la calle o referencias.
const QUOTE_DEBOUNCE_MS = 1000;

// Construye la clave "signature" de un destino — usada para saber
// si el buyer cambió algo desde la última cotización.
const signatureOf = destination =>
  [
    (destination.postal_code || '').trim(),
    (destination.area_level1 || '').trim().toLowerCase(),
    (destination.area_level2 || '').trim().toLowerCase(),
    (destination.area_level3 || '').trim().toLowerCase(),
    (destination.street1 || '').trim().toLowerCase(),
    (destination.street2 || '').trim().toLowerCase(),
    (destination.reference || '').trim().toLowerCase(),
  ].join('|');

const isValidDestination = d =>
  /^\d{5}$/.test(String(d.postal_code || '').trim()) &&
  String(d.area_level1 || '').trim().length > 0 &&
  String(d.area_level2 || '').trim().length > 0 &&
  String(d.area_level3 || '').trim().length > 0 &&
  // XOLOLO Junta 2026-10-26: calle + número son requeridos para evitar
  // zona extendida retroactiva. Mínimo 3 chars para filtrar "ab" o " ".
  String(d.street1 || '').trim().length >= 3;

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

  const [state, setState] = useState({
    status: QuoteRequestState.IDLE,
    rates: [],
    error: null,
    // XOLOLO Fase 2: metadata del server para decidir si mostramos el
    // toggle de SOS y qué texto mostrar.
    declaredValue: 0,
    insuranceMinDeclaredValue: 500,
  });
  const [selectedRateId, setSelectedRateId] = useState(null);
  // XOLOLO Fase 2: toggle "Protección SOS". Default OFF (opt-in).
  // Al activarlo, re-cotizamos con insurance=true y los totales se
  // actualizan automáticamente.
  const [wantsInsurance, setWantsInsurance] = useState(false);
  // Consentimiento explícito "entiendo que renuncio al seguro" — hay
  // que marcarlo para poder avanzar sin SOS. Si el buyer activa el
  // toggle, el consentimiento se reinicia (no aplica).
  const [acceptsNoInsurance, setAcceptsNoInsurance] = useState(false);
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
      fetchRatesFor(destination, wantsInsurance);
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
    destination?.street1,
    destination?.street2,
    destination?.reference,
    shippingPricingMode,
    sellerCoversShipping,
    wantsInsurance,
  ]);

  const fetchRatesFor = async (dest, insurance = false) => {
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
          insurance: Boolean(insurance),
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
      // XOLOLO Fase 2: al re-cotizar los totales cambian — invalidar la
      // selección previa para que el buyer confirme la nueva.
      setSelectedRateId(null);
      setState({
        status: QuoteRequestState.SUCCESS,
        rates: data.rates,
        error: null,
        declaredValue: Number(data.declaredValue) || 0,
        insuranceMinDeclaredValue: Number(data.insuranceMinDeclaredValue) || 500,
      });
    } catch (e) {
      if (e.name === 'AbortError') return; // request cancelado por cambio de dirección
      setState({ status: QuoteRequestState.ERROR, rates: [], error: e.message });
    }
  };

  const selectRate = rate => {
    setSelectedRateId(rate.id);
    if (typeof onRateSelected === 'function') {
      // XOLOLO Fase 2: pasamos la elección de seguro para que el
      // checkout la persista en metadata de la tx.
      onRateSelected({
        ...rate,
        insuranceAccepted: wantsInsurance,
        noInsuranceConsent: !wantsInsurance ? acceptsNoInsurance : false,
      });
    }
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
          Completa la dirección de envío arriba (CP, estado, ciudad, colonia
          y calle con número) para ver las paqueterías disponibles.
        </p>
      ) : state.status === QuoteRequestState.LOADING ? (
        <p className={css.hint}>
          Estamos solicitando el presupuesto para CP {destination.postal_code} —
          esto puede tardar unos segundos…
        </p>
      ) : state.status === QuoteRequestState.SUCCESS ? (
        <p className={css.hint}>
          Cotización para CP {destination.postal_code} · elige tu paquetería:
        </p>
      ) : null}

      {state.status === QuoteRequestState.ERROR ? (
        <p className={css.error}>{state.error}</p>
      ) : null}

      {/* XOLOLO Fase 2: toggle SOS Protección. Visible sólo cuando el
          valor declarado supera el umbral mínimo (default $500). */}
      {state.status === QuoteRequestState.SUCCESS &&
      state.declaredValue >= state.insuranceMinDeclaredValue ? (
        <div className={css.insuranceBlock}>
          <label className={css.insuranceToggle}>
            <input
              type="checkbox"
              checked={wantsInsurance}
              onChange={e => {
                setWantsInsurance(e.target.checked);
                if (e.target.checked) setAcceptsNoInsurance(false);
              }}
            />
            <span>
              <strong>Agregar Protección SOS</strong>
              <small className={css.insuranceHelp}>
                Si el paquete se extravía o llega dañado por la paquetería,
                puedes solicitar el reembolso del valor declarado (
                ${state.declaredValue.toLocaleString('es-MX')} MXN).
              </small>
            </span>
          </label>
          {!wantsInsurance ? (
            <label className={css.consentCheckbox}>
              <input
                type="checkbox"
                checked={acceptsNoInsurance}
                onChange={e => setAcceptsNoInsurance(e.target.checked)}
              />
              <small>
                Entiendo que al no contratar la Protección SOS, Xololo y
                el vendedor no se hacen responsables por daño, robo o
                extravío del paquete durante el envío. Si esto ocurre,
                deberé gestionar el reclamo directamente con la paquetería.
              </small>
            </label>
          ) : null}
        </div>
      ) : null}

      {state.status === QuoteRequestState.SUCCESS ? (
        <div className={css.ratesGrid}>
          {state.rates.map(rate => {
            const isSelected = selectedRateId === rate.id;
            // XOLOLO Fase 2: si el valor declarado está arriba del
            // umbral y el buyer rechazó el seguro, exigimos el
            // consentimiento explícito antes de dejar seleccionar.
            const needsConsent =
              state.declaredValue >= state.insuranceMinDeclaredValue &&
              !wantsInsurance &&
              !acceptsNoInsurance;
            return (
              <button
                key={rate.id}
                type="button"
                className={classNames(css.rateCard, {
                  [css.rateCardSelected]: isSelected,
                  [css.rateCardDisabled]: needsConsent,
                })}
                onClick={() => !needsConsent && selectRate(rate)}
                disabled={needsConsent}
                title={
                  needsConsent
                    ? 'Marca la casilla de arriba para poder elegir sin Protección SOS.'
                    : undefined
                }
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
                {/* XOLOLO Junta 2026-10-26: badge para carriers sin
                    recolección — el seller tendrá que llevar el paquete
                    a sucursal. */}
                {rate.dropoffOnly ? (
                  <div className={css.rateDropoffBadge}>
                    📍 Entrega en sucursal (sin recolección)
                  </div>
                ) : null}
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
