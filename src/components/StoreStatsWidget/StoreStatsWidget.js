import React, { useEffect, useState } from 'react';
import classNames from 'classnames';

import { apiBaseUrl } from '../../util/api';

import css from './StoreStatsWidget.module.css';

// XOLOLO F3 · Fase 4: widget público con "prueba social" de un seller.
// Se monta en la StorefrontPage ({slug}.xololo.mx) y muestra:
//   - # de pedidos entregados
//   - # de unidades vendidas
//   - Meses en la plataforma
//   - Sello "Vendedor verificado Xololo" cuando aplica
//
// Sólo aparece si el seller cumple el threshold (≥5 ventas). Antes de
// eso, no se renderiza — no queremos exponer "0 vendidos" que
// desincentivaría al buyer.
//
// Props:
//   sellerId?: uuid          uno de los dos requerido
//   slug?: string
//   className?, rootClassName?
//   variant?: 'card' (default) | 'inline'   estilo visual

const monthsToLabel = m => {
  if (m < 1) return 'Nuevo en Xololo';
  if (m < 12) return `${m} ${m === 1 ? 'mes' : 'meses'} en Xololo`;
  const years = Math.floor(m / 12);
  return `${years} ${years === 1 ? 'año' : 'años'} en Xololo`;
};

const StoreStatsWidget = ({
  sellerId,
  slug,
  className,
  rootClassName,
  variant = 'card',
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
        if (!ok) {
          setState({ status: 'error', data: null });
          return;
        }
        setState({ status: 'ok', data });
      })
      .catch(() => {
        if (aborted) return;
        setState({ status: 'error', data: null });
      });
    return () => {
      aborted = true;
    };
  }, [sellerId, slug]);

  // Silencioso durante loading — evita layout shift antes del render.
  if (state.status !== 'ok') return null;

  const { eligible, seller, stats } = state.data;
  if (!eligible || !stats) return null;

  const classes = classNames(rootClassName || css.root, className, {
    [css.inline]: variant === 'inline',
  });

  return (
    <section className={classes} aria-label={`Estadísticas de ${seller.name}`}>
      {stats.verified ? (
        <div className={css.verifiedBadge}>
          <span className={css.verifiedIcon} aria-hidden>
            ✓
          </span>
          Vendedor verificado por Xololo
        </div>
      ) : null}
      <div className={css.metrics}>
        <div className={css.metric}>
          <p className={css.metricValue}>{stats.ordersTotal.toLocaleString('es-MX')}</p>
          <p className={css.metricLabel}>
            {stats.ordersTotal === 1 ? 'venta' : 'ventas'}
          </p>
        </div>
        <div className={css.metric}>
          <p className={css.metricValue}>{stats.productsSold.toLocaleString('es-MX')}</p>
          <p className={css.metricLabel}>
            {stats.productsSold === 1 ? 'producto vendido' : 'productos vendidos'}
          </p>
        </div>
        <div className={css.metric}>
          <p className={css.metricValue}>{monthsToLabel(stats.memberMonths)}</p>
          <p className={css.metricLabel}>antigüedad</p>
        </div>
      </div>
      <p className={css.foot}>🛡️ Cada compra en Xololo está protegida hasta $100,000 MXN.</p>
    </section>
  );
};

export default StoreStatsWidget;
