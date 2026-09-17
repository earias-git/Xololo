import React, { useEffect } from 'react';
import { connect } from 'react-redux';
import { string, bool, func, array, object } from 'prop-types';

import {
  fetchStorefrontSeller,
  selectStorefrontSeller,
  selectStorefrontInProgress,
  selectStorefrontNotFound,
  selectStorefrontListings,
} from '../../ducks/storefrontSeller.duck';
import { selectStorefrontSlug } from '../../ducks/storefrontSubdomain.duck';

import FeaturedListings from '../../components/FeaturedListings/FeaturedListings';

import css from './StorefrontPage.module.css';

// XOLOLO: página pública del storefront de un seller.
// Se renderiza cuando el subdominio matchea un seller registrado y su
// publicData.slug apunta a este subdominio. La identidad visual (colores,
// logo, banner) sale de los campos custom del user en Sharetribe Console.

const DEFAULT_PRIMARY = '#1f8f52';
const DEFAULT_SECONDARY = '#6bcb8c';

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
  const banner = pd.bannerUrl;
  const whatsappUrl = buildWhatsAppUrl(pd.whatsapp, seller.displayName);
  const instagramUrl = buildInstagramUrl(pd.instagram);
  const showCalendar = pd.showCalendar === 'yes';

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
          </nav>
        </div>
      </header>

      {banner ? (
        <section
          className={css.banner}
          style={{ backgroundImage: `url(${banner})` }}
          aria-label="Banner de la tienda"
        />
      ) : null}

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

      {pd.longDescription ? (
        <section id="sobre-nosotros" className={css.about}>
          <div className={css.aboutInner}>
            <h2 className={css.sectionTitle}>Sobre nosotros</h2>
            <p className={css.aboutText}>{pd.longDescription}</p>
          </div>
        </section>
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
                <span className={css.contactBtnIcon} aria-hidden="true">
                  💬
                </span>
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
                <span className={css.contactBtnIcon} aria-hidden="true">
                  📷
                </span>
                Instagram
              </a>
            ) : null}
          </div>
        </div>
      </section>

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
          <span aria-hidden="true">💬</span>
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
