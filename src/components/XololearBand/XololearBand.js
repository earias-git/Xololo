import React from 'react';
import classNames from 'classnames';
import { useSelector } from 'react-redux';

import xololearTools from '../../config/xololearTools';
import { isSellerUserType } from '../../util/userTypes';

import css from './XololearBand.module.css';

// XOLOLO: banda del verbo XOLOLEAR™ en el landing. Pivote del posicionamiento
// 2026-10-14: "xololear" = viralizar tus productos y tu tienda en RRSS y
// WhatsApp con un clic. Es el verbo propio de Xololo Promote.
//
// Nota de marca: el símbolo ™ está pendiente de registro IMPI (task #32).
// Mientras no tengamos acuse de recibo del INPI, lo renderizamos SIN ™.
// Para habilitarlo cuando el trámite inicie, cambiar la constante abajo.
const TRADEMARK_SYMBOL = ''; // cambiar a '™' cuando IMPI acuse recibo.

// CTA primario según estado del usuario:
//   - seller logueado → directo al dashboard de Xololear
//   - cualquier otro caso (visitante, buyer, user sin userType) → signup
// El label se adapta también para que un seller logueado no vea "ahora"
// (ya tiene cuenta) y entre con el verbo directo.
const buildCta = currentUser => {
  const userType = currentUser?.attributes?.profile?.publicData?.userType;
  if (currentUser && isSellerUserType(userType)) {
    return { href: '/dashboard?section=promote', label: 'Xololear mis productos' };
  }
  return { href: '/signup?utm_source=xololear', label: 'Xololear ahora' };
};

const XololearBand = props => {
  const { className, rootClassName } = props;
  const currentUser = useSelector(state => state.user?.currentUser);
  const cta = buildCta(currentUser);

  return (
    <section className={classNames(rootClassName || css.root, className)} aria-label="Xololear">
      <div className={css.container}>
        <div className={css.band}>
          <header className={css.header}>
            <p className={css.eyebrow}>
              Social Sellers — Vendedores en redes <span aria-hidden="true">🔥</span>
            </p>
            <h2 className={css.title}>
              <span className={css.verb}>Xololéalo{TRADEMARK_SYMBOL}.</span> Viraliza tus productos
              en 1 clic.
            </h2>
            <p className={css.description}>
              QR, link profesional, botón Comprar y plantillas listas para IG Stories, WhatsApp
              Status y bio de TikTok. Deja de perseguir clientes — que los clientes vengan a ti.
            </p>
          </header>

          <ul className={css.tools}>
            {xololearTools.map(t => (
              <li key={t.id} className={css.tool}>
                <span className={css.ring}>{t.icon}</span>
                <div className={css.toolCopy}>
                  <span className={css.toolTitle}>{t.title}</span>
                  <span className={css.toolDesc}>{t.description}</span>
                </div>
              </li>
            ))}
          </ul>

          <div className={css.ctas}>
            <a className={css.ctaPrimary} href={cta.href}>
              {cta.label}
              <span aria-hidden="true"> →</span>
            </a>
            <a className={css.ctaSecondary} href="/p/como-funciona">
              Cómo funciona
            </a>
          </div>
        </div>
      </div>
    </section>
  );
};

export default XololearBand;
