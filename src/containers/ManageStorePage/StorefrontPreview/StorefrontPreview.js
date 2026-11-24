import React, { useEffect, useState } from 'react';
import classNames from 'classnames';

import { themeToCssVars, buildGoogleFontsHref } from '../../../util/xololoStorefrontThemes';

import css from './StorefrontPreview.module.css';

// XOLOLO Web Studio PR 1 → PR 4 — preview en vivo del storefront.
//
// PR 1: visualización de colores + logo + banner desde el form.
// PR 4: también lee `storefrontTheme`. El tema controla:
//   - Fuentes (Google Fonts cargadas al vuelo cuando cambia el tema)
//   - Variante de hero: gradient / solid / minimal / editorial
//   - Radio de cards
// Cuando el seller no ha elegido tema cae a DEFAULT_TOKENS (sans serif,
// hero gradient, radio 6px) — compatible 1:1 con el preview del PR 1.
//
// Google Fonts loading: inyectamos un <link rel="stylesheet"> en el
// <head> y lo swappeamos cuando cambia el tema. Es un side effect
// controlado — si el seller está offline o el CDN está caído, el
// browser cae al fallback de la CSS var (system-ui / sans-serif).

const SAMPLE_LISTINGS = [
  {
    id: 'sample-1',
    title: 'Pieza ejemplo 1',
    price: '$890',
    gradient: 'linear-gradient(135deg, #d4a574 0%, #8b5a3c 60%, #5a3620 100%)',
  },
  {
    id: 'sample-2',
    title: 'Pieza ejemplo 2',
    price: '$1,450',
    gradient: 'linear-gradient(135deg, #a89885 0%, #6b5d4a 60%, #3d3425 100%)',
  },
  {
    id: 'sample-3',
    title: 'Pieza ejemplo 3',
    price: '$620',
    gradient: 'linear-gradient(135deg, #e8c08b 0%, #b5844a 60%, #7a5428 100%)',
  },
];

const initials = str =>
  String(str || 'TU')
    .trim()
    .split(/\s+/)
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'TU';

// Inyecta (o actualiza) el <link> que carga las fuentes del tema.
// Reutilizamos UN SOLO <link> con id fijo para no acumular N tags al
// cambiar de tema iterativamente.
const FONT_LINK_ID = 'xololo-storefront-preview-fonts';
const useThemeFontLink = themeId => {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const href = buildGoogleFontsHref(themeId);
    let link = document.getElementById(FONT_LINK_ID);
    if (!link) {
      link = document.createElement('link');
      link.id = FONT_LINK_ID;
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    if (link.href !== href) link.href = href;
    // No limpiamos al unmount — el seller puede volver y queremos
    // que la fuente siga cacheada. El link es inocuo si no se usa.
    return undefined;
  }, [themeId]);
};

const StorefrontPreview = props => {
  const {
    brandPrimaryColor,
    brandSecondaryColor,
    logoUrl,
    bannerUrl,
    slug,
    storeName,
    storefrontTheme,
    className,
  } = props;
  const [viewport, setViewport] = useState('desktop');

  useThemeFontLink(storefrontTheme);

  const primary = brandPrimaryColor || '#1f8f52';
  const secondary = brandSecondaryColor || '#6bcb8c';
  const displayName = storeName || slug || 'Tu tienda';

  const { cssVars, heroVariant } = themeToCssVars(storefrontTheme);

  // CSS vars del tema + colores del branding (viejos --preview-primary).
  const frameStyle = {
    '--preview-primary': primary,
    '--preview-secondary': secondary,
    ...cssVars,
  };

  return (
    <aside className={classNames(css.root, className)} aria-label="Preview de tu tienda">
      <header className={css.head}>
        <div className={css.headCopy}>
          <span className={css.eyebrow}>Preview en vivo</span>
          <h3 className={css.title}>Así se verá tu tienda</h3>
        </div>
        <div className={css.viewportToggle} role="tablist" aria-label="Tamaño del preview">
          <button
            type="button"
            role="tab"
            aria-selected={viewport === 'mobile'}
            className={classNames(css.vpBtn, { [css.vpBtnActive]: viewport === 'mobile' })}
            onClick={() => setViewport('mobile')}
          >
            Mobile
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewport === 'desktop'}
            className={classNames(css.vpBtn, { [css.vpBtnActive]: viewport === 'desktop' })}
            onClick={() => setViewport('desktop')}
          >
            Desktop
          </button>
        </div>
      </header>

      <div
        className={classNames(css.frame, {
          [css.frameMobile]: viewport === 'mobile',
          [css.frameDesktop]: viewport === 'desktop',
        })}
        data-hero={heroVariant}
        style={frameStyle}
      >
        <div className={css.storefrontHeader}>
          {logoUrl ? (
            <img src={logoUrl} alt="" className={css.storefrontLogo} />
          ) : (
            <span className={css.storefrontLogoFallback} aria-hidden="true">
              {initials(displayName)}
            </span>
          )}
          <span className={css.storefrontName}>{displayName}</span>
          <span className={css.storefrontCart} aria-hidden="true">🛒</span>
        </div>

        {/* PR 4: el hero renderiza según heroVariant.
            - Si hay bannerUrl, siempre gana la imagen (independiente del tema).
            - Si no, el CSS pinta 4 variantes vía [data-hero="..."]. */}
        {bannerUrl ? (
          <div className={css.storefrontBanner}>
            <img src={bannerUrl} alt="" />
          </div>
        ) : (
          <div className={css.storefrontHero}>
            <p className={css.heroTitle}>{displayName}</p>
            <p className={css.heroSub}>Envío a todo México</p>
          </div>
        )}

        <div className={css.storefrontBody}>
          <div className={css.sectionLabel}>Productos</div>
          <ul className={css.cardGrid}>
            {SAMPLE_LISTINGS.map(item => (
              <li key={item.id} className={css.card}>
                <div className={css.cardPhoto} style={{ background: item.gradient }} />
                <div className={css.cardBody}>
                  <span className={css.cardTitle}>{item.title}</span>
                  <span className={css.cardPrice}>{item.price}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className={css.storefrontFoot}>Powered by Xololo</div>
      </div>

      <p className={css.footNote}>
        Este preview usa datos de ejemplo. Al publicar, tu tienda real en{' '}
        <strong>{slug ? `${slug}.xololo.mx` : 'tu-slug.xololo.mx'}</strong> aplica estos colores
        y logo con tus productos reales.
      </p>
    </aside>
  );
};

export default StorefrontPreview;
