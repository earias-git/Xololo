import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
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

// Reduce una data: URL a un tamaño máximo (maxDim) para que el SVG
// serializado no explote. Logos del seller en R2 vienen a veces como
// PNG de 1-2 MB; embebidos tal cual en el SVG tiran onerror en el
// Image() por el tamaño total del data: URL. Reducirlos a 512px
// baja el peso de ~1.5 MB a ~80 KB sin pérdida visible en el poster.
const shrinkImageDataUrl = async (dataUrl, maxDim) => {
  if (!dataUrl) return null;
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = dataUrl;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    // JPEG con quality 0.85 para fotos grandes (banners); PNG si parece
    // tener transparencia (logos).
    const isPng = dataUrl.startsWith('data:image/png');
    return canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.85);
  } catch (_e) {
    return dataUrl; // mejor dejar el original que fallar silenciosamente
  }
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

const renderSvgToPngDataUrl = async (refEl, [widthPx, heightPx], embeddedFontCss) => {
  const log = [];
  // refEl puede ser el <div> wrapper del preview o el <svg> directo.
  // Si es un wrapper, extraemos el <svg> real adentro. Sin esto, el
  // Image() recibe un <div> serializado y falla con onerror genérico.
  const svgEl =
    refEl && refEl.tagName && refEl.tagName.toLowerCase() === 'svg'
      ? refEl
      : refEl.querySelector('svg');
  if (!svgEl) throw new Error('No encontré el <svg> dentro del contenedor');
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
  // Logo y banners vienen pesados de R2 (PNG original tamaño completo).
  // Los pre-comprimimos a 512px para que el SVG serializado no explote.
  const [shrunkLogoHref, setShrunkLogoHref] = useState(null);
  const [shrunkBanners, setShrunkBanners] = useState([]);

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

  // Pre-comprime logo (max 512px) y banners (max 1200px, horizontales)
  // una vez al montar. Evita el bug del SVG > 2 MB que tira onerror.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (sellerLogoDataUrl) {
        const shrunk = await shrinkImageDataUrl(sellerLogoDataUrl, 512);
        if (!cancelled) setShrunkLogoHref(shrunk);
      }
      if (banners.length > 0) {
        const shrunk = await Promise.all(
          banners.map(b => shrinkImageDataUrl(b, 1200))
        );
        if (!cancelled) setShrunkBanners(shrunk);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sellerLogoDataUrl, banners.length]);

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

  // Usamos la versión comprimida si ya está lista; si no, cae al
  // original de R2 (previewer puede verse pero el export puede fallar).
  const effectiveLogoHref = shrunkLogoHref || sellerLogoDataUrl || null;
  const activeBannerHref =
    bannerIndex >= 0 ? shrunkBanners[bannerIndex] || banners[bannerIndex] || null : null;

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
    logoHref: effectiveLogoHref,
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

// Share intents: WhatsApp, FB, X, Instagram (Web Share API en móvil),
// Copiar link. Para WhatsApp / FB / X usamos URL schemes universales
// (abren la app o la web del canal). Para Instagram (que no tiene
// scheme web) usamos Web Share API nativa cuando el browser la
// soporta — típicamente móviles — o descargamos PNG + instrucción
// "pégalo en Instagram".
const ShareBar = ({
  svgRef,
  template,
  storeName,
  storeUrl,
  rasterizeWithFallback,
  slugifyFilename,
  onError,
}) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const message = `Visita mi tienda ${storeName || ''} en Xololo`.trim();
  const shareUrl = storeUrl || (typeof window !== 'undefined' ? window.location.origin : '');
  const canNativeShare =
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function';

  // Genera el PNG y lo convierte a File para Web Share API con imagen.
  const buildImageFile = async () => {
    const svgEl = svgRef.current;
    if (!svgEl) return null;
    const dataUrl = await rasterizeWithFallback(svgEl, template.exportPx);
    const blob = await (await fetch(dataUrl)).blob();
    return new File(
      [blob],
      `xololo-tienda-${slugifyFilename(storeName)}-${template.key}.png`,
      { type: 'image/png' }
    );
  };

  const handleWhatsApp = () => {
    const url = `https://wa.me/?text=${encodeURIComponent(
      `${message}\n${shareUrl}`
    )}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleFacebook = () => {
    const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
      shareUrl
    )}&quote=${encodeURIComponent(message)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleTwitter = () => {
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
      message
    )}&url=${encodeURIComponent(shareUrl)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      onError('✓ Link copiado al portapapeles');
    } catch (_) {
      onError('No pude copiar el link. Hazlo manualmente.');
    }
  };

  // Compartir con imagen (prioridad): usa Web Share API si existe.
  // Útil para Instagram y para compartir el PNG directo en WhatsApp
  // en móviles. En desktop esta función no suele estar disponible.
  const handleNativeShare = async () => {
    setBusy(true);
    try {
      const file = await buildImageFile();
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: `Tienda ${storeName} en Xololo`,
          text: `${message}\n${shareUrl}`,
          files: [file],
        });
        onError(null);
      } else {
        // Fallback a texto + url
        await navigator.share({
          title: `Tienda ${storeName} en Xololo`,
          text: message,
          url: shareUrl,
        });
      }
    } catch (e) {
      if (e?.name !== 'AbortError') {
        onError(`Compartir falló: ${e?.message || 'error'}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleInstagramHelp = async () => {
    setBusy(true);
    try {
      const file = await buildImageFile();
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        // Fallback desktop: descargamos la imagen y damos instrucción.
        const dataUrl = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(dataUrl);
        onError(
          '✓ Imagen descargada. Súbela desde la app de Instagram en tu teléfono.'
        );
      }
    } catch (e) {
      if (e?.name !== 'AbortError') {
        onError(`Instagram: ${e?.message || 'error'}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={css.shareWrap}>
      <button
        type="button"
        className={css.shareBtn}
        onClick={() => setOpen(o => !o)}
        disabled={busy}
      >
        {busy ? 'Preparando…' : '📤 Compartir'}
      </button>
      {open ? (
        <div className={css.sharePopover}>
          {canNativeShare ? (
            <button
              type="button"
              className={css.shareOption}
              onClick={handleNativeShare}
            >
              📱 Compartir con imagen
            </button>
          ) : null}
          <button type="button" className={css.shareOption} onClick={handleWhatsApp}>
            💬 WhatsApp
          </button>
          <button type="button" className={css.shareOption} onClick={handleFacebook}>
            👥 Facebook
          </button>
          <button type="button" className={css.shareOption} onClick={handleTwitter}>
            𝕏 X / Twitter
          </button>
          <button type="button" className={css.shareOption} onClick={handleInstagramHelp}>
            📸 Instagram
          </button>
          <button type="button" className={css.shareOption} onClick={handleCopyLink}>
            🔗 Copiar link
          </button>
        </div>
      ) : null}
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

// -----------------------------------------------------------------
// Share intents (patrón del ListingCard: botones en línea, sin dropdown)
// -----------------------------------------------------------------

const isMobileUA = () => {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
};

const buildStoreShareUrl = (seller, source) => {
  if (typeof window === 'undefined') return '';
  const base =
    seller?.storeUrl ||
    (seller?.slug
      ? `${window.location.origin}/stores/${seller.slug}`
      : window.location.origin);
  try {
    const u = new URL(base);
    u.searchParams.set('utm_source', source);
    u.searchParams.set('utm_medium', 'xolo-promo');
    u.searchParams.set('utm_campaign', 'store');
    return u.toString();
  } catch (_) {
    return base;
  }
};

const buildShareText = sellerName =>
  `${sellerName || 'Mi tienda'} en Xololo\n\n¡Visítame y revisa mis productos y servicios!`;

const StorePromoShareButtons = ({ seller, sellerName }) => {
  const [copied, setCopied] = useState(null);

  const shareFacebook = () => {
    const url = buildStoreShareUrl(seller, 'facebook');
    window.open(
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
      '_blank',
      'noopener,noreferrer,width=600,height=600'
    );
  };

  const shareTwitter = () => {
    const url = buildStoreShareUrl(seller, 'twitter');
    const text = buildShareText(sellerName);
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(
        text
      )}&url=${encodeURIComponent(url)}`,
      '_blank',
      'noopener,noreferrer,width=600,height=600'
    );
  };

  const shareWhatsApp = () => {
    const url = buildStoreShareUrl(seller, 'whatsapp');
    const text = `${buildShareText(sellerName)}\n${url}`;
    window.open(
      `https://wa.me/?text=${encodeURIComponent(text)}`,
      '_blank',
      'noopener,noreferrer'
    );
  };

  const shareViaWebOrCopy = async (source, brandUrl) => {
    const url = buildStoreShareUrl(seller, source);
    const text = `${buildShareText(sellerName)}\n${url}`;
    if (isMobileUA() && navigator.share) {
      try {
        await navigator.share({ title: sellerName || 'Tienda', text, url });
        return;
      } catch (_) {
        // cancelado
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(source);
      setTimeout(() => setCopied(null), 3500);
      window.open(brandUrl, '_blank', 'noopener,noreferrer');
    } catch (_) {}
  };

  const handleCopyLink = async () => {
    const url = buildStoreShareUrl(seller, 'link');
    try {
      await navigator.clipboard.writeText(url);
      setCopied('link');
      setTimeout(() => setCopied(null), 2500);
    } catch (_) {}
  };

  return (
    <div className={css.shareLineRoot}>
      <div className={css.shareLineRow}>
        <button type="button" className={css.shareLineBtn} onClick={shareFacebook}>
          <span aria-hidden>📘</span>
          <span>Facebook</span>
        </button>
        <button
          type="button"
          className={css.shareLineBtn}
          onClick={() => shareViaWebOrCopy('instagram', 'https://www.instagram.com')}
          title="En móvil abre picker del sistema. En desktop copia el post y abre Instagram."
        >
          <span aria-hidden>📸</span>
          <span>Instagram</span>
        </button>
        <button
          type="button"
          className={css.shareLineBtn}
          onClick={() => shareViaWebOrCopy('tiktok', 'https://www.tiktok.com')}
          title="En móvil abre picker del sistema. En desktop copia el post y abre TikTok."
        >
          <span aria-hidden>🎵</span>
          <span>TikTok</span>
        </button>
        <button type="button" className={css.shareLineBtn} onClick={shareWhatsApp}>
          <span aria-hidden>💬</span>
          <span>WhatsApp</span>
        </button>
        <button type="button" className={css.shareLineBtn} onClick={shareTwitter}>
          <span aria-hidden>𝕏</span>
          <span>X / Twitter</span>
        </button>
      </div>
      <div className={css.shareLineRow}>
        <button type="button" className={css.shareLineBtn} onClick={handleCopyLink}>
          <span aria-hidden>🔗</span>
          <span>Copiar link</span>
        </button>
      </div>
      {copied === 'link' ? (
        <p className={css.shareFeedback}>✓ Link copiado al portapapeles</p>
      ) : null}
      {copied === 'instagram' ? (
        <p className={css.shareFeedback}>
          ✓ Post copiado. Abre Instagram y pega en tu Story o Publicación.
        </p>
      ) : null}
      {copied === 'tiktok' ? (
        <p className={css.shareFeedback}>
          ✓ Post copiado. Abre TikTok y pega al crear tu publicación.
        </p>
      ) : null}
    </div>
  );
};

// -----------------------------------------------------------------
// QR del storefront (patrón del ListingQRCode)
// -----------------------------------------------------------------

const StoreQRCode = ({ seller, sellerName }) => {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);

  const url = useMemo(() => buildStoreShareUrl(seller, 'qr'), [seller]);

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
        if (!cancelled) setPreview(dataUrl);
      },
      err => {
        if (!cancelled) setError(err?.message || 'qr_error');
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
      const big = await QRCode.toDataURL(url, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 1024,
        color: { dark: '#000000', light: '#ffffff' },
      });
      const a = document.createElement('a');
      a.href = big;
      a.download = `${slugifyFilename(sellerName)}-tienda-qr.png`;
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
    <div className={css.qrRoot}>
      <div className={css.qrRow}>
        <div className={css.qrBox}>
          {preview ? (
            <img src={preview} alt="Código QR de la tienda" />
          ) : (
            <span className={css.qrEmpty}>QR…</span>
          )}
        </div>
        <div className={css.qrActions}>
          <button
            type="button"
            className={css.qrBtn}
            onClick={handleDownload}
            disabled={!preview || downloading}
            title="Descarga un PNG de alta resolución (1024×1024) listo para imprimir"
          >
            <span aria-hidden>⬇️</span>
            <span>{downloading ? 'Generando…' : 'Descargar QR (PNG)'}</span>
          </button>
          <p className={css.qrHint}>Al escanearlo abre tu tienda en Xololo.</p>
        </div>
      </div>
      {error ? <p className={css.error}>No se pudo generar el QR ({error}).</p> : null}
    </div>
  );
};

// -----------------------------------------------------------------
// StorePoster: contenedor estilo ListingCard
// -----------------------------------------------------------------

const StorePoster = ({ seller, sellerLogoDataUrl, sellerName }) => {
  const [designOpen, setDesignOpen] = useState(false);
  return (
    <section className={css.cardRoot}>
      <div className={css.cardHeader}>
        {sellerLogoDataUrl ? (
          <img src={sellerLogoDataUrl} alt="" className={css.cardLogo} />
        ) : (
          <span className={css.cardLogoEmpty} aria-hidden>
            🏬
          </span>
        )}
        <div className={css.cardMain}>
          <h3 className={css.cardTitle}>{sellerName || 'Tu tienda'}</h3>
          {seller?.storeUrl ? (
            <p className={css.cardUrl}>
              {seller.storeUrl.replace(/^https?:\/\//, '')}
            </p>
          ) : null}
        </div>
      </div>

      <StorePromoShareButtons seller={seller} sellerName={sellerName} />
      <StoreQRCode seller={seller} sellerName={sellerName} />

      <div className={css.designSection}>
        <button
          type="button"
          className={css.designToggle}
          onClick={() => setDesignOpen(o => !o)}
          aria-expanded={designOpen}
        >
          <span className={css.designToggleLeft}>
            <span aria-hidden>🏷️</span>
            <strong>Diseños para Imprimir</strong>
          </span>
          <span className={css.designToggleBtn}>
            {designOpen ? 'Cerrar' : 'Diseñar'}
          </span>
        </button>
        {designOpen ? (
          <StorePosterEditor
            seller={seller}
            sellerLogoDataUrl={sellerLogoDataUrl}
            sellerName={sellerName}
            onClose={() => setDesignOpen(false)}
          />
        ) : null}
      </div>
    </section>
  );
};

export default StorePoster;
