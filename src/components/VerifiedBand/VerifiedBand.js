import React from 'react';
import classNames from 'classnames';

import css from './VerifiedBand.module.css';

// XOLOLO: banda promocional del sello Xololo Verified™. Muestra el pitch de
// confianza a la izquierda y cuatro mini badges (Verificado, Confiable,
// Seguro, Negocio real) a la derecha.
const VerifiedBand = props => {
  const { className, rootClassName } = props;

  const badges = [
    {
      id: 'verificado',
      label: 'Verificado',
      icon: (
        <path d="M4 12l5 5L20 6" />
      ),
    },
    {
      id: 'confiable',
      label: 'Confiable',
      icon: (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c1.4-4 5-6 8-6s6.6 2 8 6" />
        </>
      ),
    },
    {
      id: 'seguro',
      label: 'Seguro',
      icon: (
        <>
          <rect x="5" y="10" width="14" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </>
      ),
    },
    {
      id: 'negocio-real',
      label: 'Negocio real',
      icon: (
        <>
          <path d="M4 21V10l8-6 8 6v11" />
          <path d="M9 21v-6h6v6" />
        </>
      ),
    },
  ];

  return (
    <section
      className={classNames(rootClassName || css.root, className)}
      aria-label="Xololo Verified"
    >
      <div className={css.container}>
        <div className={css.band}>
          <div className={css.copy}>
            <p className={css.eyebrow}>Confianza</p>
            <h2 className={css.title}>Compra y vende con Xololo Verified™</h2>
            <p className={css.description}>
              El sello que confirma que un negocio cumple, es confiable y es real
              — visible en cada listing y en el storefront del seller.
            </p>
          </div>
          <ul className={css.badges}>
            {badges.map(b => (
              <li key={b.id} className={css.badge}>
                <span className={css.ring}>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    {b.icon}
                  </svg>
                </span>
                <span className={css.label}>{b.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
};

export default VerifiedBand;
