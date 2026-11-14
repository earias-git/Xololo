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

// XOLOLO 2026-11-14: iconos inline de las redes sociales que la card
// Xololéalo promociona. Se mantienen aquí (no en /components/Icon*) para
// no inflar el bundle de la Topbar; solo los usa el landing.
//
// Si agregas una red más, apunta al glyph común (Simple Icons o similar).
// currentColor hereda del css del card.
const SocialGlyph = ({ name }) => {
  switch (name) {
    case 'instagram':
      return (
        <svg viewBox="0 0 24 24" aria-label="Instagram" role="img">
          <rect x="3" y="3" width="18" height="18" rx="5" ry="5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="17.5" cy="6.5" r="1.1" fill="currentColor" />
        </svg>
      );
    case 'facebook':
      return (
        <svg viewBox="0 0 24 24" aria-label="Facebook" role="img">
          <path
            d="M13.5 22v-8h2.7l.4-3.1h-3.1V8.9c0-.9.3-1.5 1.5-1.5h1.6V4.6c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 3.9v2.5H7.8V14h2.6v8h3.1z"
            fill="currentColor"
          />
        </svg>
      );
    case 'tiktok':
      return (
        <svg viewBox="0 0 24 24" aria-label="TikTok" role="img">
          <path
            d="M16.7 2h-2.9v12.4a2.4 2.4 0 1 1-2.4-2.4c.3 0 .5 0 .8.1V9.2a5.5 5.5 0 1 0 4.5 5.4V8.5c1 .8 2.3 1.2 3.6 1.2V6.8c-2 0-3.6-1.6-3.6-3.6V2z"
            fill="currentColor"
          />
        </svg>
      );
    case 'whatsapp':
      return (
        <svg viewBox="0 0 24 24" aria-label="WhatsApp" role="img">
          <path
            d="M12 2.5A9.5 9.5 0 0 0 3.7 16.8L2.5 21.5l4.8-1.2A9.5 9.5 0 1 0 12 2.5zm5.1 13.4c-.2.6-1.2 1.1-1.7 1.2-.4.1-1 .1-1.6-.1-.4-.1-.9-.3-1.5-.5-2.6-1.1-4.3-3.7-4.4-3.9-.1-.2-1-1.4-1-2.7 0-1.3.7-1.9.9-2.2.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.4.2.5.7 1.8.8 1.9.1.1.1.3 0 .4-.1.2-.2.3-.3.5-.1.2-.3.3-.4.5-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2 1.1.9 2.1 1.3 2.4 1.4.3.1.5.1.6-.1.2-.2.7-.8.9-1.1.2-.3.4-.2.6-.1.3.1 1.7.8 2 .9.3.1.5.2.6.3.1.1.1.6-.1 1.2z"
            fill="currentColor"
          />
        </svg>
      );
    case 'x':
    case 'twitter':
      return (
        <svg viewBox="0 0 24 24" aria-label="X" role="img">
          <path
            d="M14.3 10.5 21.2 2.5h-1.9l-6 7-4.8-7H3l7.3 10.5L3 21.5h1.9l6.3-7.4 5.1 7.4H21l-6.7-11zm-2.2 2.6-.7-1-5.9-8.3h2.7l4.7 6.7.7 1 6.1 8.7h-2.7l-4.9-7z"
            fill="currentColor"
          />
        </svg>
      );
    default:
      return null;
  }
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
              {card.description ? <p className={css.description}>{card.description}</p> : null}
              {/* XOLOLO 2026-11-14: iconos de redes sociales cuando la
                card es la de Xololéalo. Arriba del CTA para que el buyer
                asocie el valor visualmente antes de leer. */}
              {Array.isArray(card.socialIcons) && card.socialIcons.length ? (
                <span className={css.socialIcons} aria-hidden="true">
                  {card.socialIcons.map(name => (
                    <span key={name} className={css.socialIcon}>
                      <SocialGlyph name={name} />
                    </span>
                  ))}
                </span>
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
