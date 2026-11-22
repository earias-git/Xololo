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
import { useBuyerLocation } from '../../hooks/useBuyerLocation';
// XOLOLO 2026-11-19: reutiliza los mismos helpers del landing
// principal para mantener coherencia entre /comunidad/* y /.
import {
  listingToFeaturedItem,
  isUsedListing,
  isEventListing,
  buildAuthorIndex,
  filterByBuyerState,
  VISIBLE_PER_RAIL,
} from '../../ducks/landingListings.duck';

import { Page, LayoutSingleColumn } from '../../components';
import FeaturedListings from '../../components/FeaturedListings/FeaturedListings';
import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import NotFoundPage from '../NotFoundPage/NotFoundPage';

import {
  selectCommunity,
  selectCommunityListings,
  selectCommunityLoading,
  selectCommunityNotFound,
} from './CommunityLandingPage.duck';

// XOLOLO 2026-11-21 — iconos outline estilo Xololo para los chips de
// filtro (reemplazan los emoji del seed cuando la comunidad define
// `iconId` en sus filterGroups).
import { getCommunityFilterIcon } from './communityFilterIcons';

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

// XOLOLO 2026-11-21 — Banner co-branded OPF × Xololo para la landing
// de /comunidad/opf. Replica el treatment del artifact aprobado:
// fondo blanco limpio (fondo propio de OPF), arco rainbow como su
// avatar de FB, logo OPF intacto, "powered by Xololo" en el mismo
// estilo que su "pwr. by IPM Essen".
//
// Único por slug. Se delega desde el render principal cuando
// community.slug === 'opf'. Otras comunidades siguen usando <Hero/>.
const OpfBanner = ({ community }) => (
  <section
    className={css.opfBanner}
    role="banner"
    aria-label={`Banner de ${community.name}`}
  >
    <svg
      className={css.opfRainbow}
      viewBox="0 0 1600 500"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="opfArcGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#d6228b" />
          <stop offset="15%" stopColor="#7a3fb4" />
          <stop offset="32%" stopColor="#2b55b0" />
          <stop offset="50%" stopColor="#1fa5a8" />
          <stop offset="68%" stopColor="#4caf3c" />
          <stop offset="84%" stopColor="#f2c012" />
          <stop offset="100%" stopColor="#e5273c" />
        </linearGradient>
        <mask id="opfArcMask">
          <rect width="1600" height="500" fill="black" />
          <circle cx="1520" cy="250" r="260" fill="white" />
          <circle cx="1520" cy="250" r="190" fill="black" />
        </mask>
        <mask id="opfArcMask2">
          <rect width="1600" height="500" fill="black" />
          <circle cx="80" cy="500" r="200" fill="white" />
          <circle cx="80" cy="500" r="150" fill="black" />
        </mask>
      </defs>
      <rect width="1600" height="500" fill="url(#opfArcGrad)" mask="url(#opfArcMask)" />
      <g opacity="0.55" style={{ mixBlendMode: 'multiply' }}>
        <rect width="1600" height="500" fill="url(#opfArcGrad)" mask="url(#opfArcMask2)" />
      </g>
    </svg>

    <div className={css.opfLogoStage}>
      <img
        src="/static/community/opf-logo.png"
        alt={community.name}
        className={css.opfLogo}
      />
    </div>

    <div className={css.opfDivider} aria-hidden="true" />

    <div className={css.opfCopy}>
      <span className={css.opfEyebrow}>
        <span className={css.opfDot} aria-hidden="true" />
        Comunidad oficial · México
      </span>
      <h1 className={css.opfHeadline}>
        Donde florece el <em>sector verde</em> mexicano.
      </h1>
      <p className={css.opfSubline}>
        Viveristas · Floricultores · Paisajistas · Distribuidores
      </p>
      <div className={css.opfPwr}>
        <span className={css.opfPwrLabel}>powered by</span>
        <svg className={css.opfXmark} viewBox="0 -14 100 92" aria-hidden="true">
          <path
            d="M 8 4 L 28 4 Q 55 38 92 76 L 72 76 Q 45 38 8 4 Z"
            fill="#2a3b5c"
          />
          <path
            d="M 72 4 L 92 4 Q 55 38 28 76 L 8 76 Q 45 38 72 4 Z"
            fill="#2a3b5c"
          />
          <path
            d="M 82 -4 C 90 -12 100 -8 96 2 C 90 0 84 0 82 -4 Z"
            fill="#3bc86a"
          />
        </svg>
        <span className={css.opfBrand}>Xololo</span>
        {community.sellerCount ? (
          <span className={css.opfSellers}>
            <strong>{community.sellerCount}</strong>{' '}
            {community.sellerCount === 1 ? 'negocio' : 'negocios'}
          </span>
        ) : null}
      </div>
    </div>
  </section>
);

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

// XOLOLO 2026-11-18 — Filters: usa community.filterGroups cuando la
// comunidad lo define (taxonomía propia). Fallback a pill chips
// derivados de los categoryLevel1 de los listings cuando no.
//
// XOLOLO 2026-11-21 — cuando los filterGroups traen `iconId`, los
// renderizamos como tile-cards estilo Xololo CategoryRail (ring
// circular verde + ícono outline + label debajo). Más limpio y
// profesional que los emoji; igual al landing principal.
const AllIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" />
    <rect x="13" y="13" width="7" height="7" rx="1.5" />
  </svg>
);

const Filters = ({ filterGroups, availableCategories, selected, onSelect }) => {
  if (filterGroups?.length) {
    const hasIcons = filterGroups.some(fg => fg.iconId);
    if (hasIcons) {
      // +1 por el tile "Todos". Lo expongo como CSS var para que el
      // grid desktop reparta columnas uniformes sin asumir N fijo.
      const totalTiles = filterGroups.length + 1;
      return (
        <ul
          className={css.filterRail}
          role="group"
          aria-label="Filtros de la comunidad"
          style={{ '--community-filter-count': totalTiles }}
        >
          <li className={css.filterItem}>
            <button
              type="button"
              className={classNames(css.filterTile, !selected && css.filterTileActive)}
              onClick={() => onSelect(null)}
              aria-pressed={!selected}
            >
              <span className={css.filterIconRing}>{AllIcon}</span>
              <span className={css.filterTileLabel}>Todos</span>
            </button>
          </li>
          {filterGroups.map(fg => {
            const icon = getCommunityFilterIcon(fg.iconId);
            const isActive = selected?.id === fg.id;
            return (
              <li key={fg.id} className={css.filterItem}>
                <button
                  type="button"
                  className={classNames(css.filterTile, isActive && css.filterTileActive)}
                  onClick={() => onSelect(fg)}
                  aria-pressed={isActive}
                  title={fg.label}
                >
                  <span className={css.filterIconRing}>{icon}</span>
                  <span className={css.filterTileLabel}>{fg.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      );
    }
    // Comunidad con filterGroups pero sin iconId: fallback a pill chips.
    return (
      <div className={css.filters} role="group" aria-label="Filtros de la comunidad">
        <button
          type="button"
          className={classNames(css.filterChip, !selected && css.filterChipActive)}
          onClick={() => onSelect(null)}
        >
          Todos
        </button>
        {filterGroups.map(fg => (
          <button
            key={fg.id}
            type="button"
            className={classNames(
              css.filterChip,
              selected?.id === fg.id && css.filterChipActive
            )}
            onClick={() => onSelect(fg)}
            title={fg.label}
          >
            {fg.label}
          </button>
        ))}
      </div>
    );
  }
  // Fallback legacy — categoryLevel1 derivado de los listings.
  if (!availableCategories?.length) return null;
  return (
    <div className={css.filters} role="group" aria-label="Filtros de categoría">
      <button
        type="button"
        className={classNames(css.filterChip, !selected && css.filterChipActive)}
        onClick={() => onSelect(null)}
      >
        Todos
      </button>
      {availableCategories.map(cat => (
        <button
          key={cat}
          type="button"
          className={classNames(
            css.filterChip,
            selected === cat && css.filterChipActive
          )}
          onClick={() => onSelect(cat)}
        >
          {cat}
        </button>
      ))}
    </div>
  );
};

// Matcher de un listing contra un filterGroup. Match es {categoryLevel1,
// categoryLevel2?}. Un listing matchea si sus publicData coinciden.
const listingMatchesFilter = (listing, filterGroup) => {
  if (!filterGroup?.match) return false;
  const pd = listing?.attributes?.publicData || {};
  const m = filterGroup.match;
  if (m.categoryLevel1 && pd.categoryLevel1 !== m.categoryLevel1) return false;
  if (m.categoryLevel2 && pd.categoryLevel2 !== m.categoryLevel2) return false;
  if (m.categoryLevel3 && pd.categoryLevel3 !== m.categoryLevel3) return false;
  return true;
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
  const { location: buyerLocation } = useBuyerLocation();
  const buyerState = buyerLocation?.state || null;

  const data = listings?.data || [];
  const included = listings?.included || [];

  // XOLOLO 2026-11-18 — filtros propios de la comunidad (filterGroups)
  // tienen prioridad sobre el fallback de categoryLevel1. Ver
  // src/config/communities.js y Filters component abajo.
  const filterGroups = community?.filterGroups || null;

  // Fallback: derivar chips de los categoryLevel1 de los listings
  // cuando la comunidad NO define filterGroups.
  const availableCategories = useMemo(() => {
    if (filterGroups) return []; // ignorado si hay filterGroups
    const set = new Set();
    data.forEach(l => {
      const cat = l?.attributes?.publicData?.categoryLevel1;
      if (cat) set.add(cat);
    });
    return Array.from(set).sort();
  }, [data, filterGroups]);

  const [selected, setSelected] = useState(null);

  // Scope base: si hay un chip de filtro seleccionado, los 3 rieles
  // se limitan a los listings que lo cumplen. Sin chip → todos.
  const scopedListings = useMemo(() => {
    if (!selected) return data;
    if (filterGroups) return data.filter(l => listingMatchesFilter(l, selected));
    return data.filter(l => l?.attributes?.publicData?.categoryLevel1 === selected);
  }, [data, selected, filterGroups]);

  // XOLOLO 2026-11-19 (Mejora 5) — mismos 3 rieles de la landing
  // principal: Productos / Servicios / Segunda mano. Con los mismos
  // criterios: usados por 3 señales (condition/taxCode/casual_reseller),
  // services incluye eventos, ordering por buyerState (locales primero).
  const { productItems, serviceItems, usedItems } = useMemo(() => {
    const authorsById = buildAuthorIndex(included);

    // productos = no used, no event
    const productsBase = scopedListings.filter(
      l => !isUsedListing(l, authorsById) && !isEventListing(l)
    );
    // servicios = listingType service/service-day O listings con isEvent=true
    const servicesBase = scopedListings.filter(l => {
      const lt = l?.attributes?.publicData?.listingType;
      return lt === 'service' || lt === 'service-day' || isEventListing(l);
    });
    // usados = isUsedListing (3 señales)
    const usedBase = scopedListings.filter(l => isUsedListing(l, authorsById));

    // Ordering por location + top VISIBLE_PER_RAIL + mapeo al shape
    // de FeaturedListings.
    const toRail = (kind, base) => {
      const ordered = filterByBuyerState(base, buyerState, authorsById);
      return ordered
        .slice(0, VISIBLE_PER_RAIL)
        .map((l, i) => listingToFeaturedItem(kind, l, included, i));
    };

    return {
      productItems: toRail('product', productsBase),
      serviceItems: toRail('service', servicesBase),
      usedItems: toRail('product', usedBase),
    };
  }, [scopedListings, included, buyerState]);

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
        {community.slug === 'opf' ? (
          <OpfBanner community={community} />
        ) : (
          <Hero community={community} />
        )}

        <div className={css.content}>
          <Bylaws community={community} />

          <Filters
            filterGroups={filterGroups}
            availableCategories={availableCategories}
            selected={selected}
            onSelect={setSelected}
          />

          {data.length === 0 ? (
            <EmptyState community={community} />
          ) : (
            <>
              {/* XOLOLO 2026-11-19 (Mejora 5): 3 rieles idénticos a la
                  landing principal. Si el usuario filtró por chip y el
                  riel queda vacío, se oculta ese riel individualmente. */}
              {productItems.length > 0 ? (
                <FeaturedListings
                  title="Productos"
                  seeAllLabel="Ver todos los productos"
                  seeAllHref={`/s?pub_sellerCommunities=has:${community.id}&pub_listingType=product`}
                  items={productItems}
                />
              ) : null}
              {serviceItems.length > 0 ? (
                <FeaturedListings
                  title="Servicios"
                  seeAllLabel="Ver todos los servicios"
                  seeAllHref={`/s?pub_sellerCommunities=has:${community.id}&pub_listingType=service,service-day`}
                  items={serviceItems}
                />
              ) : null}
              {usedItems.length > 0 ? (
                <FeaturedListings
                  title="Segunda mano"
                  seeAllLabel="Ver todo lo usado"
                  seeAllHref={`/s?pub_sellerCommunities=has:${community.id}&pub_condition=used`}
                  items={usedItems}
                />
              ) : null}
              {productItems.length === 0 &&
              serviceItems.length === 0 &&
              usedItems.length === 0 ? (
                <div className={css.empty}>
                  <p>Sin resultados para este filtro.</p>
                </div>
              ) : null}
            </>
          )}
        </div>
      </LayoutSingleColumn>
    </Page>
  );
};

export default CommunityLandingPage;
