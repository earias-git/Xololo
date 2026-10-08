import React from 'react';
import NamedLink from '../NamedLink/NamedLink';

import css from './SmartSearchCta.module.css';

// XOLOLO Fase 2 — Banner discreto en el landing que invita al buyer a
// probar la búsqueda semántica con IA (F2-12). CTA pequeño pero visible,
// enlaza a /buscar-ia.

const SmartSearchCta = () => (
  <section className={css.wrapper} aria-label="Búsqueda con IA">
    <NamedLink name="SmartSearchPage" className={css.card}>
      <div className={css.left}>
        <span className={css.sparkle} aria-hidden="true">✨</span>
        <div>
          <h3 className={css.title}>Prueba el buscador con IA</h3>
          <p className={css.subtitle}>
            Describe lo que buscas con tus palabras y nuestra IA encuentra los
            productos y servicios más relevantes.
          </p>
        </div>
      </div>
      <span className={css.cta}>Buscar →</span>
    </NamedLink>
  </section>
);

export default SmartSearchCta;
