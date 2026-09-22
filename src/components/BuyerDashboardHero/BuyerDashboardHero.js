import React, { useEffect, useState } from 'react';
import classNames from 'classnames';

import { apiBaseUrl } from '../../util/api';

import css from './BuyerDashboardHero.module.css';

// XOLOLO F3 · Fase 2: hero del buyer que aparece encima de la lista
// plana de /inbox/orders. 3 bloques:
//   - En tránsito: cards con producto, tracking, seller, ETA.
//   - Reviews pendientes: recordatorio de encuesta con horas restantes.
//   - Buy again: top 5 tiendas donde ha comprado, acceso rápido.
//
// Fetch a /api/buyer-dashboard. Auto-oculta secciones vacías. Nunca
// bloquea el listado plano de InboxPage (si el fetch falla, no
// renderiza nada).

const STATUS_LABELS = {
  label_generated: { text: 'Guía generada · esperando recolección', tone: 'neutral', emoji: '🏷️' },
  picked_up: { text: 'Paquete recolectado', tone: 'progress', emoji: '🚚' },
  in_transit: { text: 'En tránsito', tone: 'progress', emoji: '✈️' },
  out_for_delivery: { text: 'En reparto — llega hoy', tone: 'urgent', emoji: '🛵' },
  delivered: { text: 'Entregado', tone: 'success', emoji: '✅' },
};

const humanTimeAgo = iso => {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const hrs = Math.floor(diffMs / (60 * 60 * 1000));
  if (hrs < 1) return 'hace unos minutos';
  if (hrs < 24) return `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
  return `hace ${Math.floor(days / 7)}sem`;
};

const Thumb = ({ url, title }) => (
  <span className={css.thumb} aria-hidden>
    {url ? <img src={url} alt="" /> : <span className={css.thumbEmpty} title={title}>📦</span>}
  </span>
);

const InTransitCard = ({ order }) => {
  const status = STATUS_LABELS[order.currentStatus] || STATUS_LABELS.label_generated;
  return (
    <li className={css.transitCard}>
      <Thumb url={order.listingImageUrl} title={order.listingTitle} />
      <div className={css.transitMain}>
        <p className={css.transitTitle}>{order.listingTitle}</p>
        <p className={css.transitSeller}>de {order.sellerName}</p>
        <p className={classNames(css.transitStatus, css[`transitStatus--${status.tone}`])}>
          <span aria-hidden>{status.emoji}</span>
          {status.text}
        </p>
      </div>
      <div className={css.transitTracking}>
        {order.carrierName ? (
          <p className={css.trackingCarrier}>{order.carrierName}</p>
        ) : null}
        {order.trackingNumber ? (
          <p className={css.trackingNumber}>{order.trackingNumber}</p>
        ) : null}
        {order.lastEventAt ? (
          <p className={css.trackingAgo}>{humanTimeAgo(order.lastEventAt)}</p>
        ) : null}
        {order.trackingUrl ? (
          <a href={order.trackingUrl} target="_blank" rel="noreferrer" className={css.trackingLink}>
            Rastrear ↗
          </a>
        ) : (
          <a href={`/order/${order.txId}`} className={css.trackingLink}>
            Ver pedido →
          </a>
        )}
      </div>
    </li>
  );
};

const ReviewPendingRow = ({ item }) => {
  const isUrgent = item.hoursLeft <= 12;
  return (
    <li className={classNames(css.reviewRow, { [css.reviewRowUrgent]: isUrgent })}>
      <Thumb url={item.listingImageUrl} title={item.listingTitle} />
      <div className={css.reviewMain}>
        <p className={css.reviewTitle}>{item.listingTitle}</p>
        <p className={css.reviewMeta}>
          {item.expired
            ? 'Ventana vencida — se aplicó afirmativa ficta'
            : `${item.hoursLeft}h para confirmar recepción o abrir disputa`}
        </p>
      </div>
      <a href={`/order/${item.txId}`} className={css.reviewCta}>
        {item.expired ? 'Ver pedido' : 'Confirmar'}
      </a>
    </li>
  );
};

const BuyAgainChip = ({ store }) => {
  const url = store.sellerSlug ? `https://${store.sellerSlug}.xololo.mx` : `/order/${store.sellerId}`;
  return (
    <a href={url} className={css.buyAgainChip}>
      {store.sellerLogoUrl ? (
        <img className={css.buyAgainLogo} src={store.sellerLogoUrl} alt="" />
      ) : (
        <span className={css.buyAgainLogoFallback}>{(store.sellerName || 'T').charAt(0)}</span>
      )}
      <span className={css.buyAgainInfo}>
        <span className={css.buyAgainName}>{store.sellerName}</span>
        <span className={css.buyAgainMeta}>
          {store.ordersCount} {store.ordersCount === 1 ? 'compra' : 'compras'}
        </span>
      </span>
    </a>
  );
};

const BuyerDashboardHero = ({ className, rootClassName }) => {
  const [state, setState] = useState({ status: 'loading', data: null });

  useEffect(() => {
    let aborted = false;
    fetch(`${apiBaseUrl()}/api/buyer-dashboard`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('fetch_failed'))))
      .then(d => {
        if (aborted) return;
        setState({ status: 'ok', data: d });
      })
      .catch(() => {
        if (aborted) return;
        setState({ status: 'error', data: null });
      });
    return () => {
      aborted = true;
    };
  }, []);

  if (state.status !== 'ok' || !state.data) return null;
  const { inTransit, reviewsPending, buyAgain, summary } = state.data;

  // Si no hay nada relevante, no renderizamos — el listado plano
  // de InboxPage cubre el caso.
  const hasAny = inTransit.length > 0 || reviewsPending.length > 0 || buyAgain.length > 0;
  if (!hasAny) return null;

  return (
    <section className={classNames(rootClassName || css.root, className)} aria-label="Resumen de tus pedidos">
      {summary?.ordersActive > 0 || summary?.ordersDelivered30d > 0 ? (
        <div className={css.summary}>
          {summary.ordersActive > 0 ? (
            <span>
              <strong>{summary.ordersActive}</strong> pedido{summary.ordersActive === 1 ? '' : 's'} en curso
            </span>
          ) : null}
          {summary.ordersDelivered30d > 0 ? (
            <span>
              <strong>{summary.ordersDelivered30d}</strong> entregado{summary.ordersDelivered30d === 1 ? '' : 's'} en 30 días
            </span>
          ) : null}
        </div>
      ) : null}

      {reviewsPending.length > 0 ? (
        <div className={css.block}>
          <h3 className={css.blockTitle}>Confirma tu recepción</h3>
          <ul className={css.reviewList}>
            {reviewsPending.slice(0, 5).map(r => (
              <ReviewPendingRow key={r.txId} item={r} />
            ))}
          </ul>
        </div>
      ) : null}

      {inTransit.length > 0 ? (
        <div className={css.block}>
          <h3 className={css.blockTitle}>
            En tránsito
            <span className={css.blockCount}>{inTransit.length}</span>
          </h3>
          <ul className={css.transitList}>
            {inTransit.slice(0, 4).map(o => (
              <InTransitCard key={o.txId} order={o} />
            ))}
          </ul>
        </div>
      ) : null}

      {buyAgain.length > 0 ? (
        <div className={css.block}>
          <h3 className={css.blockTitle}>Comprar de nuevo</h3>
          <div className={css.buyAgainRow}>
            {buyAgain.map(s => (
              <BuyAgainChip key={s.sellerId} store={s} />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
};

export default BuyerDashboardHero;
