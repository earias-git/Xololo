/**
 * XOLOLO 2026-11-18 — ADR-006 PR-6: CommunityLandingPage.
 *
 * Landing pública de una comunidad: `/comunidad/:slug`,
 * `/region/:slug`, `/programa/:slug`. Los 3 prefijos resuelven al
 * mismo componente — el ADR-006 dice que el type va implícito en el
 * prefijo URL pero en V1 los slugs no colisionan entre types, así
 * que no hacemos passthrough del type al endpoint.
 *
 * Hidrata via loadData (SSR) o fetch client-side (navegación
 * interna). Ver CommunityLandingPage.duck.js.
 *
 * LOCKED (ver docs/MODEL_COMMUNITIES_V1.md §2.2):
 *  - 404 cuando community=null o notFound=true.
 *  - Branding fallback: iniciales + gradient si logoUrl/heroUrl=null.
 *  - Filtros (categoryLevel1, uso) son client-side en V1.
 */

import React, { useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { Helmet } from 'react-helmet-async';

import { isScrollingDisabled } from '../../ducks/ui.duck';
import { createSlug } from '../../util/urlHelpers';

import { Page, LayoutSingleColumn } from '../../components';
import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import NotFoundPage from '../NotFoundPage/NotFoundPage';

import {
  selectCommunity,
  selectCommunityListings,
  selectCommunityLoading,
  selectCommunityNotFound,
} from './CommunityLandingPage.duck';

import css from './CommunityLandingPage.module.css';

// --- helpers ---

const initialsOf = name => {
  if (!name) return 'C';
  const parts = String(name)
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + (parts[1][0] || '')).toUpperCase();
};

const resolveImageUrl = (listing, included) => {
  const imgRef = listing?.relationships?.images?.data?.[0];
  if (!imgRef) return null;
  const image = (included || []).find(
    i => i.type === 'image' && i.id?.uuid === imgRef.id?.uuid
  );
  const variants = image?.attributes?.variants;
  return variants?.['listing-card-2x']?.url || variants?.['listing-card']?.url || null;
};

const resolveSellerName = (listing, included) => {
  const authorRef = listing?.relationships?.author?.data;
  if (!authorRef) return null;
  const user = (included || []).find(
    i => i.type === 'user' && i.id?.uuid === authorRef.id?.uuid
  );
  return (
    user?.attributes?.profile?.displayName ||
    user?.attributes?.profile?.abbreviatedName ||
    null
  );
};

const formatPrice = money => {
  if (!money || typeof money.amount !== 'number') return null;
  const amount = money.amount / 100;
  const currency = money.currency || 'MXN';
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
};

// --- subcomponentes ---

const Hero = ({ community }) => {
  const {
    logoUrl,
    heroUrl,
    primaryColor,
    secondaryColor,
  } = community.branding || {};

  const gradient = `linear-gradient(135deg, ${primaryColor || '#2d5016'} 0%, ${
    secondaryColor || '#8fbc8f'
  } 100%)`;

  const heroStyle = heroUrl
    ? {
        backgroundImage: `linear-gradient(0deg, rgba(0,0,0,0.45), rgba(0,0,0,0.25)), url(${heroUrl})`,
      }
    : { backgroundImage: gradient };

  return (
    <section
      className={css.hero}
      style={heroStyle}
      role="banner"
      aria-label={`Hero de la comunidad ${community.name}`}
    >
      <div className={css.heroInner}>
        {logoUrl ? (
          <img className={css.heroLogo} src={logoUrl} alt={`Logo ${community.name}`} />
        ) : (
          <div
            className={css.heroLogoPlaceholder}
            style={{ background: primaryColor || '#2d5016' }}
            aria-hidden="true"
          >
            {initialsOf(community.name)}
          </div>
        )}
        <h1 className={css.heroTitle}>{community.name}</h1>
        {community.tagline ? (
          <p className={css.heroTagline}>{community.tagline}</p>
        ) : null}
        <div className={css.heroStats}>
          <span className={css.heroStat}>
            👥 <strong>{community.sellerCount || 0}</strong> negocios
          </span>
        </div>
      </div>
    </section>
  );
};

const Bylaws = ({ community }) => {
  const [open, setOpen] = useState(false);
  if (!community.bylaws) return null;
  return (
    <details
      className={css.bylaws}
      open={open}
      onToggle={e => setOpen(e.currentTarget.open)}
    >
      <summary className={css.bylawsSummary}>Sobre {community.name}</summary>
      <div className={css.bylawsBody}>
        {community.description ? <p>{community.description}</p> : null}
        <p>{community.bylaws}</p>
      </div>
    </details>
  );
};

const Filters = ({ availableCategories, selectedCategory, onSelectCategory }) => {
  if (!availableCategories?.length) return null;
  return (
    <div className={css.filters} role="group" aria-label="Filtros de categoría">
      <button
        type="button"
        className={classNames(css.filterChip, !selectedCategory && css.filterChipActive)}
        onClick={() => onSelectCategory(null)}
      >
        Todos
      </button>
      {availableCategories.map(cat => (
        <button
          key={cat}
          type="button"
          className={classNames(
            css.filterChip,
            selectedCategory === cat && css.filterChipActive
          )}
          onClick={() => onSelectCategory(cat)}
        >
          {cat}
        </button>
      ))}
    </div>
  );
};

const ListingTile = ({ listing, included }) => {
  const id = listing?.id?.uuid;
  const title = listing?.attributes?.title || 'Sin título';
  const slug = createSlug(title);
  const imageUrl = resolveImageUrl(listing, included);
  const sellerName = resolveSellerName(listing, included);
  const price = formatPrice(listing?.attributes?.price);
  const href = `/l/${slug}/${id}`;

  return (
    <a className={css.tile} href={href} aria-label={`Ver ${title}`}>
      <div className={css.tileImageWrap}>
        {imageUrl ? (
          <img className={css.tileImage} src={imageUrl} alt={title} loading="lazy" />
        ) : (
          <div className={css.tilePlaceholder} aria-hidden="true">
            {initialsOf(title)}
          </div>
        )}
      </div>
      <div className={css.tileBody}>
        <div className={css.tileTitle}>{title}</div>
        {sellerName ? <div className={css.tileSeller}>{sellerName}</div> : null}
        {price ? <div className={css.tilePrice}>{price}</div> : null}
      </div>
    </a>
  );
};

// --- página ---

const EmptyState = ({ community }) => (
  <div className={css.empty}>
    <h2>Esta comunidad aún no tiene anuncios</h2>
    <p>
      ¿Eres parte de {community.name}? Únete desde tu panel de tienda y tus anuncios
      aparecerán aquí automáticamente.
    </p>
    <a href="/account/store" className={css.emptyCta}>
      Ir a mi tienda
    </a>
  </div>
);

// Pequeña util para evitar depender de classnames aquí.
const classNames = (...xs) => xs.filter(Boolean).join(' ');

const CommunityLandingPage = () => {
  const community = useSelector(selectCommunity);
  const listings = useSelector(selectCommunityListings);
  const loading = useSelector(selectCommunityLoading);
  const notFound = useSelector(selectCommunityNotFound);
  const scrollingDisabled = useSelector(isScrollingDisabled);

  const data = listings?.data || [];
  const included = listings?.included || [];

  // Facetas client-side: categoryLevel1. Derivamos valores
  // disponibles de los listings cargados (en V1 no pegamos al backend
  // por filtros; cuando pase la landing a server-side se migra).
  const availableCategories = useMemo(() => {
    const set = new Set();
    data.forEach(l => {
      const cat = l?.attributes?.publicData?.categoryLevel1;
      if (cat) set.add(cat);
    });
    return Array.from(set).sort();
  }, [data]);

  const [selectedCategory, setSelectedCategory] = useState(null);

  const filteredListings = useMemo(() => {
    if (!selectedCategory) return data;
    return data.filter(l => l?.attributes?.publicData?.categoryLevel1 === selectedCategory);
  }, [data, selectedCategory]);

  // Guard: 404
  if (notFound) {
    return <NotFoundPage staticContext={{}} />;
  }

  if (loading && !community) {
    return (
      <Page scrollingDisabled={scrollingDisabled} title="Cargando…">
        <LayoutSingleColumn
          topbar={<TopbarContainer />}
          footer={<FooterContainer />}
        >
          <div className={css.loading}>Cargando comunidad…</div>
        </LayoutSingleColumn>
      </Page>
    );
  }

  if (!community) {
    // Fallback mientras hidrata (sin notFound ni loading); no bloquear.
    return (
      <Page scrollingDisabled={scrollingDisabled} title="Comunidad">
        <LayoutSingleColumn
          topbar={<TopbarContainer />}
          footer={<FooterContainer />}
        >
          <div className={css.loading}>&nbsp;</div>
        </LayoutSingleColumn>
      </Page>
    );
  }

  const pageTitle = `${community.name} — Xololo`;
  const pageDesc = community.tagline || community.description || '';

  return (
    <Page scrollingDisabled={scrollingDisabled} title={pageTitle} description={pageDesc}>
      <Helmet>
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={pageDesc} />
        {community.branding?.heroUrl ? (
          <meta property="og:image" content={community.branding.heroUrl} />
        ) : null}
        <meta
          name="keywords"
          content={(community.seoKeywords || []).join(', ')}
        />
      </Helmet>
      <LayoutSingleColumn topbar={<TopbarContainer />} footer={<FooterContainer />}>
        <Hero community={community} />

        <div className={css.content}>
          <Bylaws community={community} />

          <Filters
            availableCategories={availableCategories}
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
          />

          {filteredListings.length === 0 ? (
            data.length === 0 ? (
              <EmptyState community={community} />
            ) : (
              <div className={css.empty}>
                <p>Sin resultados para este filtro.</p>
              </div>
            )
          ) : (
            <div className={css.grid}>
              {filteredListings.map(l => (
                <ListingTile key={l.id?.uuid} listing={l} included={included} />
              ))}
            </div>
          )}
        </div>
      </LayoutSingleColumn>
    </Page>
  );
};

export default CommunityLandingPage;
