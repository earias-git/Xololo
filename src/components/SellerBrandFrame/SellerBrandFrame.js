import React from 'react';
import { useSelector } from 'react-redux';
import { Helmet } from 'react-helmet-async';
import classNames from 'classnames';

import { selectCartItemCount } from '../../ducks/cart.duck';

import VerifiedBadge from '../VerifiedBadge/VerifiedBadge';

// XOLOLO Web Studio PR 5b: tokens del tema aplicados también al wrapper
// transaccional (checkout, transaction, order). Mismo opt-in estricto
// que StorefrontPage: sellers sin storefrontTheme renderean 1:1 como
// antes (cero regresión).
import { themeToCssVars, buildGoogleFontsHref } from '../../util/xololoStorefrontThemes';

import css from './SellerBrandFrame.module.css';

// XOLOLO: contenedor que aplica el branding del SELLER (colores, logo)
// en las páginas transaccionales (Checkout, TransactionPage, OrderDetails).
// Los colores del seller vienen de publicData.brandPrimaryColor /
// brandSecondaryColor y se inyectan como CSS variables al root:
//
//   --xololo-brand-primary
//   --xololo-brand-secondary
//   --marketplaceColor              ← override global (para que botones,
//                                     links, focus rings, etc. usen el
//                                     color del seller sin cambiar CSS
//                                     de componentes downstream)
//
// El header muestra el logo del seller GRANDE + "Powered by Xololo"
// chico a la derecha. El footer muestra el logo Xololo compacto +
// mensaje de "Envíos por paquetería asegurados hasta $100,000" + link a xololo.mx.
//
// Uso:
//   <SellerBrandFrame seller={seller}>
//     <MainContent />
//   </SellerBrandFrame>
//
// Si `seller` es null o no tiene colores/logo, cae en el branding default
// de Xololo (no aplica overrides).

const buildSellerStyle = seller => {
  const pd = seller?.attributes?.profile?.publicData || {};
  const primary = pd.brandPrimaryColor;
  const secondary = pd.brandSecondaryColor;
  if (!primary) return null;
  // XOLOLO Web Studio PR 5b: si el seller eligió un tema, inyectamos
  // también las CSS vars tipográficas (--xf-heading-font/--xf-body-font).
  // Sin tema → solo colores legacy, cero cambios.
  const themeId = pd.storefrontTheme || null;
  const themeCssVars = themeId ? themeToCssVars(themeId).cssVars : {};
  return {
    '--xololo-brand-primary': primary,
    '--xololo-brand-secondary': secondary || primary,
    '--marketplaceColor': primary,
    '--marketplaceColorLight': secondary || primary,
    '--marketplaceColorDark': primary,
    ...themeCssVars,
  };
};

const getSellerHref = (seller, storefrontRootUrl) => {
  const pd = seller?.attributes?.profile?.publicData || {};
  const slug = pd.slug;
  if (!slug) return '/';
  if (typeof window !== 'undefined' && /localhost/.test(window.location.hostname)) {
    return `http://${slug}.localhost:3000`;
  }
  return `https://${slug}.xololo.mx`;
};

const SellerBrandFrame = ({ seller, children, className, showFooter = true }) => {
  const style = buildSellerStyle(seller);
  const pd = seller?.attributes?.profile?.publicData || {};
  const logo = pd.logoUrl;
  const name = seller?.attributes?.profile?.displayName || 'Tienda';
  const href = getSellerHref(seller);
  const hasBranding = !!style;
  const sellerId = seller?.id?.uuid;

  // XOLOLO Cart.3: contador de items del carrito de ESTE seller (si aplica).
  // Si es null/0 no mostramos el ícono.
  const cartCount = useSelector(sellerId ? selectCartItemCount(sellerId) : () => 0);

  if (!hasBranding) {
    // Sin branding del seller no envolvemos nada — dejamos que la página
    // renderee normalmente con el branding default de Xololo.
    return <>{children}</>;
  }

  const cartHref = sellerId ? `/cart/${sellerId}` : '/cart';

  // XOLOLO Web Studio PR 5b: Google Fonts link vía Helmet (SSR-safe).
  // Solo si el seller eligió tema — evita cargar CSS externo para
  // sellers sin tema.
  const storefrontTheme = pd.storefrontTheme || null;
  const fontsHref = storefrontTheme ? buildGoogleFontsHref(storefrontTheme) : null;

  return (
    <div
      className={classNames(css.root, className)}
      style={style || undefined}
      data-themed={storefrontTheme ? 'true' : undefined}
    >
      {fontsHref ? (
        <Helmet>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link rel="stylesheet" href={fontsHref} />
        </Helmet>
      ) : null}
      <header className={css.header}>
        <a href={href} className={css.brand}>
          {logo ? (
            <img src={logo} alt={name} className={css.logo} />
          ) : (
            <span className={css.brandFallback}>{name}</span>
          )}
          {/* XOLOLO P3: badge Xololo Verified, se auto-oculta si no aplica. */}
          <VerifiedBadge seller={seller} size="sm" className={css.brandVerified} />
        </a>
        <div className={css.headerRight}>
          {cartCount > 0 ? (
            <a href={cartHref} className={css.cartBtn} aria-label={`Carrito (${cartCount} items)`}>
              🛒
              <span className={css.cartBadge}>{cartCount}</span>
              <span className={css.cartLabel}>Ver carrito</span>
            </a>
          ) : null}
          <a href="https://xololo.mx" className={css.poweredBy}>
            <span className={css.poweredByLabel}>Powered by</span>
            <strong className={css.poweredByBrand}>Xololo</strong>
          </a>
        </div>
      </header>

      <div className={css.content}>{children}</div>

      {showFooter ? (
        <footer className={css.footer}>
          <div className={css.footerInner}>
            <div className={css.footerCol}>
              <a href="https://xololo.mx" className={css.footerBrand}>
                Xololo<sup>®</sup>
              </a>
              <p className={css.footerTag}>Marca registrada · Único sitio oficial: xololo.mx</p>
            </div>
            <div className={css.footerCol}>
              <p className={css.footerBenefit}>
                🛡️ <strong>Envíos por paquetería asegurados hasta $100,000</strong>
              </p>
              <p className={css.footerBenefitSub}>
                Los envíos por paquetería contratados a través de Xololo (Skydropx) incluyen SOS
                Protección: si el paquete se pierde o llega dañado, te devolvemos tu dinero. No
                aplica a recolección en domicilio, envío local ni flete.
              </p>
            </div>
          </div>
        </footer>
      ) : null}
    </div>
  );
};

export default SellerBrandFrame;
