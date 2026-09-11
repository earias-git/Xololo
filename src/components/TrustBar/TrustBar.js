import React from 'react';
import classNames from 'classnames';

import css from './TrustBar.module.css';

// XOLOLO: banda horizontal de credibilidad, justo debajo del hero.
// Muestra cuatro promesas del marketplace (pago protegido, envíos, negocios
// mexicanos, WhatsApp). El contenido vive en src/config/trustItems.js.
const TrustBar = props => {
  const { items, className, rootClassName } = props;
  if (!items?.length) return null;

  return (
    <section
      className={classNames(rootClassName || css.root, className)}
      aria-label="Compromisos Xololo"
    >
      <ul className={css.list}>
        {items.map(item => (
          <li key={item.id} className={css.item}>
            <span className={css.icon}>{item.icon}</span>
            <span className={css.textCol}>
              <span className={css.title}>{item.title}</span>
              {item.description ? (
                <span className={css.description}>{item.description}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default TrustBar;
