import React, { useEffect, useState } from 'react';
import classNames from 'classnames';

import { apiBaseUrl } from '../../util/api';

import css from './StoreHeaderStats.module.css';

// XOLOLO P2: barra compacta de "prueba social" para el HEADER del
// storefront. Reemplaza el StoreStatsWidget grande que vivía en el
// body — ahora la info clave (estrellas + reseñas + ventas) queda
// arriba, siempre visible sin hacer scroll.
//
// Muestra (todo condicional):
//   - 5 estrellas con la nota promedio + "(N)" reseñas
//     · click en las estrellas navega a la ProfilePage del seller
//       (que ya tiene la sección completa de reseñas). Alternativa
//       futura: agregar un #reviews inline al storefront.
//   - "N ventas · Y meses en Xololo" cuando el seller es "eligible"
//     por el endpoint (≥5 ventas). Si no, sólo estrellas.
//
// Fuente: /api/public-store-stats — mismo endpoint que ya usaba el
// widget viejo, extendido con `rating: { average, count }`.

const monthsToLabel = m => {
  if (!Number.isFinite(m) || m < 1) return null;
  if (m < 12) return `${m} ${m === 1 ? 'mes' : 'meses'} en Xololo`;
  const years = Math.floor(m / 12);
  return `${years} ${years === 1 ? 'año' : 'años'} en Xololo`;
};

const StarRow = ({ average }) => {
  const full = Math.floor(average);
  const hasHalf = average - full >= 0.25 && average - full < 0.75;
  const rounded = average - full >= 0.75 ? full + 1 : full;
  return (
    <span className={css.stars} aria-hidden="true">
      {[0, 1, 2, 3, 4].map(i => {
        const isFull = i < rounded;
        const isHalf = !isFull && hasHalf && i === full;
        return (
          <span
            key={i}
            className={classNames(css.star, {
              [css.starFull]: isFull,
              [css.starHalf]: isHalf,
            })}
          >
            ★
          </span>
        );
      })}
    </span>
  );
};

const StoreHeaderStats = ({
  sellerId,
  slug,
  className,
  rootClassName,
  reviewsHref,
}) => {
  const [state, setState] = useState({ status: 'loading', data: null });

  useEffect(() => {
    if (!sellerId && !slug) return;
    let aborted = false;
    const qs = new URLSearchParams();
    if (sellerId) qs.set('sellerId', sellerId);
    else qs.set('slug', slug);
    fetch(`${apiBaseUrl()}/api/public-store-stats?${qs.toString()}`)
      .then(r => r.json().then(d => ({ ok: r.ok, data: d })))
      .then(({ ok, data }) => {
        if (aborted) return;
        setState({ status: ok ? 'ok' : 'error', data: ok ? data : null });
      })
      .catch(() => {
        if (aborted) return;
        setState({ status: 'error', data: null });
      });
    return () => {
      aborted = true;
    };
  }, [sellerId, slug]);

  if (state.status !== 'ok' || !state.data) return null;

  const { rating, stats } = state.data;
  const hasRating = !!rating && rating.count > 0;
  const hasSalesStats = !!stats && stats.ordersTotal > 0;
  if (!hasRating && !hasSalesStats) return null;

  const classes = classNames(rootClassName || css.root, className);
  const monthsLabel = stats ? monthsToLabel(stats.memberMonths) : null;

  const ratingContent = hasRating ? (
    <>
      <StarRow average={rating.average} />
      <span className={css.ratingAvg}>{rating.average.toFixed(1)}</span>
      <span className={css.ratingCount}>
        ({rating.count} {rating.count === 1 ? 'reseña' : 'reseñas'})
      </span>
    </>
  ) : null;

  return (
    <div className={classes} aria-label="Estadísticas de la tienda">
      {hasRating ? (
        reviewsHref ? (
          <a
            href={reviewsHref}
            className={classNames(css.rating, css.ratingLink)}
            aria-label={`${rating.average.toFixed(1)} de 5 en ${rating.count} reseñas — ver reseñas`}
          >
            {ratingContent}
          </a>
        ) : (
          <span className={css.rating}>{ratingContent}</span>
        )
      ) : null}
      {hasSalesStats ? (
        <span className={css.sales}>
          <span className={css.salesValue}>{stats.ordersTotal}</span>{' '}
          {stats.ordersTotal === 1 ? 'venta' : 'ventas'}
          {monthsLabel ? ` · ${monthsLabel}` : null}
        </span>
      ) : null}
    </div>
  );
};

export default StoreHeaderStats;
