import React from 'react';

import { NamedLink } from '../../components';

import css from './OpenStoreBanner.module.css';

// XOLOLO: feedback de earias (b.1) tras navegar el sitio — mensaje
// motivador para que un comprador considere abrir su tienda. Sólo se
// muestra si el user todavía NO configuró su tienda (sin slug) — una
// vez que empieza ese proceso, deja de tener sentido seguir
// "invitándolo", el reloj de avance (AccountProgressClock) toma el
// relevo como guía.
const OpenStoreBanner = ({ currentUser }) => {
  const hasStore = !!currentUser?.attributes?.profile?.publicData?.slug;
  if (hasStore) return null;

  return (
    <section className={css.root}>
      <div className={css.text}>
        <h3 className={css.title}>Abre tu Tienda Virtual Xololo</h3>
        <p className={css.subtitle}>
          Es fácil y de bajo costo — ¡sin comisiones por venta!
        </p>
      </div>
      <NamedLink name="ManageStorePage" className={css.cta}>
        Abrir mi tienda →
      </NamedLink>
    </section>
  );
};

export default OpenStoreBanner;
