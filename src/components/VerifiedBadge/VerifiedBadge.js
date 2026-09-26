import React from 'react';
import classNames from 'classnames';

import css from './VerifiedBadge.module.css';

// XOLOLO P3: badge "Xololo Verified" — señal de confianza para el
// buyer.
//
// Un seller es "verificado" cuando cumple TODOS los criterios de
// server/api-util/sellerVerified.js (suscripción activa + payouts +
// perfil completo + documentos legales aprobados). El servidor
// mirror-ea el resultado a `publicData.xololoVerified` para que la
// UI pueda leerlo sin exponer metadata privada.
//
// Uso:
//   <VerifiedBadge seller={sellerEntity} />
//   <VerifiedBadge verified={true} size="sm" />
//
// Si el seller no está verificado o no se pasa data suficiente, el
// componente devuelve null — no ocupa espacio si no aplica.

const CheckIcon = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

const isVerifiedFromSeller = seller =>
  seller?.attributes?.profile?.publicData?.xololoVerified === true;

const VerifiedBadge = props => {
  const {
    seller,
    verified,
    size = 'md',
    className,
    rootClassName,
    label = 'Xololo Verified',
    showLabel = true,
    title = 'Vendedor verificado por Xololo: suscripción activa, cobros configurados y documentos legales aprobados.',
  } = props;

  const isVerified =
    typeof verified === 'boolean' ? verified : isVerifiedFromSeller(seller);
  if (!isVerified) return null;

  const classes = classNames(rootClassName || css.root, className, {
    [css.sizeSm]: size === 'sm',
    [css.sizeMd]: size === 'md',
    [css.sizeLg]: size === 'lg',
  });

  return (
    <span className={classes} title={title} aria-label={label}>
      <span className={css.check} aria-hidden="true">
        <CheckIcon className={css.checkIcon} />
      </span>
      {showLabel ? <span className={css.label}>{label}</span> : null}
    </span>
  );
};

export default VerifiedBadge;
