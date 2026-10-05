import React, { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';

import {
  DESIGN_TEMPLATES,
  DESIGN_COLOR_SWATCHES,
} from './templateDesigns';
import css from './ListingPoster.module.css';

// XOLOLO Promote · Diseños para Imprimir (sub-commit 1 de 3).
//
// Editor que permite al seller elegir entre 3 formatos físicos:
//   - Póster carta (21.6 × 28 cm) para pegar en muro/vitrina
//   - Etiqueta horizontal 10 × 7 cm para empaques o productos
//   - Etiqueta vertical 7 × 10 cm para cajas o estanterías
//
// Motor: SVG inline (no canvas 2D). Esto deja la puerta abierta para
// los sub-commits 2 (colores + logo + B/N) y 3 (20 tipografías con
// lazy-load) sin reescritura adicional.
//
// Export:
//   - PNG: serializa SVG → <img> → canvas de alta resolución → toBlob
//   - PDF: mismo PNG embebido en jsPDF con page size físico por template
//
// Para evitar "tainted canvas" por CORS, imagen del producto y QR se
// resuelven a `data:` URL antes de embeberse en el SVG.

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

const slugifyFilename = s =>
  String(s || 'xololo-design')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 60) || 'xololo-design';

// Fetch de la URL y conversión a data: URL. Garantiza que el SVG
// serializado no referencie recursos externos (clave para canvas sin
// taint). Devuelve null si falla — el template usa placeholder.
const fetchAsDataUrl = async url => {
  if (!url) return null;
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onloadend = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  } catch (_e) {
    return null;
  }
};

// Serializa el <svg> actual, lo renderiza a <img> y vuelca en canvas
// con el tamaño físico (exportPx del template). Devuelve dataURL PNG.
const renderSvgToPngDataUrl = async (svgEl, [widthPx, heightPx]) => {
  // Clonar y asegurar xmlns correcto (algunos browsers lo omiten al
  // serializar nodos React).
  const clone = svgEl.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(clone);
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = heightPx;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, widthPx, heightPx);
    ctx.drawImage(img, 0, 0, widthPx, heightPx);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
};

const DesignEditor = ({ listing, onClose }) => {
  const svgRef = useRef(null);
  const [templateKey, setTemplateKey] = useState(DESIGN_TEMPLATES[0].key);
  const [color, setColor] = useState(DESIGN_COLOR_SWATCHES[0]);
  const [cta, setCta] = useState('Escanéame y cómpralo en Xololo');
  const [productImgHref, setProductImgHref] = useState(null);
  const [qrHref, setQrHref] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);

  const url = useMemo(() => buildListingUrl(listing), [listing]);
  const template = DESIGN_TEMPLATES.find(t => t.key === templateKey) || DESIGN_TEMPLATES[0];

  // Precarga imagen del producto como data: URL (una vez por listing).
  useEffect(() => {
    let cancelled = false;
    if (!listing.imageUrl) return;
    fetchAsDataUrl(listing.imageUrl).then(dataUrl => {
      if (!cancelled) setProductImgHref(dataUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [listing.imageUrl]);

  // Genera el QR como data: URL.
  useEffect(() => {
    let cancelled = false;
    if (!url) return;
    QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 400,
      color: { dark: '#000000', light: '#ffffff' },
    }).then(dataUrl => {
      if (!cancelled) setQrHref(dataUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const designProps = {
    title: listing.title || '',
    price: MXN(listing.priceSubunits),
    cta: cta || '',
    color,
    productImgHref,
    qrHref,
  };

  const Design = template.render;

  const handleDownloadPng = async () => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    setExporting(true);
    try {
      const dataUrl = await renderSvgToPngDataUrl(svgEl, template.exportPx);
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${slugifyFilename(listing.title)}-${template.key}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setError(null);
    } catch (e) {
      setError(e?.message || 'png_error');
    } finally {
      setExporting(false);
    }
  };

  const handleDownloadPdf = async () => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    setExporting(true);
    try {
      const { default: jsPDF } = await import('jspdf');
      const pngDataUrl = await renderSvgToPngDataUrl(svgEl, template.exportPx);
      const { widthMm, heightMm, orientation, format } = template.pdf;
      const pdf = new jsPDF({
        unit: 'mm',
        format,
        orientation,
        compress: true,
      });
      pdf.addImage(pngDataUrl, 'PNG', 0, 0, widthMm, heightMm, undefined, 'FAST');
      pdf.save(`${slugifyFilename(listing.title)}-${template.key}.pdf`);
      setError(null);
    } catch (e) {
      setError(e?.message || 'pdf_error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className={css.editor}>
      <div className={css.previewWrap}>
        <div className={css.previewFrame}>
          <svg
            ref={svgRef}
            xmlns="http://www.w3.org/2000/svg"
            viewBox={`0 0 ${template.viewBox[0]} ${template.viewBox[1]}`}
            className={css.previewSvg}
          >
            <Design {...designProps} />
          </svg>
        </div>
        <p className={css.previewLabel}>{template.hint}</p>
      </div>

      <div className={css.controls}>
        <div className={css.field}>
          <span className={css.label}>Formato</span>
          <div className={css.templateRow}>
            {DESIGN_TEMPLATES.map(t => (
              <button
                key={t.key}
                type="button"
                className={`${css.chip} ${t.key === templateKey ? css.chipActive : ''}`}
                onClick={() => setTemplateKey(t.key)}
                title={t.hint}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className={css.field}>
          <span className={css.label}>Color</span>
          <div className={css.colorRow}>
            {DESIGN_COLOR_SWATCHES.map(c => (
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
          <button
            type="button"
            className={css.btnSecondary}
            onClick={handleDownloadPng}
            disabled={exporting}
          >
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
        <h4 className={css.heading}>🏷️ Diseños para Imprimir</h4>
        {!open ? (
          <button type="button" className={css.openBtn} onClick={() => setOpen(true)}>
            Diseñar
          </button>
        ) : null}
      </div>
      {open ? <DesignEditor listing={listing} onClose={() => setOpen(false)} /> : null}
    </div>
  );
};

export default ListingPoster;
