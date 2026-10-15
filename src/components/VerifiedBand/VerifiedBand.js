import React from 'react';
import classNames from 'classnames';

import css from './VerifiedBand.module.css';

// XOLOLO: banda del sello Xololo Verified™. Explica los 4 criterios reales
// que un seller cumple para obtener el badge (identidad, documentos legales,
// cuenta de cobros y suscripción activa) y ofrece dos CTAs: una para sellers
// que quieren verificarse y otra para buyers que quieren filtrar tiendas
// verificadas en el marketplace.
//
// Prop `hideCtas`: oculta ambos CTAs. Lo usamos cuando la banda vive dentro
// del storefront de un seller — ahí sacar al buyer hacia /s?pub_verified=true
// o /p/verified#seller rompe la narrativa de "estás en esta tienda". El bloque
// se queda como pieza puramente informativa que respalda la confianza del
// seller actual, sin links que redirijan fuera.
//
// Los criterios aquí deben mantenerse alineados con la lógica real que
// calcula el badge en el server: server/api-util/sellerVerified.js.
const VerifiedBand = props => {
  const { className, rootClassName, hideCtas = false } = props;

  const criteria = [
    {
      id: 'identidad',
      title: 'Identidad validada',
      description: 'INE, CURP y RFC verificados contra fuentes oficiales',
      icon: (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c1.4-4 5-6 8-6s6.6 2 8 6" />
          <path d="M15.5 7.5l1.5 1.5 3-3" />
        </>
      ),
    },
    {
      id: 'documentos',
      title: 'Documentos aprobados',
      description:
        'Constancia fiscal, acta constitutiva (si moral) y RFC vigente, revisados por Xololo',
      icon: (
        <>
          <path d="M7 3h7l4 4v14H7z" />
          <path d="M14 3v4h4" />
          <path d="M9.5 14l2 2 3.5-4" />
        </>
      ),
    },
    {
      id: 'cobros',
      title: 'Cuenta de cobros',
      description:
        'Pagos a cuenta bancaria registrada — no a cuenta personal desconocida',
      icon: (
        <>
          <path d="M3 10l9-6 9 6" />
          <path d="M5 10v9h14v-9" />
          <path d="M9 19v-6h6v6" />
        </>
      ),
    },
    {
      id: 'suscripcion',
      title: 'Negocio activo',
      description: 'Suscripción vigente — no un vendedor fantasma',
      icon: (
        <>
          <path d="M4 12l5 5L20 6" />
          <circle cx="12" cy="12" r="10" />
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
          <header className={css.header}>
            <p className={css.eyebrow}>Confianza bidireccional</p>
            <h2 className={css.title}>
              Xololo Verified™ — el sello que respalda cada compra
            </h2>
            <p className={css.description}>
              Cada vendedor con este sello pasó por 4 filtros antes de ponerle un
              producto frente a tus ojos. Para el comprador, es la garantía de
              que compra sin miedo. Para el vendedor, es la razón por la que su
              conversión sube.
            </p>
          </header>

          <ul className={css.criteria}>
            {criteria.map(c => (
              <li key={c.id} className={css.criterion}>
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
                    {c.icon}
                  </svg>
                </span>
                <div className={css.criterionCopy}>
                  <span className={css.criterionTitle}>{c.title}</span>
                  <span className={css.criterionDesc}>{c.description}</span>
                </div>
              </li>
            ))}
          </ul>

          {hideCtas ? null : (
            <div className={css.ctas}>
              {/* 3 filtros rápidos para el comprador. "Ver tiendas" hoy va
                  al mismo listing filtrado por verified — pendiente un
                  directorio real /tiendas-verified con cards de storefront. */}
              <div className={css.ctasBuyer}>
                <a
                  className={css.ctaSecondary}
                  href="/s?pub_verified=true&pub_listingType=product"
                >
                  Ver productos
                </a>
                <a
                  className={css.ctaSecondary}
                  href="/s?pub_verified=true&pub_listingType=service,service-day"
                >
                  Ver servicios
                </a>
                <a className={css.ctaSecondary} href="/tiendas-verified">
                  Ver tiendas
                </a>
              </div>
              {/* CTA del vendedor: separado para que no compita visualmente
                  con los 3 filtros de arriba. */}
              <a className={css.ctaPrimary} href="/p/verified#seller">
                Quiero el sello Verified
                <span aria-hidden="true"> →</span>
              </a>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default VerifiedBand;
