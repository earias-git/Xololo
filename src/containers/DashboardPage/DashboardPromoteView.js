import React, { useEffect, useState } from 'react';

import { apiBaseUrl } from '../../util/api';
import { IconSpinner } from '../../components';
import PromoShareButtons from '../../components/PromoShareButtons/PromoShareButtons';
import ListingQRCode from '../../components/ListingQRCode/ListingQRCode';
import ListingPoster from '../../components/ListingPoster/ListingPoster';
import MetaCommerceFeed from '../../components/MetaCommerceFeed/MetaCommerceFeed';

import { formatSubunitsAsMxn } from './dashboardUtils';

import css from './DashboardPage.module.css';

// XOLOLO Promote v1.
//
// Vista donde el seller ve todos sus listings y por cada uno tiene
// acceso a las acciones de promoción (compartir en redes, QR, poster
// PDF, etc.). Hoy incluye (sub-commits ya aplicados):
//   1 · Fetch de listings + grid por card
//   2 · Share intents (FB, IG, X, WhatsApp, TikTok, copiar link)
//   3 · QR + descarga PNG
//   4 · Poster editor (3 templates + color + CTA) + descarga PDF/PNG
//   5 · Feed CSV Meta Commerce (URL pública del feed por seller)
//
// Siguiente iteración (fuera de v1): stats detallado por fuente de
// vista, aprovechando `listing.metadata.listingViewedBySource` que
// el pipeline existente ya persiste.

const fetchListings = async () => {
  const res = await fetch(`${apiBaseUrl()}/api/seller-promo-listings`, {
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'fetch_failed');
    err.status = res.status;
    throw err;
  }
  return data;
};

const ListingCard = ({ listing, sellerLogoUrl }) => {
  return (
    <article className={css.promoCard}>
      <div className={css.promoCardHeader}>
        {listing.imageUrl ? (
          <img src={listing.imageUrl} alt="" className={css.promoCardImage} />
        ) : (
          <span className={css.promoCardImageEmpty} aria-hidden>
            📦
          </span>
        )}
        <div className={css.promoCardMain}>
          <h3 className={css.promoCardTitle}>{listing.title}</h3>
          <p className={css.promoCardPrice}>
            {formatSubunitsAsMxn(listing.priceSubunits)}
          </p>
          {listing.viewCount > 0 ? (
            <p className={css.promoCardMeta}>{listing.viewCount} vistas</p>
          ) : null}
        </div>
      </div>
      {/* Sub-commit 2: share intents. */}
      <PromoShareButtons listing={listing} />
      {/* Sub-commit 3: QR + descarga PNG. */}
      <ListingQRCode listing={listing} />
      {/* Sub-commit 4: Diseños para Imprimir — ahora con logo del seller. */}
      <ListingPoster listing={listing} sellerLogoUrl={sellerLogoUrl} />
    </article>
  );
};

const DashboardPromoteView = () => {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    let aborted = false;
    fetchListings().then(
      data => {
        if (aborted) return;
        setState({ status: 'ok', data, error: null });
      },
      err => {
        if (aborted) return;
        setState({ status: 'error', data: null, error: err?.message || 'fetch_failed' });
      }
    );
    return () => {
      aborted = true;
    };
  }, []);

  const listings = state.data?.listings || [];
  const sellerLogoUrl = state.data?.sellerLogoUrl || null;

  return (
    <>
      <header className={css.header}>
        <div>
          <h2 className={css.pageTitle}>Xololo Promote</h2>
          <p className={css.pageSubtitle}>
            Comparte tus productos en redes sociales, genera códigos QR y descarga carteles para
            imprimir. Toda la promoción de tus productos en un solo lugar.
          </p>
        </div>
      </header>

      {state.status === 'loading' ? (
        <div className={css.loading}>
          <IconSpinner />
          <p>Trayendo tus productos…</p>
        </div>
      ) : null}

      {state.status === 'error' ? (
        <div className={css.errorBox}>
          <strong>No pudimos cargar tus productos.</strong> ({state.error})
        </div>
      ) : null}

      {state.status === 'ok' && listings.length === 0 ? (
        <div className={css.emptyBox}>
          <p>
            Aún no tienes productos publicados. Cuando publiques uno, aparecerá aquí con opciones
            para promocionarlo.
          </p>
        </div>
      ) : null}

      {/* Sub-commit 5: feed Meta Commerce. Mostrado también mientras
          cargan los listings — su propio endpoint es independiente. */}
      {state.status !== 'error' ? <MetaCommerceFeed /> : null}

      {state.status === 'ok' && listings.length > 0 ? (
        <div className={css.promoGrid}>
          {listings.map(l => (
            <ListingCard key={l.id} listing={l} sellerLogoUrl={sellerLogoUrl} />
          ))}
        </div>
      ) : null}
    </>
  );
};

export default DashboardPromoteView;
