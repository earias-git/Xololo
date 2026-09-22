import React, { useState } from 'react';
import classNames from 'classnames';

import css from './OrderTimeline.module.css';

// XOLOLO: timeline visual de una orden con los 8 estados definidos en
// docs/LOGISTICS_V1.md §2. Se alimenta de dos fuentes:
//
//  1. Sharetribe transaction.attributes.transitions — para los eventos
//     internos del proceso (pago confirmado, seller preparando, encuesta).
//  2. tx.metadata.xololoShippingTrackingEvents — array de eventos del
//     webhook Skydropx (recolectado, en tránsito, en reparto, entregado).
//
// Se muestra en OrderDetailsPage (buyer) y TransactionPage (seller).
// Layout:
//   - Desktop: los 8 estados en stepper HORIZONTAL (dots conectados por
//     una línea, label debajo). El detalle largo sólo se muestra en el
//     estado activo para no cargar la UI.
//   - Mobile: layout vertical; sólo los estados alrededor del activo,
//     el resto se despliega con "Ver todos los estados".

const STATES = [
  {
    key: 'paid',
    label: 'Pago confirmado',
    detail: 'Stripe procesó tu pago.',
    icon: '💳',
  },
  {
    key: 'preparing',
    label: 'Proveedor preparando',
    detail: 'El vendedor confirmó que está empacando tu pedido.',
    icon: '📦',
  },
  {
    key: 'label_generated',
    label: 'Guía generada',
    detail: 'La etiqueta Skydropx fue emitida.',
    icon: '🏷️',
  },
  {
    key: 'picked_up',
    label: 'Recolectado',
    detail: 'El courier recogió el paquete del vendedor.',
    icon: '🚚',
  },
  {
    key: 'in_transit',
    label: 'En tránsito',
    detail: 'Tu paquete viaja por la red del courier.',
    icon: '✈️',
  },
  {
    key: 'out_for_delivery',
    label: 'En reparto',
    detail: 'El chofer local salió con tu paquete en la ruta del día.',
    icon: '🛵',
  },
  {
    key: 'delivered',
    label: 'Entregado',
    detail: 'Comprobante de entrega (POD) confirmado.',
    icon: '✅',
  },
  {
    key: 'review_open',
    label: 'Encuesta abierta',
    detail: 'Tienes 48h para confirmar recepción o abrir disputa.',
    icon: '⭐',
  },
];

// Mapea el status del webhook Skydropx (packages.status) a uno de nuestros
// estados internos del timeline. Skydropx tiene más granularidad que
// nosotros, así que agrupamos los intermedios en 'in_transit'.
const SKYDROPX_STATUS_MAP = {
  created: 'label_generated',
  ready_to_pickup: 'label_generated',
  picked_up: 'picked_up',
  in_transit: 'in_transit',
  out_for_delivery: 'out_for_delivery',
  last_mile: 'out_for_delivery',
  delivered: 'delivered',
  in_return: 'in_transit', // retorno también es tránsito para el timeline
};

// Sharetribe transitions relevantes → status del timeline.
// Los nombres de transición dependen del transaction process del
// marketplace. Aquí capturamos los patrones típicos de Xololo purchase.
const TRANSITION_MAP = {
  'transition/request-payment': 'paid',
  'transition/confirm-payment': 'paid',
  'transition/request-payment-after-inquiry': 'paid',
  'transition/mark-preparing': 'preparing',
  'transition/mark-delivered': 'delivered',
  'transition/complete': 'review_open',
  'transition/review-1-by-customer': 'review_open',
  'transition/expire-review-period': 'review_open',
};

// Construye un mapa {stateKey → {reachedAt: ISO, detail: string}} a
// partir de las 2 fuentes. Un estado se considera "alcanzado" cuando
// tiene un timestamp asociado.
const buildReachedMap = ({ transitions, trackingEvents, guide }) => {
  const reached = {};

  // 1. Sharetribe transitions
  (transitions || []).forEach(t => {
    const stateKey = TRANSITION_MAP[t.transition];
    if (stateKey && !reached[stateKey]) {
      reached[stateKey] = { reachedAt: t.createdAt, source: 'sharetribe' };
    }
  });

  // 2. Skydropx guide generation (se guarda al crear la guía en D.5a)
  if (guide?.generatedAt && !reached.label_generated) {
    reached.label_generated = { reachedAt: guide.generatedAt, source: 'skydropx' };
  }

  // 3. Skydropx webhook events (D.6)
  (trackingEvents || []).forEach(evt => {
    const stateKey = SKYDROPX_STATUS_MAP[evt.status];
    if (stateKey && !reached[stateKey]) {
      reached[stateKey] = {
        reachedAt: evt.receivedAt,
        source: 'skydropx',
        detail: evt.eventDescription,
      };
    }
  });

  return reached;
};

// Determina el índice del estado ACTIVO actual (el último alcanzado).
const currentStateIndex = reached => {
  let last = -1;
  STATES.forEach((s, i) => {
    if (reached[s.key]) last = i;
  });
  return last;
};

const formatDateTime = iso => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-MX', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (e) {
    return '';
  }
};

const OrderTimeline = ({ transaction, className }) => {
  const [showAll, setShowAll] = useState(false);

  const attrs = transaction?.attributes || {};
  const transitions = attrs.transitions || [];
  const meta = attrs.metadata || {};
  const trackingEvents = meta.xololoShippingTrackingEvents || [];
  const guide = meta.xololoShippingGuide || null;

  const reached = buildReachedMap({ transitions, trackingEvents, guide });
  const activeIdx = currentStateIndex(reached);
  const activeState = STATES[activeIdx] || null;

  // Mobile: por default sólo mostramos el estado activo + los 2
  // relacionados (uno anterior, uno siguiente). "Ver detalle" expande.
  const mobileStart = Math.max(0, activeIdx - 1);
  const mobileEnd = Math.min(STATES.length - 1, activeIdx + 1);
  const visibleStates = showAll ? STATES : STATES.slice(mobileStart, mobileEnd + 1);
  const hasHiddenStates = !showAll && visibleStates.length < STATES.length;

  return (
    <section className={classNames(css.root, className)}>
      <header className={css.header}>
        <h3 className={css.title}>Estado del pedido</h3>
        {activeState ? (
          <p className={css.currentPill}>
            <span aria-hidden>{activeState.icon}</span>
            <strong>{activeState.label}</strong>
            <span className={css.currentTime}>{formatDateTime(reached[activeState.key]?.reachedAt)}</span>
          </p>
        ) : null}
      </header>

      <ol className={classNames(css.list, css.listDesktop)}>
        {STATES.map((s, i) => {
          const r = reached[s.key];
          const isDone = i < activeIdx;
          const isActive = i === activeIdx;
          const isFuture = i > activeIdx;
          return (
            <li
              key={s.key}
              className={classNames(css.item, {
                [css.itemDone]: isDone,
                [css.itemActive]: isActive,
                [css.itemFuture]: isFuture,
              })}
            >
              <div className={css.dotWrap}>
                <span className={css.dot} aria-hidden />
                {i < STATES.length - 1 ? <span className={css.line} aria-hidden /> : null}
              </div>
              <div className={css.itemBody}>
                <p className={css.itemLabel}>
                  <span className={css.itemIcon} aria-hidden>{s.icon}</span>
                  {s.label}
                </p>
                <p className={css.itemDetail}>{r?.detail || s.detail}</p>
                {r?.reachedAt ? (
                  <p className={css.itemTime}>{formatDateTime(r.reachedAt)}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {/* Mobile: solo estados visibles */}
      <ol className={classNames(css.list, css.listMobile)}>
        {visibleStates.map((s, idx) => {
          const globalIdx = STATES.findIndex(x => x.key === s.key);
          const r = reached[s.key];
          const isDone = globalIdx < activeIdx;
          const isActive = globalIdx === activeIdx;
          const isFuture = globalIdx > activeIdx;
          return (
            <li
              key={s.key}
              className={classNames(css.item, {
                [css.itemDone]: isDone,
                [css.itemActive]: isActive,
                [css.itemFuture]: isFuture,
              })}
            >
              <div className={css.dotWrap}>
                <span className={css.dot} aria-hidden />
                {idx < visibleStates.length - 1 ? <span className={css.line} aria-hidden /> : null}
              </div>
              <div className={css.itemBody}>
                <p className={css.itemLabel}>
                  <span className={css.itemIcon} aria-hidden>{s.icon}</span>
                  {s.label}
                </p>
                <p className={css.itemDetail}>{r?.detail || s.detail}</p>
                {r?.reachedAt ? (
                  <p className={css.itemTime}>{formatDateTime(r.reachedAt)}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {hasHiddenStates ? (
        <button type="button" className={css.expandBtn} onClick={() => setShowAll(true)}>
          Ver todos los estados ({STATES.length})
        </button>
      ) : showAll ? (
        <button type="button" className={css.expandBtn} onClick={() => setShowAll(false)}>
          Ver menos
        </button>
      ) : null}

      {guide?.trackingUrl ? (
        <a
          href={guide.trackingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={css.trackingLink}
        >
          Ver tracking detallado en {guide.carrierName?.toUpperCase()} →
        </a>
      ) : null}
    </section>
  );
};

export default OrderTimeline;
