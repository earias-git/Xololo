import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

import css from './ListingQRCode.module.css';

// XOLOLO Promote v1 — Sub-commit 3: QR generator.
//
// Genera un QR del listing (URL absoluta con utm_source=qr) y permite
// descargarlo como PNG a 1024×1024 (resolución buena para impresión en
// etiquetas pequeñas o pegar en el poster PDF del sub-commit 4).
//
// La URL del QR se arma con el mismo patrón de UTM que los share
// intents, para que el pipeline existente de tracking
// (src/util/tracking.js + listing.viewed) persista el origen en
// listing.metadata y aparezca en el contador de vistas por fuente.
//
// Props:
//   listing: { id, slug, title }

const buildListingUrl = listing => {
  if (typeof window === 'undefined') return '';
  const origin = window.location.origin;
  const slug = listing.slug || 'listing';
  const params = new URLSearchParams({
    utm_source: 'qr',
    utm_medium: 'xolo-promo',
    utm_campaign: 'seller',
  });
  return `${origin}/l/${slug}/${listing.id}?${params.toString()}`;
};

const slugifyFilename = s => {
  return String(s || 'xololo-qr')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 60) || 'xololo-qr';
};

const ListingQRCode = ({ listing }) => {
  // dataUrl pequeño para preview on-screen (72×72).
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);

  const url = buildListingUrl(listing);

  useEffect(() => {
    let cancelled = false;
    if (!url) return;
    QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 160,
      color: { dark: '#000000', light: '#ffffff' },
    }).then(
      dataUrl => {
        if (cancelled) return;
        setPreview(dataUrl);
      },
      err => {
        if (cancelled) return;
        setError(err?.message || 'qr_error');
      }
    );
    return () => {
      cancelled = true;
    };
  }, [url]);

  const handleDownload = async () => {
    if (!url) return;
    setDownloading(true);
    try {
      // Resolución alta para impresión (300dpi ~ 1024px da ~8.6cm).
      const bigDataUrl = await QRCode.toDataURL(url, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 1024,
        color: { dark: '#000000', light: '#ffffff' },
      });
      const a = document.createElement('a');
      a.href = bigDataUrl;
      a.download = `${slugifyFilename(listing.title)}-qr.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      setError(e?.message || 'download_error');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className={css.root}>
      <div className={css.row}>
        <div className={css.qrBox}>
          {preview ? (
            <img src={preview} alt="Código QR del producto" />
          ) : (
            <span className={css.qrEmpty}>QR…</span>
          )}
        </div>
        <div className={css.actions}>
          <button
            type="button"
            className={css.btn}
            onClick={handleDownload}
            disabled={!preview || downloading}
            title="Descarga un PNG de alta resolución (1024×1024) listo para imprimir"
          >
            <span aria-hidden>⬇️</span>
            <span>{downloading ? 'Generando…' : 'Descargar QR (PNG)'}</span>
          </button>
          <p className={css.hint}>Al escanearlo abre tu producto en Xololo.</p>
        </div>
      </div>
      {error ? <p className={css.error}>No se pudo generar el QR ({error}).</p> : null}
    </div>
  );
};

export default ListingQRCode;
