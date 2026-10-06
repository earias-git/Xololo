import React, { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';

import {
  DESIGN_TEMPLATES,
  DESIGN_COLOR_SWATCHES,
  LOGO_ALIGNMENTS,
  LOGO_SIZE_MIN,
  LOGO_SIZE_MAX,
  LOGO_SIZE_DEFAULT,
} from './templateDesigns';
import {
  CURATED_FONTS,
  FONT_CATEGORIES,
  WEIGHT_OPTIONS,
  familyIsAvailable,
  useGoogleFontOnPage,
  buildEmbeddedFontCss,
} from './designFonts';
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
// embeddedFontCss: contenido de un <style> con @font-face a inyectar
// en el <defs> del SVG antes de serializar. Es la ÚNICA manera de que
// el <img> use una tipografía custom (no hereda del documento host).
const renderSvgToPngDataUrl = async (svgEl, [widthPx, heightPx], embeddedFontCss) => {
  const clone = svgEl.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  if (embeddedFontCss) {
    // Inserta <style> dentro del primer <defs> (o lo crea).
    let defs = clone.querySelector('defs');
    if (!defs) {
      defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      clone.insertBefore(defs, clone.firstChild);
    }
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.setAttribute('type', 'text/css');
    style.textContent = embeddedFontCss;
    defs.appendChild(style);
  }

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

const DesignEditor = ({ listing, sellerLogoDataUrl, sellerName, onClose }) => {
  const svgRef = useRef(null);
  const [templateKey, setTemplateKey] = useState(DESIGN_TEMPLATES[0].key);
  const [colorPrimary, setColorPrimary] = useState(DESIGN_COLOR_SWATCHES[0]);
  const [colorSecondary, setColorSecondary] = useState(DESIGN_COLOR_SWATCHES[5]); // negro
  const [blackWhite, setBlackWhite] = useState(false);
  const [cta, setCta] = useState('Escanéame y cómpralo en Xololo');
  const [productImgHref, setProductImgHref] = useState(null);
  const [qrHref, setQrHref] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);
  // Logo del seller: viene YA como data: URL desde el servidor (ver
  // seller-promo-listings.js), así evitamos CORS del R2. Lo usamos
  // directo en el <image> del SVG — no requiere fetch adicional.
  const logoHref = sellerLogoDataUrl || null;

  // Tipografía (sub-commit 3)
  const [fontFamily, setFontFamily] = useState(CURATED_FONTS[0].family);
  const [fontWeight, setFontWeight] = useState(700);
  const [sizeTitle, setSizeTitle] = useState(1);
  const [sizePrice, setSizePrice] = useState(1);

  // Logo del seller: alineación en la zona reservada + tamaño.
  // El logo vive ARRIBA del canvas sobre fondo blanco (no sobre la
  // banda de color primario). Seller controla alineación (←↔→) y
  // tamaño (slider LOGO_SIZE_MIN–LOGO_SIZE_MAX).
  const [logoAlign, setLogoAlign] = useState('left');
  const [logoSize, setLogoSize] = useState(LOGO_SIZE_DEFAULT);

  // Carga la familia en pantalla cuando cambie (preview). Pedimos los
  // 3 weights estándar; el hook deja los <link> inyectados en el head.
  useGoogleFontOnPage(fontFamily, [300, 400, 700]);

  // Si al cambiar de familia el weight actual no existe, baja a 400.
  useEffect(() => {
    if (!familyIsAvailable(fontFamily, fontWeight)) {
      setFontWeight(400);
    }
  }, [fontFamily, fontWeight]);

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
    colorPrimary,
    colorSecondary,
    blackWhite,
    productImgHref,
    qrHref,
    logoHref,
    sellerName: sellerName || null,
    fontFamily,
    fontWeight,
    sizeTitle,
    sizePrice,
    logoAlign,
    logoSize,
  };

  const Design = template.render;

  // Antes de exportar embebemos la fuente dentro del SVG. Si falla
  // (sin red, etc), caemos a la fuente sistema — el export sigue
  // funcionando pero la tipografía no será la custom.
  const resolveEmbeddedFontCss = async () => {
    try {
      // Pedimos sólo el weight actualmente seleccionado. Si no hay
      // familia o la combinación no existe, buildEmbeddedFontCss cae
      // al 400.
      return await buildEmbeddedFontCss(fontFamily, [fontWeight]);
    } catch (_e) {
      return null;
    }
  };

  const handleDownloadPng = async () => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    setExporting(true);
    try {
      const fontCss = await resolveEmbeddedFontCss();
      const dataUrl = await renderSvgToPngDataUrl(svgEl, template.exportPx, fontCss);
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
      const fontCss = await resolveEmbeddedFontCss();
      const pngDataUrl = await renderSvgToPngDataUrl(svgEl, template.exportPx, fontCss);
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
          <span className={css.label}>Color primario</span>
          <div className={css.colorRow}>
            {DESIGN_COLOR_SWATCHES.map(c => (
              <button
                key={c}
                type="button"
                aria-label={`Color primario ${c}`}
                className={`${css.swatch} ${c === colorPrimary ? css.swatchActive : ''}`}
                style={{ background: c }}
                onClick={() => setColorPrimary(c)}
              />
            ))}
          </div>
        </div>

        <div className={css.field}>
          <span className={css.label}>Color secundario</span>
          <div className={css.colorRow}>
            {DESIGN_COLOR_SWATCHES.map(c => (
              <button
                key={c}
                type="button"
                aria-label={`Color secundario ${c}`}
                className={`${css.swatch} ${c === colorSecondary ? css.swatchActive : ''}`}
                style={{ background: c }}
                onClick={() => setColorSecondary(c)}
              />
            ))}
          </div>
        </div>

        <div className={css.field}>
          <label className={css.toggleRow}>
            <input
              type="checkbox"
              checked={blackWhite}
              onChange={e => setBlackWhite(e.target.checked)}
            />
            <span className={css.toggleText}>Blanco y negro</span>
            <span className={css.toggleHint}>
              Convierte el diseño a escala de grises (útil para imprimir en B/N).
            </span>
          </label>
        </div>

        {logoHref || sellerName ? (
          <>
            <div className={css.field}>
              <span className={css.label}>Alineación del logo</span>
              <div className={css.posRow}>
                {LOGO_ALIGNMENTS.map(a => (
                  <button
                    key={a.key}
                    type="button"
                    className={`${css.posBtn} ${a.key === logoAlign ? css.posBtnActive : ''}`}
                    onClick={() => setLogoAlign(a.key)}
                    title={a.hint}
                    aria-label={a.hint}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={css.field}>
              <label className={css.sliderLabel} htmlFor={`logo-size-${listing.id}`}>
                <span className={css.label}>Tamaño del logo</span>
                <span className={css.sliderValue}>{logoSize}px</span>
              </label>
              <input
                id={`logo-size-${listing.id}`}
                type="range"
                min={LOGO_SIZE_MIN}
                max={LOGO_SIZE_MAX}
                step="5"
                value={logoSize}
                onChange={e => setLogoSize(Number(e.target.value))}
                className={css.slider}
              />
            </div>
          </>
        ) : null}

        <div className={css.field}>
          <label className={css.label} htmlFor={`font-${listing.id}`}>
            Tipografía
          </label>
          <select
            id={`font-${listing.id}`}
            className={css.select}
            value={fontFamily}
            onChange={e => setFontFamily(e.target.value)}
            style={{ fontFamily: `'${fontFamily}', sans-serif` }}
          >
            {FONT_CATEGORIES.map(cat => (
              <optgroup key={cat.key} label={cat.label}>
                {CURATED_FONTS.filter(f => f.category === cat.key).map(f => (
                  <option key={f.family} value={f.family} style={{ fontFamily: `'${f.family}', sans-serif` }}>
                    {f.family}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className={css.field}>
          <span className={css.label}>Grosor</span>
          <div className={css.weightRow}>
            {WEIGHT_OPTIONS.map(w => {
              const available = familyIsAvailable(fontFamily, w.value);
              return (
                <button
                  key={w.value}
                  type="button"
                  disabled={!available}
                  className={`${css.chip} ${w.value === fontWeight ? css.chipActive : ''}`}
                  onClick={() => setFontWeight(w.value)}
                  title={available ? w.label : `${w.label} no disponible en ${fontFamily}`}
                  style={{ fontWeight: w.value, fontFamily: `'${fontFamily}', sans-serif` }}
                >
                  {w.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className={css.field}>
          <label className={css.sliderLabel} htmlFor={`size-title-${listing.id}`}>
            <span className={css.label}>Tamaño del título</span>
            <span className={css.sliderValue}>{Math.round(sizeTitle * 100)}%</span>
          </label>
          <input
            id={`size-title-${listing.id}`}
            type="range"
            min="0.7"
            max="1.4"
            step="0.05"
            value={sizeTitle}
            onChange={e => setSizeTitle(Number(e.target.value))}
            className={css.slider}
          />
        </div>

        <div className={css.field}>
          <label className={css.sliderLabel} htmlFor={`size-price-${listing.id}`}>
            <span className={css.label}>Tamaño del precio</span>
            <span className={css.sliderValue}>{Math.round(sizePrice * 100)}%</span>
          </label>
          <input
            id={`size-price-${listing.id}`}
            type="range"
            min="0.7"
            max="1.4"
            step="0.05"
            value={sizePrice}
            onChange={e => setSizePrice(Number(e.target.value))}
            className={css.slider}
          />
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

const ListingPoster = ({ listing, sellerLogoDataUrl, sellerName }) => {
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
      {open ? (
        <DesignEditor
          listing={listing}
          sellerLogoDataUrl={sellerLogoDataUrl}
          sellerName={sellerName}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
};

export default ListingPoster;
