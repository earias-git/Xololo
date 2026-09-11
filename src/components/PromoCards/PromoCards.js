import React from 'react';
import classNames from 'classnames';

import css from './PromoCards.module.css';

// XOLOLO: fila de 3 tarjetas promocionales tipo MercadoLibre. Se usan para
// promocionar ofertas, novedades del marketplace y captar sellers desde el
// mismo landing. El contenido vive en src/config/promoCards.js y las tres
// variantes de color están definidas en el módulo CSS.
const variantClass = {
  amber: css.amber,
  green: css.green,
  navy: css.navy,
};

const PromoCards = props => {
  const { cards, className, rootClassName } = props;
  if (!cards?.length) return null;

  return (
    <section
      className={classNames(rootClassName || css.root, className)}
      aria-label="Promociones Xololo"
    >
      <div className={css.container}>
        <div className={css.grid}>
          {cards.map(card => (
            <a
              key={card.id}
              href={card.href}
              className={classNames(css.card, variantClass[card.variant] || css.navy)}
            >
              <span className={css.deco} aria-hidden="true" />
              {card.kicker ? <span className={css.kicker}>{card.kicker}</span> : null}
              <h3 className={css.title}>{card.title}</h3>
              {card.description ? (
                <p className={css.description}>{card.description}</p>
              ) : null}
              {card.cta ? (
                <span className={css.go}>
                  {card.cta} <span aria-hidden="true">→</span>
                </span>
              ) : null}
            </a>
          ))}
        </div>
      </div>
    </section>
  );
};

export default PromoCards;
