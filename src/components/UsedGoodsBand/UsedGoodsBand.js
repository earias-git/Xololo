import React from 'react';
import classNames from 'classnames';
import { useSelector } from 'react-redux';

import { isCasualReseller } from '../../util/xololoSellerMode';

import css from './UsedGoodsBand.module.css';

// XOLOLO: banda del landing que invita a particulares a vender sus
// artículos usados en Xololo. Verde pastel para consistencia con el
// badge "Vendedor casual" del perfil público; distinto en tono del
// XololearBand (coral) y VerifiedBand (navy) para no competir.
//
// CTA primario:
//   - Visitante o buyer → signup pre-seleccionando sellerMode casual.
//   - Seller store ya logueado → "Añadir modo casual" (link a Settings
//     donde puede cambiar perfil fiscal, aunque hoy no es flujo típico).
//   - Casual logueado → "Publicar mi usado" directo al wizard.

const buildCta = currentUser => {
  if (currentUser && isCasualReseller(currentUser)) {
    return { href: '/l/new', label: 'Publicar mi usado' };
  }
  if (currentUser) {
    // XOLOLO: buyer logueado — página puente que activa modo casual con
    // 1 click + T&C, luego redirige al wizard de nuevo listing.
    return { href: '/promote-to-casual', label: 'Publicar mi usado' };
  }
  return {
    href: '/signup?sellerMode=casual_reseller&utm_source=used_band',
    label: 'Empezar a vender',
  };
};

const FEATURES = [
  {
    id: 'no-fee',
    title: 'Sin suscripción',
    description: 'No tienes tienda ni pagas mensualidad. Vendes y punto.',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M8 12l3 3 5-6" />
      </svg>
    ),
  },
  {
    id: 'protected-pay',
    title: 'Pago protegido',
    description: 'Xololo retiene el pago hasta que la persona reciba el producto.',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" />
      </svg>
    ),
  },
  {
    id: 'no-tax',
    title: 'Sin IVA ni ISR',
    description: 'Venta particular por Art. 9 fracc. IV LIVA. Recibes el 100% menos la comisión.',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 8h16" />
        <path d="M6 8v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8" />
        <path d="M9 8V5a3 3 0 0 1 6 0v3" />
      </svg>
    ),
  },
  {
    id: 'antifraud',
    title: 'Antifraude',
    description: 'Validación de identidad del vendedor y del comprador. Cuidamos ambos lados.',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </svg>
    ),
  },
];

const UsedGoodsBand = props => {
  const { className, rootClassName } = props;
  const currentUser = useSelector(state => state.user?.currentUser);
  const cta = buildCta(currentUser);

  return (
    <section
      className={classNames(rootClassName || css.root, className)}
      aria-label="Vender artículos usados"
    >
      <div className={css.container}>
        <div className={css.band}>
          <header className={css.header}>
            <p className={css.eyebrow}>Vendedores casuales — Segunda mano</p>
            <h2 className={css.title}>
              Vende lo que ya no usas{' '}
              <span className={css.titleAccent}>— sin tienda, sin cobro mensual</span>
            </h2>
            <p className={css.description}>
              Publica tu bici, cámara o lo que sea en 3 fotos. Xololo retiene el pago hasta que la
              persona reciba el producto. Y por tratarse de venta particular ocasional, no cargamos
              IVA ni retenemos ISR.
            </p>
          </header>

          <ul className={css.features}>
            {FEATURES.map(f => (
              <li key={f.id} className={css.feature}>
                <span className={css.ring}>{f.icon}</span>
                <div className={css.featureCopy}>
                  <span className={css.featureTitle}>{f.title}</span>
                  <span className={css.featureDesc}>{f.description}</span>
                </div>
              </li>
            ))}
          </ul>

          <div className={css.ctas}>
            <a className={css.ctaPrimary} href={cta.href}>
              {cta.label}
              <span aria-hidden="true"> →</span>
            </a>
            <a className={css.ctaSecondary} href="/p/como-vender-segunda-mano">
              Cómo funciona
            </a>
          </div>
        </div>
      </div>
    </section>
  );
};

export default UsedGoodsBand;
