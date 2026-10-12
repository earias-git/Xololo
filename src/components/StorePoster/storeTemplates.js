import React from 'react';

// XOLOLO Promote · StorePoster — 6 templates para promocionar la TIENDA
// (no un producto específico).
//
// 3 imprimibles + 3 digitales (RRSS / WhatsApp):
//   1. Carta vertical 21.6×28 cm        — para pegar en muro/vitrina
//   2. Media carta vertical 14×21.6 cm  — para posters chicos
//   3. Cuadrado 20×20 cm                — para empaques y pizarras
//   4. IG/FB Post 1080×1080             — publicación en feed
//   5. IG/FB Story 1080×1920            — stories, también sirve WA Estado
//   6. Portada link 1200×628            — preview de link en WA/FB share
//
// Todos renderizan la misma composición semántica. Lo que cambia es la
// grilla y la jerarquía visual (más grande vs más chico), no el
// contenido. Elementos del seller controlables desde el editor:
//   - Logo (toggle + alineación L/C/R + tamaño)
//   - Nombre de la tienda (tamaño)
//   - Tagline / short description (toggle)
//   - Slug / URL (toggle)
//   - QR (toggle + tamaño) — enlaza a https://<slug>.xololo.mx
//   - Verified badge (toggle, sólo si seller.verified===true)
//   - Rating + ventas (toggle, sólo si hay datos)
//   - Categoría primaria (toggle)
//   - Color de banda (6 swatches)
//   - Tipografía (reusa `designFonts.js` del ListingPoster)
//
// Mismo motor que ListingPoster: SVG inline → canvas → PNG, y jsPDF
// para los imprimibles. Para los digitales se exporta sólo PNG.

// ----- Constantes compartidas -----

export const LOGO_ALIGNMENTS = [
  { key: 'left', label: '←', hint: 'Izquierda' },
  { key: 'center', label: '↔', hint: 'Centrado' },
  { key: 'right', label: '→', hint: 'Derecha' },
];

export const STORE_COLOR_SWATCHES = [
  '#ff6b35', '#2d7a46', '#1e40af', '#be185d', '#f59e0b', '#111111',
];

export const LOGO_SIZE_MIN = 80;
export const LOGO_SIZE_MAX = 560;
export const LOGO_SIZE_DEFAULT = 220;

export const QR_SIZE_MIN = 200;
export const QR_SIZE_MAX = 900;
export const QR_SIZE_DEFAULT = 500;

// ----- Helpers de render -----

const wrapTspans = (text, fontPx, maxWidthPx, maxLines) => {
  const avgCharWidth = fontPx * 0.55;
  const maxChars = Math.max(6, Math.floor(maxWidthPx / avgCharWidth));
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (test.length > maxChars && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  const used = lines.slice(0, maxLines);
  if (lines.length > maxLines && used.length > 0) {
    const last = used[used.length - 1];
    used[used.length - 1] =
      last.length > maxChars - 1 ? last.slice(0, maxChars - 1) + '…' : last + '…';
  }
  return used;
};

const QrOrPlaceholder = ({ href, x, y, size }) => {
  if (href) {
    return (
      <image
        href={href}
        x={x}
        y={y}
        width={size}
        height={size}
        preserveAspectRatio="xMidYMid meet"
      />
    );
  }
  return (
    <g>
      <rect x={x} y={y} width={size} height={size} fill="#f3f4f6" rx={size * 0.04} />
      <text
        x={x + size / 2}
        y={y + size / 2 + 10}
        textAnchor="middle"
        fontSize={size * 0.14}
        fill="#9ca3af"
      >
        QR
      </text>
    </g>
  );
};

const LogoOrText = ({
  href,
  sellerName,
  align,
  size,
  bandY,
  canvasW,
  padding,
}) => {
  let x = padding;
  if (align === 'center') x = (canvasW - size) / 2;
  if (align === 'right') x = canvasW - padding - size;
  if (href) {
    return (
      <image
        href={href}
        x={x}
        y={bandY}
        width={size}
        height={size}
        preserveAspectRatio="xMidYMid meet"
      />
    );
  }
  // Si no hay logo, mostramos "inicial + nombre" como lockup compacto
  const initial = (sellerName || '?').trim().charAt(0).toUpperCase();
  return (
    <g>
      <circle
        cx={x + size / 2}
        cy={bandY + size / 2}
        r={size / 2}
        fill="#0e1a2f"
      />
      <text
        x={x + size / 2}
        y={bandY + size / 2 + size * 0.14}
        textAnchor="middle"
        fontSize={size * 0.5}
        fill="#ffffff"
        fontWeight={700}
      >
        {initial}
      </text>
    </g>
  );
};

const VerifiedPill = ({ x, y, scale = 1 }) => (
  <g transform={`translate(${x},${y}) scale(${scale})`}>
    <rect
      x={0}
      y={0}
      width={210}
      height={46}
      rx={23}
      fill="#1e40af"
    />
    <text
      x={18}
      y={30}
      fontSize={20}
      fill="#ffffff"
      fontWeight={700}
    >
      ✓ Xololo Verified
    </text>
  </g>
);

const StarsLine = ({ x, y, ratingAvg, reviewCount, fontPx, fill = '#111111' }) => {
  const stars = '★★★★★';
  const pct = Math.max(0, Math.min(5, Number(ratingAvg) || 0)) / 5;
  return (
    <g>
      <text x={x} y={y} fontSize={fontPx} fill="#e5e7eb">
        {stars}
      </text>
      <text x={x} y={y} fontSize={fontPx} fill="#f59e0b" clipPath={`inset(0 ${100 - pct * 100}% 0 0)`}>
        {stars}
      </text>
      <text x={x + fontPx * 3.4} y={y} fontSize={fontPx * 0.6} fill={fill}>
        {(Number(ratingAvg) || 0).toFixed(1)} ({reviewCount} ventas)
      </text>
    </g>
  );
};

// ----- Composición base: todos los templates comparten estructura y
// solo cambian las dimensiones base del canvas. -----

const buildDesign = ({ widthU, heightU, isHorizontal = false }) => props => {
  const {
    storeName,
    tagline,
    showTagline,
    slug,
    storeUrl,
    verified,
    showVerified,
    ratingAvg,
    reviewCount,
    showStats,
    primaryCategory,
    showCategory,
    colorPrimary,
    blackWhite,
    logoHref,
    showLogo,
    logoAlign,
    logoSize,
    qrHref,
    showQr,
    qrSize,
    showSlug,
    showCta,
    fontFamily,
    fontWeight,
    titleScale,
    // Banner opcional como background del header (reemplaza la banda).
    bannerHref,
    showBanner,
  } = props;

  const padding = Math.max(48, widthU * 0.045);
  const bandColor = blackWhite ? '#111111' : colorPrimary;
  const textOnBand = '#ffffff';

  // Logo. Clampeamos a la mitad del canvas máx para que nunca se salga.
  const effectiveLogoSize = Math.min(logoSize, Math.min(widthU, heightU) * 0.5);
  const logoY = padding;
  const headerBottom = logoY + (showLogo ? effectiveLogoSize : 0) + 40;

  // Banda / banner detrás del nombre.
  const bandY = headerBottom + 20;
  const bandH = Math.max(260, heightU * 0.16) * titleScale;

  // Nombre tienda. En el canvas horizontal el tamaño relativo es menor.
  const nameFontBase = isHorizontal ? heightU * 0.14 : heightU * 0.07;
  const nameFontPx = Math.max(50, nameFontBase) * titleScale;
  const nameLines = wrapTspans(
    storeName || 'Mi tienda',
    nameFontPx,
    widthU - padding * 2 - 40,
    2
  );

  // Elementos opcionales debajo de la banda. Empujamos la Y conforme
  // vamos usando cosas, para que nada se encime.
  let cursorY = bandY + bandH + 40;
  if (showTagline && tagline) {
    cursorY += Math.max(60, heightU * 0.045);
  }
  if (showStats && ratingAvg != null) {
    cursorY += Math.max(90, heightU * 0.07);
  }
  if (showCategory && primaryCategory) {
    cursorY += Math.max(60, heightU * 0.045);
  }

  // Clamp del QR al espacio real disponible.
  const slugFontPx = Math.max(28, heightU * 0.025);
  const ctaFontPx = Math.max(26, heightU * 0.022);
  const bottomReserved =
    (showSlug && slug ? slugFontPx + 20 : 0) +
    (showCta ? ctaFontPx + 20 : 0) +
    padding;
  const spaceForQr = heightU - cursorY - bottomReserved;
  const effectiveQrSize = showQr
    ? Math.max(120, Math.min(qrSize, spaceForQr, widthU - padding * 2))
    : 0;
  const qrX = (widthU - effectiveQrSize) / 2;
  const qrY = showQr ? cursorY : cursorY;

  // Ancho/alto reales del banner → cubre todo el header hasta antes de
  // la banda. Si no hay banner, usamos banda sólida.
  const bannerY = 0;
  const bannerH = showBanner && bannerHref ? bandY + bandH : 0;

  return (
    <svg
      viewBox={`0 0 ${widthU} ${heightU}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block', width: '100%', height: 'auto', fontFamily, fontWeight }}
    >
      {/* Fondo blanco */}
      <rect x={0} y={0} width={widthU} height={heightU} fill="#ffffff" />

      {/* Banner opcional (reemplaza la banda sólida) */}
      {showBanner && bannerHref ? (
        <>
          <image
            href={bannerHref}
            x={0}
            y={bannerY}
            width={widthU}
            height={bannerH}
            preserveAspectRatio="xMidYMid slice"
          />
          <rect x={0} y={bannerY} width={widthU} height={bannerH} fill="rgba(0,0,0,0.35)" />
        </>
      ) : (
        <rect x={0} y={bandY} width={widthU} height={bandH} fill={bandColor} />
      )}

      {/* Logo */}
      {showLogo ? (
        <LogoOrText
          href={logoHref}
          sellerName={storeName}
          align={logoAlign}
          size={effectiveLogoSize}
          bandY={logoY}
          canvasW={widthU}
          padding={padding}
        />
      ) : null}

      {/* Badge Verified */}
      {verified && showVerified ? (
        <VerifiedPill
          x={widthU - padding - 240}
          y={logoY + 10}
          scale={Math.max(0.9, Math.min(1.6, effectiveLogoSize / 180))}
        />
      ) : null}

      {/* Nombre de la tienda sobre la banda / banner */}
      <text
        x={widthU / 2}
        y={bandY + bandH / 2 + nameFontPx * 0.1 - (nameLines.length - 1) * nameFontPx * 0.5}
        textAnchor="middle"
        fontSize={nameFontPx}
        fontWeight={fontWeight > 500 ? fontWeight : 700}
        fill={textOnBand}
      >
        {nameLines.map((l, i) => (
          <tspan key={i} x={widthU / 2} dy={i === 0 ? 0 : nameFontPx * 1.1}>
            {l}
          </tspan>
        ))}
      </text>

      {/* Tagline (toggleable) */}
      {showTagline && tagline ? (
        <text
          x={widthU / 2}
          y={bandY + bandH + Math.max(60, heightU * 0.04)}
          textAnchor="middle"
          fontSize={Math.max(28, heightU * 0.024)}
          fill="#4b5563"
        >
          {tagline.length > 90 ? tagline.slice(0, 87) + '…' : tagline}
        </text>
      ) : null}

      {/* Stats */}
      {showStats && ratingAvg != null ? (
        <StarsLine
          x={widthU / 2 - 180}
          y={bandY + bandH + Math.max(140, heightU * 0.085)}
          ratingAvg={ratingAvg}
          reviewCount={reviewCount}
          fontPx={Math.max(44, heightU * 0.034)}
        />
      ) : null}

      {/* Categoría */}
      {showCategory && primaryCategory ? (
        <text
          x={widthU / 2}
          y={cursorY - Math.max(30, heightU * 0.02)}
          textAnchor="middle"
          fontSize={Math.max(22, heightU * 0.018)}
          fill="#6b7280"
          letterSpacing="0.15em"
        >
          {String(primaryCategory).toUpperCase()}
        </text>
      ) : null}

      {/* QR grande centrado */}
      {showQr && effectiveQrSize > 0 ? (
        <QrOrPlaceholder href={qrHref} x={qrX} y={qrY} size={effectiveQrSize} />
      ) : null}

      {/* slug / URL */}
      {showSlug && slug ? (
        <text
          x={widthU / 2}
          y={heightU - padding - (showCta ? ctaFontPx + 30 : 20)}
          textAnchor="middle"
          fontSize={slugFontPx}
          fontWeight={700}
          fill="#111111"
        >
          {storeUrl ? storeUrl.replace(/^https?:\/\//, '') : `${slug}.xololo.mx`}
        </text>
      ) : null}

      {/* CTA */}
      {showCta ? (
        <text
          x={widthU / 2}
          y={heightU - padding - 20}
          textAnchor="middle"
          fontSize={ctaFontPx}
          fill="#6b7280"
        >
          {showQr ? 'Escanéame y visita mi tienda en Xololo' : 'Visítame en Xololo'}
        </text>
      ) : null}
    </svg>
  );
};

// ----- Catálogo de 6 templates -----

export const STORE_TEMPLATES = [
  {
    key: 'letter_vertical',
    label: 'Carta vertical',
    category: 'print',
    hint: '21.6 × 28 cm · para muro / vitrina',
    width: 2160,
    height: 2800,
    exportPx: [2550, 3300], // 300 DPI
    pdf: { widthMm: 215.9, heightMm: 279.4, orientation: 'portrait', format: 'letter' },
    render: buildDesign({ widthU: 2160, heightU: 2800 }),
  },
  {
    key: 'half_letter',
    label: 'Media carta',
    category: 'print',
    hint: '14 × 21.6 cm · posters chicos',
    width: 1400,
    height: 2160,
    exportPx: [1654, 2551],
    pdf: { widthMm: 139.7, heightMm: 215.9, orientation: 'portrait', format: [139.7, 215.9] },
    render: buildDesign({ widthU: 1400, heightU: 2160 }),
  },
  {
    key: 'square_print',
    label: 'Cuadrado 20×20',
    category: 'print',
    hint: '20 × 20 cm · empaques, pizarras',
    width: 2000,
    height: 2000,
    exportPx: [2362, 2362],
    pdf: { widthMm: 200, heightMm: 200, orientation: 'portrait', format: [200, 200] },
    render: buildDesign({ widthU: 2000, heightU: 2000 }),
  },
  {
    key: 'ig_post',
    label: 'IG / FB Post',
    category: 'social',
    hint: '1080 × 1080 · publicación en feed',
    width: 1080,
    height: 1080,
    exportPx: [1080, 1080],
    pdf: null,
    render: buildDesign({ widthU: 1080, heightU: 1080 }),
  },
  {
    key: 'ig_story',
    label: 'IG Story / WhatsApp Estado',
    category: 'social',
    hint: '1080 × 1920 · stories y WhatsApp',
    width: 1080,
    height: 1920,
    exportPx: [1080, 1920],
    pdf: null,
    render: buildDesign({ widthU: 1080, heightU: 1920 }),
  },
  {
    key: 'link_preview',
    label: 'Portada link',
    category: 'social',
    hint: '1200 × 628 · preview en WhatsApp/FB',
    width: 1200,
    height: 628,
    exportPx: [1200, 628],
    pdf: null,
    render: buildDesign({ widthU: 1200, heightU: 628, isHorizontal: true }),
  },
];
