import React, { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';

import {
  POSTER_TEMPLATES,
  POSTER_COLOR_SWATCHES,
  POSTER_W,
  POSTER_H,
} from './posterTemplates';
import css from './ListingPoster.module.css';

// XOLOLO Promote v1 — Sub-commit 4: Poster PDF.
//
// Mini editor de poster para imprimir/compartir:
//   - 3 templates (Fresco, Elegante, Promo) con slots pre-definidos
//   - Edita color primario y texto del CTA
//   - QR del listing embebido en el poster (utm_source=poster)
//   - Descarga PNG + PDF carta (jspdf)
//
// Por defecto el editor viene colapsado (botón "Diseñar poster PDF")
// para no abrumar al seller con 3 editores en pantalla al mismo tiempo
// cuando tiene varios listings.

const MXN = subunits => {
  const n = Number(subunits) || 0;
  return `$${(n / 100).toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} MXN`;
};

const buildListingUrl = listing => {
  if (typeof window === 'undefined') return '';
  const origin = window.location.origin;
  const slug = listing.slug || 'listing';
  const params = new URLSearchParams({
    utm_source: 'poster',
    utm_medium: 'xolo-promo',
    utm_campaign: 'seller',
  });
  return `${origin}/l/${slug}/${listing.id}?${params.toString()}`;
};

const slugifyFilename = s => {
  return (
    String(s || 'xololo-poster')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '')
      .slice(0, 60) || 'xololo-poster'
  );
};

// Carga una imagen y resuelve a HTMLImageElement (crossOrigin para
// permitir usarla en canvas y luego exportar sin "tainted canvas").
const loadImage = src =>
  new Promise(resolve => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

const PosterEditor = ({ listing, onClose }) => {
  const canvasRef = useRef(null);
  const [templateKey, setTemplateKey] = useState(POSTER_TEMPLATES[0].key);
  const [color, setColor] = useState(POSTER_COLOR_SWATCHES[0]);
  const [cta, setCta] = useState('Escanéame y cómpralo en Xololo');
  const [productImg, setProductImg] = useState(null);
  const [qrImg, setQrImg] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);

  const url = useMemo(() => buildListingUrl(listing), [listing]);

  // Precarga imagen del producto (una vez).
  useEffect(() => {
    let cancelled = false;
    loadImage(listing.imageUrl).then(img => {
      if (!cancelled) setProductImg(img);
    });
    return () => {
      cancelled = true;
    };
  }, [listing.imageUrl]);

  // Precarga QR como <img> (dataURL interno).
  useEffect(() => {
    let cancelled = false;
    if (!url) return;
    QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 400,
      color: { dark: '#000000', light: '#ffffff' },
    }).then(
      dataUrl => {
        if (cancelled) return;
        const img = new Image();
        img.onload = () => {
          if (!cancelled) setQrImg(img);
        };
        img.src = dataUrl;
      },
      () => {}
    );
    return () => {
      cancelled = true;
    };
  }, [url]);

  // Redibuja el poster cuando cambia cualquier input.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = POSTER_W;
    canvas.height = POSTER_H;
    const ctx = canvas.getContext('2d');
    const tpl = POSTER_TEMPLATES.find(t => t.key === templateKey) || POSTER_TEMPLATES[0];
    try {
      tpl.draw(ctx, {
        title: listing.title || '',
        price: MXN(listing.priceSubunits),
        cta: cta || '',
        color,
        productImg,
        qrImg,
      });
      setError(null);
    } catch (e) {
      setError(e?.message || 'render_error');
    }
  }, [templateKey, color, cta, productImg, qrImg, listing]);

  const handleDownloadPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${slugifyFilename(listing.title)}-poster.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      setError(e?.message || 'png_error');
    }
  };

  const handleDownloadPdf = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setExporting(true);
    try {
      // Dynamic import: jspdf toca `window`/`document` al inicializar,
      // así que lo cargamos sólo en el click (nunca durante SSR).
      const { default: jsPDF } = await import('jspdf');
      const dataUrl = canvas.toDataURL('image/png');
      // Letter: 8.5"×11" = 215.9 × 279.4 mm. Dejamos 10mm de margen.
      const pdf = new jsPDF({
        unit: 'mm',
        format: 'letter',
        orientation: 'portrait',
        compress: true,
      });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const availW = pageW - margin * 2;
      const availH = pageH - margin * 2;
      // El canvas es 850x1100 (ratio 0.773). Ajustamos a availH.
      const canvasRatio = POSTER_W / POSTER_H;
      let drawH = availH;
      let drawW = drawH * canvasRatio;
      if (drawW > availW) {
        drawW = availW;
        drawH = drawW / canvasRatio;
      }
      const x = (pageW - drawW) / 2;
      const y = (pageH - drawH) / 2;
      pdf.addImage(dataUrl, 'PNG', x, y, drawW, drawH, undefined, 'FAST');
      pdf.save(`${slugifyFilename(listing.title)}-poster.pdf`);
    } catch (e) {
      setError(e?.message || 'pdf_error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className={css.editor}>
      <div className={css.previewWrap}>
        <canvas ref={canvasRef} className={css.previewCanvas} />
      </div>

      <div className={css.controls}>
        <div className={css.field}>
          <span className={css.label}>Plantilla</span>
          <div className={css.templateRow}>
            {POSTER_TEMPLATES.map(t => (
              <button
                key={t.key}
                type="button"
                className={`${css.chip} ${t.key === templateKey ? css.chipActive : ''}`}
                onClick={() => setTemplateKey(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className={css.field}>
          <span className={css.label}>Color</span>
          <div className={css.colorRow}>
            {POSTER_COLOR_SWATCHES.map(c => (
              <button
                key={c}
                type="button"
                aria-label={`Color ${c}`}
                className={`${css.swatch} ${c === color ? css.swatchActive : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>

        <div className={css.field}>
          <label className={css.label} htmlFor={`cta-${listing.id}`}>
            Llamado a la acción
          </label>
          <input
            id={`cta-${listing.id}`}
            type="text"
            className={css.input}
            value={cta}
            maxLength={60}
            onChange={e => setCta(e.target.value)}
            placeholder="Escanéame y cómpralo"
          />
        </div>

        <div className={css.actions}>
          <button
            type="button"
            className={css.btnPrimary}
            onClick={handleDownloadPdf}
            disabled={exporting}
          >
            <span aria-hidden>📄</span>
            <span>{exporting ? 'Generando…' : 'Descargar PDF'}</span>
          </button>
          <button type="button" className={css.btnSecondary} onClick={handleDownloadPng}>
            <span aria-hidden>🖼️</span>
            <span>Descargar PNG</span>
          </button>
          <button type="button" className={css.btnSecondary} onClick={onClose}>
            Cerrar
          </button>
        </div>

        {error ? <p className={css.error}>Error: {error}</p> : null}
      </div>
    </div>
  );
};

const ListingPoster = ({ listing }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className={css.root}>
      <div className={css.header}>
        <h4 className={css.heading}>🏷️ Poster para imprimir</h4>
        {!open ? (
          <button type="button" className={css.openBtn} onClick={() => setOpen(true)}>
            Diseñar poster
          </button>
        ) : null}
      </div>
      {open ? <PosterEditor listing={listing} onClose={() => setOpen(false)} /> : null}
    </div>
  );
};

export default ListingPoster;
