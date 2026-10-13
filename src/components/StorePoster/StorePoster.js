import React, { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';

import {
  STORE_TEMPLATES,
  STORE_COLOR_SWATCHES,
  LOGO_ALIGNMENTS,
  LOGO_SIZE_MIN,
  LOGO_SIZE_MAX,
  LOGO_SIZE_DEFAULT,
  QR_SIZE_MIN,
  QR_SIZE_MAX,
  QR_SIZE_DEFAULT,
} from './storeTemplates';
import {
  CURATED_FONTS,
  WEIGHT_OPTIONS,
  familyIsAvailable,
  useGoogleFontOnPage,
  buildEmbeddedFontCss,
} from '../ListingPoster/designFonts';

import css from './StorePoster.module.css';

// XOLOLO Promote · StorePoster — editor del póster/tarjeta de la tienda.
// Análogo al ListingPoster pero sin producto específico: promociona la
// tienda en su conjunto (logo, nombre, slug, QR a storeUrl, badges).
//
// Export:
//   - PNG (todos los templates)
//   - PDF (sólo los imprimibles — category === 'print')

const slugifyFilename = s =>
  String(s || 'xololo-tienda')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 60) || 'xololo-tienda';

const buildStoreUrl = seller => {
  if (seller?.storeUrl) {
    try {
      const u = new URL(seller.storeUrl);
      u.searchParams.set('utm_source', 'poster');
      u.searchParams.set('utm_medium', 'xolo-promo');
      u.searchParams.set('utm_campaign', 'store');
      return u.toString();
    } catch (_) {
      return seller.storeUrl;
    }
  }
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}?utm_source=poster&utm_medium=xolo-promo&utm_campaign=store`;
};

// Reemplaza cualquier <image href="URL externa"> por una placeholder
// transparente — así nunca el browser intenta cargar recursos externos
// cuando rasterice el SVG (eso rompe el canvas por CSP o CORS).
const stripExternalImages = (svgRoot, log) => {
  const images = svgRoot.querySelectorAll('image');
  images.forEach(img => {
    const href = img.getAttribute('href') || img.getAttribute('xlink:href');
    if (href && !href.startsWith('data:')) {
      log.push(`removed external image: ${href.slice(0, 60)}…`);
      img.setAttribute('href', '');
      img.setAttribute('xlink:href', '');
    }
  });
};

const renderSvgToPngDataUrl = async (svgEl, [widthPx, heightPx], embeddedFontCss) => {
  const log = [];
  const clone = svgEl.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

  // Limpieza defensiva: NO queremos imágenes externas en el SVG — tiran
  // onerror en el browser cuando se rasteriza por CSP.
  stripExternalImages(clone, log);

  if (embeddedFontCss) {
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

  // En vez de blob URL (que a veces falla silenciosamente por CSP
  // Fetch directive), usamos data: URL directa. Más confiable aunque
  // base64 agrega 33% de tamaño.
  const svgDataUrl =
    'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);

  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = ev => {
      // eslint-disable-next-line no-console
      console.error('[StorePoster] Image() onerror', ev, 'svgString length:', svgString.length);
      const err = new Error(
        `No se pudo rasterizar el SVG (${widthPx}×${heightPx}, ${svgString.length} bytes). Revisa consola para más detalle.`
      );
      err.event = ev;
      err.log = log;
      reject(err);
    };
    i.src = svgDataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, widthPx, heightPx);
  ctx.drawImage(img, 0, 0, widthPx, heightPx);
  return canvas.toDataURL('image/png');
};

const StorePosterEditor = ({ seller, sellerLogoDataUrl, sellerName, onClose }) => {
  const svgRef = useRef(null);
  const [templateKey, setTemplateKey] = useState(STORE_TEMPLATES[0].key);
  const [colorPrimary, setColorPrimary] = useState(
    seller?.brandPrimaryColor || STORE_COLOR_SWATCHES[0]
  );
  const [blackWhite, setBlackWhite] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);
  const [qrHref, setQrHref] = useState(null);

  // Toggles de elementos
  const [showLogo, setShowLogo] = useState(true);
  const [showQr, setShowQr] = useState(true);
  const [showSlug, setShowSlug] = useState(true);
  const [showCta, setShowCta] = useState(true);
  const [showTagline, setShowTagline] = useState(!!seller?.tagline);
  const [showVerified, setShowVerified] = useState(!!seller?.verified);
  const [showStats, setShowStats] = useState(
    seller?.ratingAvg != null && seller?.reviewCount > 0
  );
  const [showCategory, setShowCategory] = useState(!!seller?.primaryCategory);
  // Banner: seller puede elegir ninguno (banda sólida de color) o uno
  // de sus banners de storefront (bannerUrl / bannerUrl2 / bannerUrl3).
  const banners = seller?.bannerDataUrls || [];
  const [bannerIndex, setBannerIndex] = useState(-1); // -1 = banda sólida

  // Tamaños
  const [logoAlign, setLogoAlign] = useState('center');
  const [logoSize, setLogoSize] = useState(LOGO_SIZE_DEFAULT);
  const [qrSize, setQrSize] = useState(QR_SIZE_DEFAULT);
  const [titleScale, setTitleScale] = useState(1);

  // Tipografía
  const [fontFamily, setFontFamily] = useState(CURATED_FONTS[0].family);
  const [fontWeight, setFontWeight] = useState(700);
  useGoogleFontOnPage(fontFamily, [400, 700]);
  useEffect(() => {
    if (!familyIsAvailable(fontFamily, fontWeight)) setFontWeight(400);
  }, [fontFamily, fontWeight]);

  const storeUrl = useMemo(() => buildStoreUrl(seller), [seller]);
  const template =
    STORE_TEMPLATES.find(t => t.key === templateKey) || STORE_TEMPLATES[0];

  // QR → data URL
  useEffect(() => {
    let cancelled = false;
    if (!storeUrl) return;
    QRCode.toDataURL(storeUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 500,
      color: { dark: '#000000', light: '#ffffff' },
    }).then(dataUrl => {
      if (!cancelled) setQrHref(dataUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [storeUrl]);

  const activeBannerHref = bannerIndex >= 0 ? banners[bannerIndex] || null : null;

  const designProps = {
    storeName: sellerName || seller?.slug || 'Mi tienda',
    tagline: seller?.tagline || '',
    showTagline,
    slug: seller?.slug || '',
    storeUrl: seller?.storeUrl || null,
    verified: !!seller?.verified,
    showVerified,
    ratingAvg: seller?.ratingAvg,
    reviewCount: seller?.reviewCount || 0,
    showStats,
    primaryCategory: seller?.primaryCategory || '',
    showCategory,
    colorPrimary,
    blackWhite,
    logoHref: sellerLogoDataUrl || null,
    showLogo,
    logoAlign,
    logoSize,
    qrHref,
    showQr,
    qrSize,
    showSlug,
    showCta,
    bannerHref: activeBannerHref,
    showBanner: !!activeBannerHref,
    fontFamily,
    fontWeight,
    titleScale,
  };

  const Design = template.render;

  const resolveEmbeddedFontCss = async () => {
    try {
      return await buildEmbeddedFontCss(fontFamily, [fontWeight]);
    } catch (_) {
      return null;
    }
  };

  // Intenta rasterizar a la resolución pedida; si falla, reintenta a la
  // mitad. Si eso también falla, propaga el error.
  const rasterizeWithFallback = async (svgEl, exportPx) => {
    try {
      return await renderSvgToPngDataUrl(svgEl, exportPx, await resolveEmbeddedFontCss());
    } catch (e1) {
      // eslint-disable-next-line no-console
      console.warn('[StorePoster] primary rasterize failed, trying half:', e1.message);
      const halfPx = [Math.floor(exportPx[0] / 2), Math.floor(exportPx[1] / 2)];
      return await renderSvgToPngDataUrl(svgEl, halfPx, null);
    }
  };

  const handleDownloadPng = async () => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    setExporting(true);
    try {
      const dataUrl = await rasterizeWithFallback(svgEl, template.exportPx);
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `xololo-tienda-${slugifyFilename(sellerName)}-${template.key}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setError(null);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[StorePoster] PNG export error:', e);
      setError(`PNG: ${e?.message || e?.name || 'error'}`);
    } finally {
      setExporting(false);
    }
  };

  const handleDownloadPdf = async () => {
    const svgEl = svgRef.current;
    if (!svgEl || !template.pdf) return;
    setExporting(true);
    try {
      const { default: jsPDF } = await import('jspdf');
      const pngDataUrl = await rasterizeWithFallback(svgEl, template.exportPx);
      const { widthMm, heightMm, orientation, format } = template.pdf;
      const pdf = new jsPDF({ unit: 'mm', format, orientation, compress: true });
      pdf.addImage(pngDataUrl, 'PNG', 0, 0, widthMm, heightMm, undefined, 'FAST');
      pdf.save(`xololo-tienda-${slugifyFilename(sellerName)}-${template.key}.pdf`);
      setError(null);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[StorePoster] PDF export error:', e);
      setError(`PDF: ${e?.message || e?.name || 'error desconocido'}`);
    } finally {
      setExporting(false);
    }
  };

  const printTemplates = STORE_TEMPLATES.filter(t => t.category === 'print');
  const socialTemplates = STORE_TEMPLATES.filter(t => t.category === 'social');

  return (
    <div className={css.editorRoot}>
      <div className={css.editorToolbar}>
        <div className={css.toolbarGroup}>
          <label className={css.toolbarLabel}>Formato</label>
          <div className={css.templateCategory}>
            <small className={css.categoryHint}>Imprimible</small>
            <div className={css.templateRow}>
              {printTemplates.map(t => (
                <button
                  key={t.key}
                  type="button"
                  className={`${css.templateChip} ${
                    t.key === templateKey ? css.templateChipActive : ''
                  }`}
                  onClick={() => setTemplateKey(t.key)}
                  title={t.hint}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className={css.templateCategory}>
            <small className={css.categoryHint}>Redes sociales</small>
            <div className={css.templateRow}>
              {socialTemplates.map(t => (
                <button
                  key={t.key}
                  type="button"
                  className={`${css.templateChip} ${
                    t.key === templateKey ? css.templateChipActive : ''
                  }`}
                  onClick={() => setTemplateKey(t.key)}
                  title={t.hint}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className={css.toolbarGroup}>
          <label className={css.toolbarLabel}>Elementos</label>
          <div className={css.toggles}>
            <ToggleChip label="Logo" active={showLogo} onClick={() => setShowLogo(v => !v)} />
            <ToggleChip label="Nombre" active disabled />
            <ToggleChip label="QR" active={showQr} onClick={() => setShowQr(v => !v)} />
            <ToggleChip label="URL" active={showSlug} onClick={() => setShowSlug(v => !v)} />
            <ToggleChip label="CTA" active={showCta} onClick={() => setShowCta(v => !v)} />
            <ToggleChip
              label="Descripción"
              active={showTagline && !!seller?.tagline}
              onClick={() => setShowTagline(v => !v)}
              disabled={!seller?.tagline}
            />
            {seller?.verified ? (
              <ToggleChip
                label="✓ Verified"
                active={showVerified}
                onClick={() => setShowVerified(v => !v)}
              />
            ) : null}
            {seller?.ratingAvg != null ? (
              <ToggleChip
                label="★ Stats"
                active={showStats}
                onClick={() => setShowStats(v => !v)}
              />
            ) : null}
            {seller?.primaryCategory ? (
              <ToggleChip
                label="Categoría"
                active={showCategory}
                onClick={() => setShowCategory(v => !v)}
              />
            ) : null}
          </div>
        </div>

        {banners.length > 0 ? (
          <div className={css.toolbarGroup}>
            <label className={css.toolbarLabel}>Fondo del encabezado</label>
            <div className={css.bannerRow}>
              <button
                type="button"
                className={`${css.bannerThumb} ${
                  bannerIndex === -1 ? css.bannerThumbActive : ''
                }`}
                onClick={() => setBannerIndex(-1)}
                title="Color sólido"
              >
                <span className={css.bannerSolid} style={{ background: colorPrimary }} />
                <small>Color</small>
              </button>
              {banners.map((b, i) => (
                <button
                  key={i}
                  type="button"
                  className={`${css.bannerThumb} ${
                    bannerIndex === i ? css.bannerThumbActive : ''
                  }`}
                  onClick={() => setBannerIndex(i)}
                  title={`Banner ${i + 1}`}
                >
                  <img src={b} alt="" className={css.bannerPreview} />
                  <small>Banner {i + 1}</small>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className={css.toolbarGroup}>
          <label className={css.toolbarLabel}>Color de banda</label>
          <div className={css.swatches}>
            {STORE_COLOR_SWATCHES.map(c => (
              <button
                key={c}
                type="button"
                className={`${css.swatch} ${c === colorPrimary ? css.swatchActive : ''}`}
                style={{ background: c }}
                onClick={() => {
                  setColorPrimary(c);
                  setBlackWhite(false);
                }}
                aria-label={`Color ${c}`}
              />
            ))}
            <button
              type="button"
              className={`${css.bwBtn} ${blackWhite ? css.bwBtnActive : ''}`}
              onClick={() => setBlackWhite(v => !v)}
            >
              B/N
            </button>
          </div>
        </div>

        <div className={css.toolbarGroup}>
          <label className={css.toolbarLabel}>Tipografía</label>
          <select
            value={fontFamily}
            onChange={e => setFontFamily(e.target.value)}
            className={css.select}
          >
            {CURATED_FONTS.map(f => (
              <option key={f.family} value={f.family}>
                {f.family}
              </option>
            ))}
          </select>
          <select
            value={fontWeight}
            onChange={e => setFontWeight(Number(e.target.value))}
            className={css.select}
          >
            {WEIGHT_OPTIONS.map(w => (
              <option key={w.weight} value={w.weight}>
                {w.label}
              </option>
            ))}
          </select>
        </div>

        {showLogo ? (
          <div className={css.toolbarGroup}>
            <label className={css.toolbarLabel}>Logo</label>
            <div className={css.alignRow}>
              {LOGO_ALIGNMENTS.map(a => (
                <button
                  key={a.key}
                  type="button"
                  className={`${css.alignBtn} ${
                    logoAlign === a.key ? css.alignBtnActive : ''
                  }`}
                  onClick={() => setLogoAlign(a.key)}
                  title={a.hint}
                >
                  {a.label}
                </button>
              ))}
            </div>
            <input
              type="range"
              min={LOGO_SIZE_MIN}
              max={LOGO_SIZE_MAX}
              value={logoSize}
              onChange={e => setLogoSize(Number(e.target.value))}
              className={css.slider}
            />
            <small className={css.sliderHint}>Tamaño del logo</small>
          </div>
        ) : null}

        {showQr ? (
          <div className={css.toolbarGroup}>
            <label className={css.toolbarLabel}>QR</label>
            <input
              type="range"
              min={QR_SIZE_MIN}
              max={QR_SIZE_MAX}
              value={qrSize}
              onChange={e => setQrSize(Number(e.target.value))}
              className={css.slider}
            />
            <small className={css.sliderHint}>Tamaño del QR</small>
          </div>
        ) : null}

        <div className={css.toolbarGroup}>
          <label className={css.toolbarLabel}>Tamaño del nombre</label>
          <input
            type="range"
            min={0.7}
            max={1.4}
            step={0.05}
            value={titleScale}
            onChange={e => setTitleScale(Number(e.target.value))}
            className={css.slider}
          />
        </div>
      </div>

      <div className={css.previewWrap}>
        <div className={css.previewFrame} ref={svgRef}>
          <Design {...designProps} />
        </div>
      </div>

      {error ? <p className={css.error}>Error al exportar: {error}</p> : null}

      <div className={css.actions}>
        <button
          type="button"
          className={css.primaryBtn}
          onClick={handleDownloadPng}
          disabled={exporting}
        >
          {exporting ? 'Generando…' : '📷 Descargar PNG'}
        </button>
        {template.pdf ? (
          <button
            type="button"
            className={css.secondaryBtn}
            onClick={handleDownloadPdf}
            disabled={exporting}
          >
            {exporting ? 'Generando…' : '📄 Descargar PDF'}
          </button>
        ) : null}
        {onClose ? (
          <button type="button" className={css.linkBtn} onClick={onClose}>
            Cerrar
          </button>
        ) : null}
      </div>
    </div>
  );
};

const ToggleChip = ({ label, active, onClick, disabled }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className={`${css.chip} ${active ? css.chipActive : ''} ${
      disabled ? css.chipDisabled : ''
    }`}
  >
    {active ? '✓ ' : ''}
    {label}
  </button>
);

const StorePoster = ({ seller, sellerLogoDataUrl, sellerName }) => {
  const [open, setOpen] = useState(false);
  return (
    <section className={css.storePromoCard}>
      <div className={css.storePromoHeader}>
        <div>
          <h3 className={css.storePromoTitle}>Diseños para promocionar tu tienda</h3>
          <p className={css.storePromoSubtitle}>
            Crea un póster o publicación con el logo, QR y URL de tu tienda. 6
            formatos listos para imprimir o compartir en redes.
          </p>
        </div>
        <button
          type="button"
          className={css.openBtn}
          onClick={() => setOpen(o => !o)}
        >
          {open ? 'Cerrar editor' : '✨ Abrir editor'}
        </button>
      </div>
      {open ? (
        <StorePosterEditor
          seller={seller}
          sellerLogoDataUrl={sellerLogoDataUrl}
          sellerName={sellerName}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  );
};

export default StorePoster;
