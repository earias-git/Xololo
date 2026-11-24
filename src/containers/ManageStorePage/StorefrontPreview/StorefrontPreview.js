import React, { useState } from 'react';
import classNames from 'classnames';

import css from './StorefrontPreview.module.css';

// XOLOLO Web Studio PR 1 — preview en vivo del storefront dentro de
// ManageStorePage. Mini-réplica del SellerBrandFrame + listing cards
// que se actualiza al vuelo con los valores del form Final.
//
// Scope PR 1 (ver [[web-studio-staging-lock]]):
//   - Sólo visualización de lo que el seller YA edita (colores, logo,
//     banner, nombre). Sin staging — PR 2 agrega modelo draft/live.
//   - Sin iframe ni server changes — todo client-side con React.
//   - Toggle mobile (375px) / desktop (1024px) para que el seller vea
//     cómo luce su tienda en ambos lados.
//
// Props vienen de los values del Final Form (ManageStoreForm) a través
// de FormSpy. Nada se persiste; al mover el color el preview re-renderea.

// 3 cards de ejemplo — no tocamos listings reales en PR 1 (ese es PR 4).
// Las fotos son gradients suaves consistentes con el look de Xololo.
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

const StorefrontPreview = props => {
  const {
    brandPrimaryColor,
    brandSecondaryColor,
    logoUrl,
    bannerUrl,
    slug,
    storeName,
    className,
  } = props;
  const [viewport, setViewport] = useState('desktop');

  const primary = brandPrimaryColor || '#1f8f52';
  const secondary = brandSecondaryColor || '#6bcb8c';
  const displayName = storeName || slug || 'Tu tienda';

  // CSS vars inyectadas al frame — mismo patrón que SellerBrandFrame
  // para mantener paridad visual con el storefront real.
  const frameStyle = {
    '--preview-primary': primary,
    '--preview-secondary': secondary,
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
        style={frameStyle}
      >
        {/* Header del storefront — paridad con SellerBrandFrame */}
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

        {/* Hero banner: imagen si hay, si no un hero de color con el nombre */}
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

        {/* Grid de listing cards de ejemplo */}
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
