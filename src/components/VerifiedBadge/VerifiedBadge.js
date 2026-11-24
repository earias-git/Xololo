import React from 'react';
import classNames from 'classnames';

import xololoXMark from '../../assets/xololo-logo-mobile.png';
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
// XOLOLO 2026-11-23: refresh visual — el badge ahora usa la X oficial
// de Xololo (asset src/assets/xololo-logo-mobile.png) + "Verified"
// en navy sobre pastilla blanca con borde navy. La X es la marca
// y "Verified" es el estado. Aria-label mantiene el string completo
// "Xololo Verified" para lectores de pantalla.
//
// REGLA DE MARCA: el logo nunca se rota, invierte, filtra ni recrea.
// Si se requiere una variante del mark para un fondo distinto (mono
// blanco sobre navy), pedirlo a brand y añadirlo como asset separado.
//
// Uso:
//   <VerifiedBadge seller={sellerEntity} />
//   <VerifiedBadge verified={true} size="sm" />
//
// Si el seller no está verificado o no se pasa data suficiente, el
// componente devuelve null — no ocupa espacio si no aplica.

const isVerifiedFromSeller = seller =>
  seller?.attributes?.profile?.publicData?.xololoVerified === true;

const VerifiedBadge = props => {
  const {
    seller,
    verified,
    size = 'md',
    className,
    rootClassName,
    label = 'Verified',
    ariaLabel = 'Xololo Verified',
    showLabel = true,
    title = 'Vendedor verificado por Xololo: suscripción activa, cobros configurados y documentos legales aprobados.',
  } = props;

  const isVerified = typeof verified === 'boolean' ? verified : isVerifiedFromSeller(seller);
  if (!isVerified) return null;

  const classes = classNames(rootClassName || css.root, className, {
    [css.sizeSm]: size === 'sm',
    [css.sizeMd]: size === 'md',
    [css.sizeLg]: size === 'lg',
  });

  return (
    <span className={classes} title={title} aria-label={ariaLabel}>
      <img src={xololoXMark} alt="" aria-hidden="true" className={css.mark} />
      {showLabel ? <span className={css.label}>{label}</span> : null}
    </span>
  );
};

export default VerifiedBadge;
