import React, { useState } from 'react';
import classNames from 'classnames';

import css from './OrderTimeline.module.css';

// XOLOLO Envíos v2: timeline visual ramificado por método de entrega.
// El shape del timeline depende del tx.protectedData.xololoShipping.mode:
//
//   pickup:        paid → preparing → ready → delivered → review_open
//   localDelivery: paid → preparing → ready → dispatched → delivered → review_open
//   carrier:       paid → preparing → label_generated → picked_up → in_transit →
//                    out_for_delivery → delivered → review_open  (flujo Skydropx)
//   freight:       paid → preparing → quoting → quoted → authorized → dispatched →
//                    delivered → review_open
//   none (legacy): mismo que carrier (compat con tx antes del v2).
//
// Fuentes de timestamps ("reached"):
//   - tx.attributes.transitions              (paid, review_open — Sharetribe)
//   - tx.metadata.xoloFlow                   (readyAt, dispatchedAt)
//   - tx.metadata.xoloFreight                (quotedAt, buyerAuthorizedAt)
//   - tx.metadata.xololoShippingGuide        (generatedAt, currentStatus — Skydropx)
//   - tx.metadata.xololoShippingTrackingEvents  (eventos Skydropx)
//   - tx.metadata.xololoDeliveryCodeVerified (verifiedAt = delivered para modos con código)

const STATE_DEFS = {
  paid: {
    label: 'Pago confirmado',
    detail: 'Stripe procesó tu pago.',
    icon: '💳',
  },
  preparing: {
    label: 'Proveedor preparando',
    detail: 'El vendedor está empacando tu pedido.',
    icon: '📦',
  },
  ready: {
    label: 'Listo',
    detail: 'El vendedor marcó tu pedido como listo.',
    icon: '📮',
  },
  quoting: {
    label: 'Cotizando envío',
    detail: 'El vendedor está cotizando el envío por flete.',
    icon: '💬',
  },
  quoted: {
    label: 'Envío cotizado',
    detail: 'Autoriza y paga el envío desde el detalle del pedido.',
    icon: '💵',
  },
  authorized: {
    label: 'Envío pagado',
    detail: 'Autorizaste el envío. El vendedor está por despachar.',
    icon: '💰',
  },
  label_generated: {
    label: 'Guía generada',
    detail: 'La etiqueta Skydropx fue emitida.',
    icon: '🏷️',
  },
  picked_up: {
    label: 'Recolectado',
    detail: 'El courier recogió el paquete del vendedor.',
    icon: '🚚',
  },
  in_transit: {
    label: 'En tránsito',
    detail: 'Tu paquete viaja por la red del courier.',
    icon: '✈️',
  },
  out_for_delivery: {
    label: 'En reparto',
    detail: 'El chofer local salió con tu paquete en la ruta del día.',
    icon: '🛵',
  },
  dispatched: {
    label: 'En camino',
    detail: 'El vendedor lleva tu pedido al domicilio.',
    icon: '🛵',
  },
  delivered: {
    label: 'Entregado',
    detail: 'La entrega quedó confirmada.',
    icon: '✅',
  },
  review_open: {
    label: 'Encuesta abierta',
    detail: 'Tienes 48h para confirmar recepción o abrir disputa.',
    icon: '⭐',
  },
};

// Los flujos por modo. La UI ramifica sobre xoloShipping.mode; los tx
// sin xoloShipping (o mode='none') caen al flujo carrier legacy.
const STATES_BY_MODE = {
  pickup: ['paid', 'preparing', 'ready', 'delivered', 'review_open'],
  localDelivery: ['paid', 'preparing', 'ready', 'dispatched', 'delivered', 'review_open'],
  carrier: [
    'paid',
    'preparing',
    'label_generated',
    'picked_up',
    'in_transit',
    'out_for_delivery',
    'delivered',
    'review_open',
  ],
  freight: [
    'paid',
    'preparing',
    'quoting',
    'quoted',
    'authorized',
    'dispatched',
    'delivered',
    'review_open',
  ],
  none: [
    'paid',
    'preparing',
    'label_generated',
    'picked_up',
    'in_transit',
    'out_for_delivery',
    'delivered',
    'review_open',
  ],
};

// Mapea el status del webhook Skydropx (packages.status) a uno de nuestros
// estados internos. Skydropx tiene más granularidad que nosotros, así que
// agrupamos los intermedios en 'in_transit'.
const SKYDROPX_STATUS_MAP = {
  created: 'label_generated',
  ready_to_pickup: 'label_generated',
  picked_up: 'picked_up',
  in_transit: 'in_transit',
  out_for_delivery: 'out_for_delivery',
  last_mile: 'out_for_delivery',
  delivered: 'delivered',
  in_return: 'in_transit',
};

const TRANSITION_MAP = {
  'transition/request-payment': 'paid',
  'transition/confirm-payment': 'paid',
  'transition/request-payment-after-inquiry': 'paid',
  'transition/mark-delivered': 'delivered',
  'transition/complete': 'review_open',
  'transition/review-1-by-customer': 'review_open',
  'transition/expire-review-period': 'review_open',
};

// Construye {stateKey → {reachedAt, source, detail?}} juntando las
// distintas fuentes. Un estado se considera "alcanzado" cuando tiene un
// timestamp; los mismos flags avanzan varios modos porque cada flow
// filtra después con STATES_BY_MODE.
const buildReachedMap = ({ transitions, trackingEvents, guide, flow, freight, codeVerified }) => {
  const reached = {};

  (transitions || []).forEach(t => {
    const stateKey = TRANSITION_MAP[t.transition];
    if (stateKey && !reached[stateKey]) {
      reached[stateKey] = { reachedAt: t.createdAt, source: 'sharetribe' };
    }
  });

  // Sub-flags de flujo v2 (server/api/tx-flow.js).
  if (flow?.readyAt && !reached.ready) {
    reached.ready = { reachedAt: flow.readyAt, source: 'flow' };
  }
  if (flow?.dispatchedAt && !reached.dispatched) {
    reached.dispatched = { reachedAt: flow.dispatchedAt, source: 'flow' };
  }

  // Freight ciclo (server/api/freight.js + webhook stripe-billing).
  if (freight?.quotedAt && !reached.quoting) {
    reached.quoting = { reachedAt: freight.quotedAt, source: 'freight' };
  }
  if (freight?.quotedAt && !reached.quoted) {
    // 'quoted' se marca al mismo tiempo que 'quoting' (ambos representan
    // "ya hay cotización"); la UI decide cuál mostrar como activo según
    // buyerAuthorizedAt.
    reached.quoted = { reachedAt: freight.quotedAt, source: 'freight' };
  }
  if (freight?.buyerAuthorizedAt && !reached.authorized) {
    reached.authorized = { reachedAt: freight.buyerAuthorizedAt, source: 'freight' };
  }

  // Skydropx guide generation (D.5a).
  if (guide?.generatedAt && !reached.label_generated) {
    reached.label_generated = { reachedAt: guide.generatedAt, source: 'skydropx' };
  }

  // Skydropx webhook events (D.6).
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

  // Código de entrega verificado (pickup/localDelivery/freight) también
  // marca 'delivered' — el webhook Sharetribe puede tardar en propagar
  // el mark-delivered aunque el código ya se validó.
  if (codeVerified?.verifiedAt && !reached.delivered) {
    reached.delivered = { reachedAt: codeVerified.verifiedAt, source: 'delivery_code' };
  }

  return reached;
};

const currentStateIndex = (states, reached) => {
  let last = -1;
  states.forEach((key, i) => {
    if (reached[key]) last = i;
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
  const pd = attrs.protectedData || {};
  const shipping = pd.xololoShipping || {};
  const mode = shipping.mode || 'none';

  const trackingEvents = meta.xololoShippingTrackingEvents || [];
  const guide = meta.xololoShippingGuide || null;
  const flow = meta.xoloFlow || null;
  const freight = meta.xoloFreight || null;
  const codeVerified = meta.xololoDeliveryCodeVerified || meta.xololoPickupCodeVerified || null;

  const stateKeys = STATES_BY_MODE[mode] || STATES_BY_MODE.none;
  const states = stateKeys.map(key => ({ key, ...STATE_DEFS[key] }));

  const reached = buildReachedMap({
    transitions,
    trackingEvents,
    guide,
    flow,
    freight,
    codeVerified,
  });
  const activeIdx = currentStateIndex(stateKeys, reached);
  const activeState = states[activeIdx] || null;

  const mobileStart = Math.max(0, activeIdx - 1);
  const mobileEnd = Math.min(states.length - 1, activeIdx + 1);
  const visibleStates = showAll ? states : states.slice(mobileStart, mobileEnd + 1);
  const hasHiddenStates = !showAll && visibleStates.length < states.length;

  return (
    <section className={classNames(css.root, className)}>
      <header className={css.header}>
        <h3 className={css.title}>Estado del pedido</h3>
        {activeState ? (
          <p className={css.currentPill}>
            <span aria-hidden>{activeState.icon}</span>
            <strong>{activeState.label}</strong>
            <span className={css.currentTime}>
              {formatDateTime(reached[activeState.key]?.reachedAt)}
            </span>
          </p>
        ) : null}
      </header>

      <ol className={classNames(css.list, css.listDesktop)}>
        {states.map((s, i) => {
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
                {i < states.length - 1 ? <span className={css.line} aria-hidden /> : null}
              </div>
              <div className={css.itemBody}>
                <p className={css.itemLabel}>
                  <span className={css.itemIcon} aria-hidden>
                    {s.icon}
                  </span>
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
          const globalIdx = states.findIndex(x => x.key === s.key);
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
                  <span className={css.itemIcon} aria-hidden>
                    {s.icon}
                  </span>
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
          Ver todos los estados ({states.length})
        </button>
      ) : showAll ? (
        <button type="button" className={css.expandBtn} onClick={() => setShowAll(false)}>
          Ver menos
        </button>
      ) : null}

      {/* Link a tracking Skydropx sólo aplica al modo carrier. */}
      {mode === 'carrier' && guide?.trackingUrl ? (
        <a
          href={guide.trackingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={css.trackingLink}
        >
          Ver tracking detallado en {guide.carrierName?.toUpperCase() || 'la paquetería'} →
        </a>
      ) : null}
    </section>
  );
};

export default OrderTimeline;
