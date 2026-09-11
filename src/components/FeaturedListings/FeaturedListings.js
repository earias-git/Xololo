import React from 'react';
import classNames from 'classnames';

import css from './FeaturedListings.module.css';

// XOLOLO: grid de 6 listings destacados (productos o servicios). Cuando el
// `kind` es 'product', cada tarjeta muestra el precio y el badge "Pago
// protegido"; cuando es 'service', muestra "Desde $X" y un botón "Reservar".
// La imagen es un bloque de color por ahora (usamos una paleta declarada en
// el CSS via data-tone) hasta que existan listings reales con fotos.

const currencyMXN = new Intl.NumberFormat('es-MX', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const StarIcon = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" className={css.starIcon}>
    <path d="M10 1l2.6 5.9 6.4.6-4.8 4.3 1.4 6.3L10 14.9 4.4 18.1l1.4-6.3L1 7.5l6.4-.6z" />
  </svg>
);

const HeartIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={css.heartIcon}>
    <path d="M12 21s-7-4.6-9.3-9A5.3 5.3 0 0 1 12 6a5.3 5.3 0 0 1 9.3 6c-2.3 4.4-9.3 9-9.3 9Z" />
  </svg>
);

const ShieldIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={css.protectIcon}>
    <path d="M4 12l5 5L20 6" />
  </svg>
);

const FeaturedListings = props => {
  const { title, seeAllLabel, seeAllHref, items, className, rootClassName } = props;
  if (!items?.length) return null;

  return (
    <section
      className={classNames(rootClassName || css.root, className)}
      aria-label={title}
    >
      <div className={css.container}>
        <div className={css.header}>
          <h2 className={css.title}>{title}</h2>
          {seeAllHref ? (
            <a href={seeAllHref} className={css.seeAll}>
              {seeAllLabel || 'Ver todos'} →
            </a>
          ) : null}
        </div>
        <ul className={css.grid}>
          {items.map(item => (
            <li key={item.id} className={css.item}>
              <a href={item.href || '#'} className={css.card}>
                <div className={css.thumb} data-tone={item.tone || 'sand'}>
                  <span className={css.heartBadge} aria-label="Guardar en favoritos">
                    <HeartIcon />
                  </span>
                </div>
                <div className={css.body}>
                  <span className={css.name}>{item.name}</span>
                  {item.seller ? (
                    <span className={css.seller}>{item.seller}</span>
                  ) : null}
                  {typeof item.rating === 'number' ? (
                    <span className={css.rating}>
                      <StarIcon />
                      <span className={css.ratingText}>
                        {item.rating.toFixed(1)}
                        {item.reviewCount ? ` (${item.reviewCount})` : null}
                      </span>
                    </span>
                  ) : null}
                  {typeof item.price === 'number' ? (
                    <span className={css.price}>
                      {item.priceUnit ? `${item.priceUnit} ` : ''}${currencyMXN.format(item.price)}
                    </span>
                  ) : null}
                  {item.kind === 'product' ? (
                    <span className={css.protectedRow}>
                      <ShieldIcon />
                      <span>Pago protegido</span>
                    </span>
                  ) : (
                    <span className={css.reserveButton}>Reservar</span>
                  )}
                </div>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

export default FeaturedListings;
