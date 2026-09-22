import React, { useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { connect, useSelector } from 'react-redux';
import { string, bool, func, array, object } from 'prop-types';

import {
  fetchStorefrontSeller,
  selectStorefrontSeller,
  selectStorefrontInProgress,
  selectStorefrontNotFound,
  selectStorefrontListings,
} from '../../ducks/storefrontSeller.duck';
import { selectStorefrontSlug } from '../../ducks/storefrontSubdomain.duck';
import { selectCartItemCount } from '../../ducks/cart.duck';

import FeaturedListings from '../../components/FeaturedListings/FeaturedListings';
import VerifiedBand from '../../components/VerifiedBand/VerifiedBand';
import StoreStatsWidget from '../../components/StoreStatsWidget/StoreStatsWidget';

import css from './StorefrontPage.module.css';

// XOLOLO: página pública del storefront de un seller.
// Se renderiza cuando el subdominio matchea un seller registrado y su
// publicData.slug apunta a este subdominio. La identidad visual (colores,
// logo, banner) sale de los campos custom del user en Sharetribe Console.

const DEFAULT_PRIMARY = '#1f8f52';
const DEFAULT_SECONDARY = '#6bcb8c';
const BANNER_AUTOPLAY_MS = 6000;

// XOLOLO: carrusel de banners del storefront.
// Muestra 1-3 imágenes horizontales. Si hay 2 o más, rota cada 6s con
// pausa al hover/focus (respeta prefers-reduced-motion). Con 1 sola
// imagen se degrada a un banner estático — mismos estilos que antes.
// XOLOLO Cart.3: link al carrito del seller en el header del storefront.
// Solo renderea si el sellerId es válido y hay items en el carrito.
const StorefrontCartLink = ({ sellerId }) => {
  const uuid = typeof sellerId === 'string' ? sellerId : sellerId?.uuid;
  const count = useSelector(uuid ? selectCartItemCount(uuid) : () => 0);
  if (!uuid || count <= 0) return null;
  return (
    <a href={`/cart/${uuid}`} className={css.cartLink} aria-label={`Carrito (${count} items)`}>
      🛒 <span className={css.cartLinkBadge}>{count}</span>
    </a>
  );
};

const BannerCarousel = ({ banners }) => {
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef(null);
  const numSlides = banners?.length || 0;

  const goTo = useCallback(
    idx => {
      if (!numSlides) return;
      const next = ((idx % numSlides) + numSlides) % numSlides;
      setActiveIdx(next);
    },
    [numSlides]
  );

  useEffect(() => {
    if (numSlides <= 1) return undefined;
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (prefersReducedMotion) return undefined;

    const container = containerRef.current;
    let intervalId = null;
    let paused = false;

    const tick = () => {
      if (!paused) setActiveIdx(prev => (prev + 1) % numSlides);
    };
    intervalId = window.setInterval(tick, BANNER_AUTOPLAY_MS);
    const pause = () => { paused = true; };
    const resume = () => { paused = false; };

    container?.addEventListener('mouseenter', pause);
    container?.addEventListener('mouseleave', resume);
    container?.addEventListener('focusin', pause);
    container?.addEventListener('focusout', resume);

    return () => {
      if (intervalId != null) window.clearInterval(intervalId);
      container?.removeEventListener('mouseenter', pause);
      container?.removeEventListener('mouseleave', resume);
      container?.removeEventListener('focusin', pause);
      container?.removeEventListener('focusout', resume);
    };
  }, [numSlides]);

  if (!numSlides) return null;

  return (
    <section
      ref={containerRef}
      className={css.bannerCarousel}
      aria-roledescription="carousel"
      aria-label="Banners de la tienda"
    >
      {banners.map((url, idx) => (
        <div
          key={url + idx}
          className={classNames(css.bannerSlide, {
            [css.bannerSlideActive]: idx === activeIdx,
          })}
          role="group"
          aria-roledescription="slide"
          aria-label={`${idx + 1} de ${numSlides}`}
          aria-hidden={idx !== activeIdx}
          style={{ backgroundImage: `url(${url})` }}
        />
      ))}
      {numSlides > 1 ? (
        <>
          <button
            type="button"
            className={classNames(css.bannerArrow, css.bannerArrowPrev)}
            onClick={() => goTo(activeIdx - 1)}
            aria-label="Banner anterior"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            className={classNames(css.bannerArrow, css.bannerArrowNext)}
            onClick={() => goTo(activeIdx + 1)}
            aria-label="Banner siguiente"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className={css.bannerDots} role="tablist" aria-label="Elegir banner">
            {banners.map((_, idx) => (
              <button
                key={idx}
                type="button"
                role="tab"
                aria-selected={idx === activeIdx}
                aria-label={`Ir al banner ${idx + 1}`}
                className={classNames(css.bannerDot, {
                  [css.bannerDotActive]: idx === activeIdx,
                })}
                onClick={() => goTo(idx)}
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
};

const buildWhatsAppUrl = (number, sellerName) => {
  if (!number) return null;
  const clean = String(number).replace(/[^\d]/g, '');
  const text = encodeURIComponent(
    `Hola${sellerName ? ` ${sellerName}` : ''}, vi tu tienda en Xololo.mx y me interesa saber más.`
  );
  return `https://wa.me/${clean}?text=${text}`;
};

const buildInstagramUrl = handle => {
  if (!handle) return null;
  const clean = String(handle).replace(/^@/, '').trim();
  if (!clean) return null;
  return `https://instagram.com/${clean}`;
};

const buildFacebookUrl = handle => {
  if (!handle) return null;
  const raw = String(handle).trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  const clean = raw.replace(/^@/, '').replace(/^facebook\.com\//i, '');
  return `https://facebook.com/${clean}`;
};

const buildMapsUrl = address => {
  if (!address) return null;
  const clean = String(address).trim();
  if (!clean) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clean)}`;
};

// XOLOLO: íconos outline uniformes para el bloque de contacto (misma
// stroke-width y proporciones para que se lean como un set). Todos usan
// currentColor y heredan el color primario del seller.
const IconInstagram = props => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
    <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="1.7" />
    <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.7" />
    <circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" />
  </svg>
);

const IconFacebook = props => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
    <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="1.7" />
    <path
      d="M14.5 8.5h-1.2c-.6 0-1 .3-1 1V11h2.2l-.3 2h-1.9v5"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const IconWhatsapp = props => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
    <path
      d="M20.5 12a8.5 8.5 0 1 1-3.6-6.94L20.5 4l-1 3.5A8.5 8.5 0 0 1 20.5 12Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
    <path
      d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.2-1.4-1.9-.9-.9.9c-1-.3-1.9-1.2-2.2-2.2l.9-.9-.9-1.9L9 9.5Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
);

const IconMapPin = props => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
    <path
      d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
    <circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.7" />
  </svg>
);

const StorefrontPageComponent = props => {
  const {
    slug,
    seller,
    listings,
    inProgress,
    notFound,
    onFetchSeller,
  } = props;

  useEffect(() => {
    if (slug && onFetchSeller && !seller && !notFound) {
      onFetchSeller(slug);
    }
  }, [slug, seller, notFound, onFetchSeller]);

  // XOLOLO F3 · ampliación admin: dispara store.viewed una vez por
  // sesión por seller. Alimenta la sección "Tráfico" de /admin
  // (analytics de páginas de sellers). Fire-and-forget, dedupe por
  // sesión en sessionStorage — no cuenta re-renders ni refresh.
  const sellerIdForTracking = seller?.id;
  useEffect(() => {
    if (!sellerIdForTracking) return;
    // eslint-disable-next-line global-require
    const { trackEvent, detectSource } = require('../../util/tracking');
    trackEvent('store.viewed', {
      sellerId: sellerIdForTracking,
      source: detectSource(),
    });
  }, [sellerIdForTracking]);

  if (inProgress && !seller) {
    return (
      <main className={css.loadingRoot}>
        <div className={css.loadingSpinner} aria-label="Cargando tienda…" />
      </main>
    );
  }

  if (notFound) {
    return (
      <main className={css.notFoundRoot}>
        <div className={css.notFoundBox}>
          <p className={css.notFoundEyebrow}>Tienda no encontrada</p>
          <h1 className={css.notFoundTitle}>{slug}.xololo.mx aún no existe</h1>
          <p className={css.notFoundText}>
            No hay ninguna tienda con este subdominio. Si crees que es tuya,
            revisa que el <code>slug</code> en tu perfil coincida con{' '}
            <strong>{slug}</strong>.
          </p>
          <a href="https://xololo.mx" className={css.notFoundLink}>
            Ir al marketplace →
          </a>
        </div>
      </main>
    );
  }

  if (!seller) return null;

  const pd = seller.publicData || {};
  const primary = pd.brandPrimaryColor || DEFAULT_PRIMARY;
  const secondary = pd.brandSecondaryColor || DEFAULT_SECONDARY;
  const logo = pd.logoUrl;
  const banners = [pd.bannerUrl, pd.bannerUrl2, pd.bannerUrl3].filter(Boolean);
  const whatsappUrl = buildWhatsAppUrl(pd.whatsapp, seller.displayName);
  const instagramUrl = buildInstagramUrl(pd.instagram);
  const facebookUrl = buildFacebookUrl(pd.facebook);
  const showCalendar = pd.showCalendar === 'yes';
  const legalName = pd.legalName;
  // XOLOLO: preferimos commercialAddress (v1 estructurado) para el
  // footer del storefront porque es el "dónde estamos". Fallback a
  // legalAddress si commercial no está capturado, y a `address`
  // (string legacy) para cuentas que aún no han migrado.
  const buildAddressString = a => {
    if (!a || typeof a !== 'object') return null;
    const parts = [a.street, a.colonia, a.city, a.state, a.postalCode].filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  };
  const address =
    buildAddressString(pd.commercialAddress) ||
    buildAddressString(pd.legalAddress) ||
    (typeof pd.address === 'string' ? pd.address : null);
  const mapsUrl = buildMapsUrl(address);

  const rootStyle = {
    '--storefront-primary': primary,
    '--storefront-secondary': secondary,
  };

  return (
    <div className={css.root} style={rootStyle}>
      <header className={css.header}>
        <div className={css.headerInner}>
          <a href="/" className={css.brand}>
            {logo ? (
              <img src={logo} alt={seller.displayName} className={css.brandLogo} />
            ) : (
              <span className={css.brandFallback}>{seller.displayName}</span>
            )}
          </a>
          <nav className={css.headerNav}>
            <a href="#catalogo" className={css.navLink}>
              Catálogo
            </a>
            <a href="#sobre-nosotros" className={css.navLink}>
              Sobre nosotros
            </a>
            {showCalendar ? (
              <a href="#disponibilidad" className={css.navLink}>
                Disponibilidad
              </a>
            ) : null}
            <a href="#contacto" className={css.navLink}>
              Contacto
            </a>
            {/* XOLOLO Cart.3: ícono flotante del carrito del seller.
                Solo visible cuando hay items. */}
            <StorefrontCartLink sellerId={seller.id} />
          </nav>
        </div>
      </header>

      <BannerCarousel banners={banners} />

      <section className={css.hero}>
        <div className={css.heroInner}>
          <p className={css.heroEyebrow}>Tienda oficial en Xololo.mx</p>
          <h1 className={css.heroTitle}>{seller.displayName}</h1>
          {pd.shortDescription ? (
            <p className={css.heroDescription}>{pd.shortDescription}</p>
          ) : null}
          <div className={css.heroCtas}>
            {whatsappUrl ? (
              <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className={css.heroCta}>
                Escríbenos por WhatsApp
              </a>
            ) : null}
            <a href="#catalogo" className={css.heroCtaGhost}>
              Ver catálogo →
            </a>
          </div>
        </div>
      </section>

      {/* XOLOLO: sello de confianza — reutilizamos VerifiedBand del home
          para que la seña visual sea idéntica en toda la plataforma
          (mismo layout, mismos íconos, mismo copy "Xololo Verified™"). */}
      <VerifiedBand />

      {/* XOLOLO F3 · Fase 4: prueba social pública. Se auto-oculta si
          el seller aún no cumple el threshold (≥5 ventas). */}
      {seller?.id ? (
        <div className={css.statsWrap}>
          <StoreStatsWidget sellerId={seller.id} />
        </div>
      ) : null}

      <section id="catalogo" className={css.catalog}>
        {listings?.length ? (
          <FeaturedListings
            title={`Productos y servicios de ${seller.displayName}`}
            seeAllLabel="Ver todos"
            seeAllHref={`/s?meta_authorId=${seller.id}`}
            items={listings}
          />
        ) : (
          <div className={css.catalogEmpty}>
            <p className={css.catalogEmptyText}>
              Esta tienda aún no tiene productos o servicios publicados.
            </p>
          </div>
        )}
      </section>

      {pd.longDescription ? (
        <section id="sobre-nosotros" className={css.about}>
          <div className={css.aboutInner}>
            <h2 className={css.sectionTitle}>Sobre nosotros</h2>
            <p className={css.aboutText}>{pd.longDescription}</p>
          </div>
        </section>
      ) : null}

      {showCalendar ? (
        <section id="disponibilidad" className={css.calendar}>
          <div className={css.calendarInner}>
            <h2 className={css.sectionTitle}>Disponibilidad</h2>
            <p className={css.calendarNote}>
              Calendario de próximas fechas disponibles.
            </p>
            <div className={css.calendarPlaceholder}>
              📅 El calendario detallado por servicio aparece al abrir cada listing.
            </div>
          </div>
        </section>
      ) : null}

      <section id="contacto" className={css.contact}>
        <div className={css.contactInner}>
          <h2 className={css.sectionTitle}>Contacto directo</h2>
          <p className={css.contactNote}>
            Escríbenos por WhatsApp o síguenos en redes. También puedes usar
            el chat interno cuando compres uno de nuestros productos o servicios.
          </p>
          <div className={css.contactButtons}>
            {whatsappUrl ? (
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={css.contactBtnWhatsapp}
              >
                <IconWhatsapp className={css.contactBtnIcon} />
                WhatsApp
              </a>
            ) : null}
            {instagramUrl ? (
              <a
                href={instagramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={css.contactBtnInstagram}
              >
                <IconInstagram className={css.contactBtnIcon} />
                Instagram
              </a>
            ) : null}
            {facebookUrl ? (
              <a
                href={facebookUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={css.contactBtnFacebook}
              >
                <IconFacebook className={css.contactBtnIcon} />
                Facebook
              </a>
            ) : null}
          </div>
        </div>
      </section>

      {/* XOLOLO: footer legal del seller — nombre legal + dirección + link a
          Google Maps si aplica. Separado del footer corporativo de Xololo
          para que quede claro qué información pertenece a cada uno. */}
      {(legalName || address) ? (
        <section className={css.legalFooter}>
          <div className={css.legalFooterInner}>
            {legalName ? (
              <p className={css.legalName}>{legalName}</p>
            ) : null}
            {address ? (
              <p className={css.legalAddress}>
                <IconMapPin className={css.legalAddressIcon} />
                <span>{address}</span>
              </p>
            ) : null}
            {mapsUrl ? (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={css.legalMapsBtn}
              >
                <IconMapPin className={css.legalMapsIcon} />
                Ver ubicación en Google Maps
              </a>
            ) : null}
          </div>
        </section>
      ) : null}

      <footer className={css.footer}>
        <div className={css.footerInner}>
          <p className={css.footerText}>
            Powered by <a href="https://xololo.mx" className={css.footerLink}>Xololo®</a> —
            Marca registrada. Único sitio oficial: xololo.mx
          </p>
        </div>
      </footer>

      {whatsappUrl ? (
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={css.floatingWhatsapp}
          aria-label="Contactar por WhatsApp"
        >
          <IconWhatsapp className={css.floatingWhatsappIcon} />
          <span className={css.floatingWhatsappLabel}>WhatsApp</span>
        </a>
      ) : null}
    </div>
  );
};

StorefrontPageComponent.propTypes = {
  slug: string,
  seller: object,
  listings: array,
  inProgress: bool,
  notFound: bool,
  onFetchSeller: func,
};

const mapStateToProps = state => ({
  slug: selectStorefrontSlug(state),
  seller: selectStorefrontSeller(state),
  listings: selectStorefrontListings(state),
  inProgress: selectStorefrontInProgress(state),
  notFound: selectStorefrontNotFound(state),
});

const mapDispatchToProps = dispatch => ({
  onFetchSeller: slug => dispatch(fetchStorefrontSeller(slug)),
});

const StorefrontPage = connect(mapStateToProps, mapDispatchToProps)(StorefrontPageComponent);

export default StorefrontPage;
