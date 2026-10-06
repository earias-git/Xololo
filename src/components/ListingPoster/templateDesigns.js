import React from 'react';

// XOLOLO Promote · Diseños para Imprimir — rediseño limpio.
//
// Cambio arquitectural vs iteración anterior: el logo del seller YA
// NO se posiciona libremente en 5 esquinas (los experimentos
// mostraron colisiones garantizadas contra título/imagen/precio/QR).
// Ahora cada template tiene UNA zona reservada dedicada al logo
// (siempre en el header), y el seller controla únicamente:
//   - su ALINEACIÓN horizontal dentro de esa zona (izq / centro / der)
//   - su TAMAÑO (slider)
// El header crece dinámicamente para acomodar el logo + título sin
// pisar el resto del diseño.
//
// Dimensiones físicas (para el PDF, el motor convierte el viewBox al
// tamaño real en mm):
//   poster      — carta vertical 215.9 × 279.4 mm
//   labelH      — etiqueta horizontal 100 × 70 mm
//   labelV      — etiqueta vertical 70 × 100 mm
//
// Props que recibe cada draw:
//   { title, price, cta, colorPrimary, colorSecondary, blackWhite,
//     productImgHref, qrHref, logoHref, sellerName,
//     fontFamily, fontWeight, sizeTitle, sizePrice,
//     logoAlign, logoSize }
//
// logoAlign: 'left' | 'center' | 'right'.
// logoSize: alto/ancho del logo en units del viewBox (40-120 default).

// --- Constantes ---
const LOGO_PADDING = 14;
const LOGO_BADGE_RADIUS = 10;

export const LOGO_ALIGNMENTS = [
  { key: 'left', label: '←', hint: 'Izquierda' },
  { key: 'center', label: '↔', hint: 'Centrado' },
  { key: 'right', label: '→', hint: 'Derecha' },
];

export const DESIGN_COLOR_SWATCHES = [
  '#ff6b35', // naranja
  '#2d7a46', // verde
  '#1e40af', // azul
  '#be185d', // magenta
  '#f59e0b', // ámbar
  '#111111', // negro
];

// --- Helpers ---

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

const ImageOrPlaceholder = ({ href, x, y, w, h, rx = 16, placeholder = '📦' }) => {
  const clipId = `clip-${x}-${y}-${w}-${h}`;
  if (href) {
    return (
      <g>
        <defs>
          <clipPath id={clipId}>
            <rect x={x} y={y} width={w} height={h} rx={rx} />
          </clipPath>
        </defs>
        <image
          href={href}
          x={x}
          y={y}
          width={w}
          height={h}
          preserveAspectRatio="xMidYMid slice"
          clipPath={`url(#${clipId})`}
        />
      </g>
    );
  }
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={rx} fill="#f2f2f2" />
      <text
        x={x + w / 2}
        y={y + h / 2}
        fontSize={Math.min(w, h) * 0.25}
        textAnchor="middle"
        dominantBaseline="central"
        fill="#bbbbbb"
      >
        {placeholder}
      </text>
    </g>
  );
};

// BrandMark con cascada:
//   1) logoHref → <image> embebido en un badge blanco (padding).
//   2) sellerName → <text>.
//   3) null + null → no renderiza nada.
// anchorX, anchorY definen la esquina SUPERIOR-IZQUIERDA del área
// disponible para el logo. align decide dónde se coloca dentro.
// zoneWidth es el ancho de la zona reservada.
const BrandMark = ({
  logoHref,
  sellerName,
  anchorX,
  anchorY,
  zoneWidth,
  size,
  align = 'left',
  textColor,
}) => {
  // Posicionamiento horizontal del logo (ya con padding del badge).
  const effectiveWidth = size;
  let imgX;
  if (align === 'center') imgX = anchorX + (zoneWidth - effectiveWidth) / 2;
  else if (align === 'right') imgX = anchorX + zoneWidth - effectiveWidth;
  else imgX = anchorX;

  if (logoHref) {
    return (
      <g>
        <rect
          x={imgX - LOGO_PADDING}
          y={anchorY - LOGO_PADDING}
          width={effectiveWidth + LOGO_PADDING * 2}
          height={size + LOGO_PADDING * 2}
          fill="#ffffff"
          rx={LOGO_BADGE_RADIUS}
        />
        <image
          href={logoHref}
          x={imgX}
          y={anchorY}
          width={effectiveWidth}
          height={size}
          preserveAspectRatio="xMidYMid meet"
        />
      </g>
    );
  }
  if (sellerName) {
    const name = String(sellerName).trim();
    const truncated = name.length > 24 ? name.slice(0, 23) + '…' : name;
    const fontPx = size * 0.55;
    // Para texto usamos el centro vertical del área del logo.
    const textY = anchorY + size * 0.72;
    let textX;
    let textAnchor;
    if (align === 'center') {
      textX = anchorX + zoneWidth / 2;
      textAnchor = 'middle';
    } else if (align === 'right') {
      textX = anchorX + zoneWidth;
      textAnchor = 'end';
    } else {
      textX = anchorX;
      textAnchor = 'start';
    }
    return (
      <text
        x={textX}
        y={textY}
        fontSize={fontPx}
        fontWeight={800}
        fill={textColor}
        textAnchor={textAnchor}
      >
        {truncated}
      </text>
    );
  }
  return null;
};

// Filtro B/N aplicable al root <g>. Matrix grayscale ITU-R BT.601.
const BlackWhiteFilterDefs = () => (
  <defs>
    <filter id="xolo-bw" colorInterpolationFilters="sRGB">
      <feColorMatrix
        type="matrix"
        values="0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0 0 0 1 0"
      />
    </filter>
  </defs>
);

const FALLBACK_STACK = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const fontStack = family => (family ? `'${family}', ${FALLBACK_STACK}` : FALLBACK_STACK);
const px = (base, scale = 1) => Math.round(base * (scale || 1));

// ============================================================
// Template 1: Póster carta vertical — viewBox 850×1100
// ============================================================
// Header dinámico: logo arriba (sobre badge blanco dentro de la banda
// de color primario) + título debajo. Si no hay logo, el header queda
// con sólo el título (altura 180 como antes).
const PosterDesign = props => {
  const {
    title,
    price,
    cta,
    colorPrimary,
    colorSecondary,
    blackWhite,
    productImgHref,
    qrHref,
    logoHref,
    sellerName,
    fontFamily,
    fontWeight = 700,
    sizeTitle = 1,
    sizePrice = 1,
    logoAlign = 'left',
    logoSize = 70,
  } = props;

  const titleFontPx = px(40, sizeTitle);
  const priceFontPx = px(92, sizePrice);
  const titleLines = wrapTspans(title, titleFontPx, 760, 2);
  const titleHeight = titleLines.length * titleFontPx * 1.15;
  const hasBrand = !!(logoHref || sellerName);

  // Alturas del header
  const HEADER_PAD_TOP = 30;
  const HEADER_PAD_BOTTOM = 30;
  const LOGO_TITLE_GAP = 18;
  const logoAreaH = hasBrand ? logoSize + LOGO_PADDING * 2 : 0;
  const minHeaderH = 180;
  const computedHeaderH =
    HEADER_PAD_TOP +
    logoAreaH +
    (hasBrand ? LOGO_TITLE_GAP : 0) +
    titleHeight +
    HEADER_PAD_BOTTOM;
  const headerH = Math.max(minHeaderH, computedHeaderH);

  // Posicionamiento
  const logoAnchorX = 50;
  const logoZoneW = 750; // 850 - 2*50
  const logoAnchorY = HEADER_PAD_TOP + LOGO_PADDING;
  const titleBaselineY =
    HEADER_PAD_TOP + logoAreaH + (hasBrand ? LOGO_TITLE_GAP : 0) + titleFontPx;

  // Imagen debajo del header. Altura dinámica para que el footer quede fijo.
  const imgY = headerH + 20;
  const imgEnd = 740; // termina en y=740 como antes
  const imgH = Math.max(300, imgEnd - imgY);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 850 1100"
      preserveAspectRatio="xMidYMid meet"
      fontFamily={fontStack(fontFamily)}
    >
      <BlackWhiteFilterDefs />
      <g filter={blackWhite ? 'url(#xolo-bw)' : undefined}>
        <rect x={0} y={0} width={850} height={1100} fill="#ffffff" />

        {/* Banda del header — color primario */}
        <rect x={0} y={0} width={850} height={headerH} fill={colorPrimary} />

        {/* Logo (si existe) dentro del header, badge blanco */}
        {hasBrand ? (
          <BrandMark
            logoHref={logoHref}
            sellerName={sellerName}
            anchorX={logoAnchorX}
            anchorY={logoAnchorY}
            zoneWidth={logoZoneW}
            size={logoSize}
            align={logoAlign}
            textColor="#ffffff"
          />
        ) : null}

        {/* Título (todo el ancho de la banda, align a la izquierda) */}
        <text x={50} y={titleBaselineY} fontSize={titleFontPx} fontWeight={fontWeight} fill="#ffffff">
          {titleLines.map((l, i) => (
            <tspan key={i} x={50} dy={i === 0 ? 0 : titleFontPx * 1.15}>
              {l}
            </tspan>
          ))}
        </text>

        {/* Imagen producto */}
        <ImageOrPlaceholder href={productImgHref} x={100} y={imgY} w={650} h={imgH} rx={24} />

        {/* Precio */}
        <text
          x={425}
          y={820}
          fontSize={priceFontPx}
          fontWeight={fontWeight === 300 ? 400 : fontWeight}
          textAnchor="middle"
          fill={colorSecondary}
        >
          {price}
        </text>

        {/* CTA — centrado en el área izquierda al QR (x≈602-800) */}
        <text
          x={315}
          y={920}
          fontSize={26}
          fontWeight={fontWeight}
          textAnchor="middle"
          fill="#555555"
        >
          {wrapTspans(cta, 26, 530, 2).map((l, i) => (
            <tspan key={i} x={315} dy={i === 0 ? 0 : 30}>
              {l}
            </tspan>
          ))}
        </text>

        {/* QR abajo derecha */}
        {qrHref ? (
          <g>
            <rect x={602} y={852} width={196} height={196} fill="#ffffff" />
            <image href={qrHref} x={610} y={860} width={180} height={180} />
          </g>
        ) : null}
      </g>
    </svg>
  );
};

// ============================================================
// Template 2: Etiqueta horizontal 10×7cm — viewBox 1000×700
// ============================================================
// Dos columnas: imagen izquierda, info derecha. El logo (si existe)
// ocupa una banda arriba de la columna derecha. Siempre sobre blanco.
const LabelHorizontalDesign = props => {
  const {
    title,
    price,
    cta,
    colorPrimary,
    colorSecondary,
    blackWhite,
    productImgHref,
    qrHref,
    logoHref,
    sellerName,
    fontFamily,
    fontWeight = 700,
    sizeTitle = 1,
    sizePrice = 1,
    logoAlign = 'left',
    logoSize = 60,
  } = props;

  const titleFontPx = px(34, sizeTitle);
  const priceFontPx = px(78, sizePrice);
  const titleLines = wrapTspans(title, titleFontPx, 480, 2);
  const hasBrand = !!(logoHref || sellerName);

  // Zona info (columna derecha): x=490 a x=970 (ancho 480).
  const INFO_X = 490;
  const INFO_W = 480;
  const INFO_PAD_TOP = 30;
  const logoAreaH = hasBrand ? logoSize + LOGO_PADDING * 2 : 0;
  const titleY = INFO_PAD_TOP + logoAreaH + (hasBrand ? 20 : 0) + titleFontPx;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1000 700"
      preserveAspectRatio="xMidYMid meet"
      fontFamily={fontStack(fontFamily)}
    >
      <BlackWhiteFilterDefs />
      <g filter={blackWhite ? 'url(#xolo-bw)' : undefined}>
        <rect x={0} y={0} width={1000} height={700} fill="#ffffff" />

        {/* Marco color primario */}
        <rect
          x={0}
          y={0}
          width={1000}
          height={700}
          fill="none"
          stroke={colorPrimary}
          strokeWidth={10}
        />

        {/* Imagen producto izquierda */}
        <ImageOrPlaceholder href={productImgHref} x={30} y={30} w={420} h={640} rx={16} />

        {/* Logo (si existe) arriba de la columna derecha, sobre blanco */}
        {hasBrand ? (
          <BrandMark
            logoHref={logoHref}
            sellerName={sellerName}
            anchorX={INFO_X}
            anchorY={INFO_PAD_TOP + LOGO_PADDING}
            zoneWidth={INFO_W}
            size={logoSize}
            align={logoAlign}
            textColor={colorPrimary}
          />
        ) : null}

        {/* Título */}
        <text x={INFO_X} y={titleY} fontSize={titleFontPx} fontWeight={fontWeight} fill="#111111">
          {titleLines.map((l, i) => (
            <tspan key={i} x={INFO_X} dy={i === 0 ? 0 : titleFontPx * 1.17}>
              {l}
            </tspan>
          ))}
        </text>

        {/* Línea decorativa (color secundario) */}
        <line
          x1={INFO_X}
          y1={titleY + 70}
          x2={INFO_X + 210}
          y2={titleY + 70}
          stroke={colorSecondary}
          strokeWidth={4}
        />

        {/* Precio */}
        <text
          x={INFO_X}
          y={titleY + 170}
          fontSize={priceFontPx}
          fontWeight={fontWeight === 300 ? 400 : fontWeight}
          fill={colorSecondary}
        >
          {price}
        </text>

        {/* CTA */}
        <text x={INFO_X} y={titleY + 240} fontSize={20} fontWeight={fontWeight} fill="#444444">
          {cta}
        </text>

        {/* QR abajo derecha */}
        {qrHref ? <image href={qrHref} x={760} y={450} width={210} height={210} /> : null}
      </g>
    </svg>
  );
};

// ============================================================
// Template 3: Etiqueta vertical 7×10cm — viewBox 700×1000
// ============================================================
// Banda superior de color primario donde vive el logo (si existe).
// La banda crece dinámicamente para alojar el logo. Debajo: imagen,
// título, precio, CTA, QR.
const LabelVerticalDesign = props => {
  const {
    title,
    price,
    cta,
    colorPrimary,
    colorSecondary,
    blackWhite,
    productImgHref,
    qrHref,
    logoHref,
    sellerName,
    fontFamily,
    fontWeight = 700,
    sizeTitle = 1,
    sizePrice = 1,
    logoAlign = 'left',
    logoSize = 60,
  } = props;

  const titleFontPx = px(36, sizeTitle);
  const priceFontPx = px(82, sizePrice);
  const titleLines = wrapTspans(title, titleFontPx, 580, 2);
  const hasBrand = !!(logoHref || sellerName);

  // Banda del header: 80 por default; crece con el logo.
  const minBand = 80;
  const bandH = hasBrand
    ? Math.max(minBand, logoSize + LOGO_PADDING * 2 + 30)
    : minBand;

  const LOGO_ZONE_X = 30;
  const LOGO_ZONE_W = 640; // 700 - 2*30
  const logoAnchorY = (bandH - logoSize) / 2;

  // Layout vertical del resto: imagen → título → precio → QR.
  const imgY = bandH + 20;
  const imgH = 440;
  const titleY = imgY + imgH + 60;
  const priceY = titleY + titleLines.length * titleFontPx * 1.17 + 50;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 700 1000"
      preserveAspectRatio="xMidYMid meet"
      fontFamily={fontStack(fontFamily)}
    >
      <BlackWhiteFilterDefs />
      <g filter={blackWhite ? 'url(#xolo-bw)' : undefined}>
        <rect x={0} y={0} width={700} height={1000} fill="#ffffff" />

        {/* Banda del header */}
        <rect x={0} y={0} width={700} height={bandH} fill={colorPrimary} />

        {/* Logo dentro de la banda — badge blanco */}
        {hasBrand ? (
          <BrandMark
            logoHref={logoHref}
            sellerName={sellerName}
            anchorX={LOGO_ZONE_X}
            anchorY={logoAnchorY}
            zoneWidth={LOGO_ZONE_W}
            size={logoSize}
            align={logoAlign}
            textColor="#ffffff"
          />
        ) : null}

        {/* Imagen producto */}
        <ImageOrPlaceholder href={productImgHref} x={50} y={imgY} w={600} h={imgH} rx={16} />

        {/* Título */}
        <text
          x={350}
          y={titleY}
          fontSize={titleFontPx}
          fontWeight={fontWeight}
          textAnchor="middle"
          fill="#111111"
        >
          {titleLines.map((l, i) => (
            <tspan key={i} x={350} dy={i === 0 ? 0 : titleFontPx * 1.17}>
              {l}
            </tspan>
          ))}
        </text>

        {/* Precio */}
        <text
          x={350}
          y={priceY}
          fontSize={priceFontPx}
          fontWeight={fontWeight === 300 ? 400 : fontWeight}
          textAnchor="middle"
          fill={colorSecondary}
        >
          {price}
        </text>

        {/* QR abajo izquierda + CTA abajo derecha */}
        {qrHref ? <image href={qrHref} x={60} y={830} width={140} height={140} /> : null}
        <text
          x={670}
          y={910}
          fontSize={20}
          fontWeight={fontWeight}
          textAnchor="end"
          fill="#444444"
        >
          {cta}
        </text>
        <text x={670} y={960} fontSize={14} textAnchor="end" fill="#888888">
          Escanea el QR
        </text>
      </g>
    </svg>
  );
};

// --- Registro de templates ---
export const DESIGN_TEMPLATES = [
  {
    key: 'poster',
    label: 'Póster',
    hint: 'Carta 21.6 × 28 cm',
    render: PosterDesign,
    viewBox: [850, 1100],
    pdf: { widthMm: 215.9, heightMm: 279.4, orientation: 'portrait', format: 'letter' },
    exportPx: [1700, 2200],
  },
  {
    key: 'labelH',
    label: 'Etiqueta H',
    hint: '10 × 7 cm',
    render: LabelHorizontalDesign,
    viewBox: [1000, 700],
    pdf: { widthMm: 100, heightMm: 70, orientation: 'landscape', format: [100, 70] },
    exportPx: [1181, 827],
  },
  {
    key: 'labelV',
    label: 'Etiqueta V',
    hint: '7 × 10 cm',
    render: LabelVerticalDesign,
    viewBox: [700, 1000],
    pdf: { widthMm: 70, heightMm: 100, orientation: 'portrait', format: [70, 100] },
    exportPx: [827, 1181],
  },
];
