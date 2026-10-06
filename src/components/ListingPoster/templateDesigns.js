import React from 'react';

// XOLOLO Promote · Diseños para Imprimir — rediseño limpio v2.
//
// Decisiones acordadas con el seller tras varias iteraciones:
//   - El logo SIEMPRE va sobre fondo BLANCO (nunca dentro de la banda
//     de color primario). Vive en una zona reservada ARRIBA del todo
//     del canvas, en la zona blanca pura.
//   - La banda de color primario queda SÓLO detrás del título (más
//     chica, suficiente para enmarcar el texto y nada más).
//   - El seller controla alineación horizontal del logo (izq/centro/
//     der) y tamaño (slider 90-160).
//   - Auto-shrink del precio: si al escalar con el slider de "tamaño
//     del precio" desborda horizontalmente, se encoge para caber.

// --- Constantes ---

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

// Rango permitido para el slider de tamaño del logo (en units del
// viewBox). Mínimo 90 porque abajo se ve demasiado chico; máximo 160
// porque arriba de ahí no cabe en los formatos más pequeños.
export const LOGO_SIZE_MIN = 90;
export const LOGO_SIZE_MAX = 160;
export const LOGO_SIZE_DEFAULT = 110;

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

// Dado un texto, un tamaño de fuente deseado y un ancho máximo, baja
// el tamaño proporcionalmente para que el texto quepa (nunca más
// grande que el deseado). Usado para que el precio no se salga del
// canvas al escalar al 140%.
const shrinkToFit = (text, desiredFontPx, maxWidth) => {
  const natural = String(text || '').length * desiredFontPx * 0.55;
  if (natural <= maxWidth) return desiredFontPx;
  return Math.max(12, Math.floor((desiredFontPx * maxWidth) / natural));
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

// BrandMark SIN badge blanco — vive directo sobre el canvas blanco.
// anchorX, anchorY = esquina superior-izquierda de la zona reservada.
// align = alineación horizontal del logo dentro de la zona.
const BrandMark = ({
  logoHref,
  sellerName,
  anchorX,
  anchorY,
  zoneWidth,
  size,
  align = 'left',
  textColor = '#222222',
}) => {
  let imgX;
  if (align === 'center') imgX = anchorX + (zoneWidth - size) / 2;
  else if (align === 'right') imgX = anchorX + zoneWidth - size;
  else imgX = anchorX;

  if (logoHref) {
    return (
      <image
        href={logoHref}
        x={imgX}
        y={anchorY}
        width={size}
        height={size}
        preserveAspectRatio="xMidYMid meet"
      />
    );
  }
  if (sellerName) {
    const name = String(sellerName).trim();
    const truncated = name.length > 24 ? name.slice(0, 23) + '…' : name;
    const fontPx = size * 0.55;
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
        y={anchorY + size * 0.72}
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
// Vertical: [zona blanca con logo] → [banda color con título] → imagen
// → precio → CTA → QR.
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
    logoSize = LOGO_SIZE_DEFAULT,
  } = props;

  const hasBrand = !!(logoHref || sellerName);
  const titleFontPx = px(40, sizeTitle);
  const priceFontPxDesired = px(92, sizePrice);
  const titleLines = wrapTspans(title, titleFontPx, 760, 2);
  const titleHeight = titleLines.length * titleFontPx * 1.15;

  // Zonas
  const LOGO_PAD = 25;
  const logoZoneH = hasBrand ? LOGO_PAD + logoSize + LOGO_PAD : 0;
  const BAND_PAD = 25;
  const bandY = logoZoneH;
  const bandH = BAND_PAD + titleHeight + BAND_PAD;

  // Imagen debajo del header; altura compensa para que el footer quede fijo.
  const imgY = bandY + bandH + 20;
  const imgEnd = 740;
  const imgH = Math.max(300, imgEnd - imgY);

  // Auto-shrink del precio para que no desborde el canvas horizontal.
  // Margen de seguridad: dejamos 45px de margen a cada lado = 760 max.
  const priceFontPx = shrinkToFit(price, priceFontPxDesired, 760);

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

        {/* Logo en zona blanca arriba (si hay marca) */}
        {hasBrand ? (
          <BrandMark
            logoHref={logoHref}
            sellerName={sellerName}
            anchorX={50}
            anchorY={LOGO_PAD}
            zoneWidth={750}
            size={logoSize}
            align={logoAlign}
            textColor="#222222"
          />
        ) : null}

        {/* Banda de color primario SÓLO detrás del título */}
        <rect x={0} y={bandY} width={850} height={bandH} fill={colorPrimary} />
        <text
          x={50}
          y={bandY + BAND_PAD + titleFontPx}
          fontSize={titleFontPx}
          fontWeight={fontWeight}
          fill="#ffffff"
        >
          {titleLines.map((l, i) => (
            <tspan key={i} x={50} dy={i === 0 ? 0 : titleFontPx * 1.15}>
              {l}
            </tspan>
          ))}
        </text>

        {/* Imagen producto */}
        <ImageOrPlaceholder href={productImgHref} x={100} y={imgY} w={650} h={imgH} rx={24} />

        {/* Precio con auto-shrink */}
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

        {/* CTA centrado en el área izquierda al QR (QR en x=602-800) */}
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
// Dos columnas. Logo arriba de la columna derecha, sobre fondo blanco.
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
    logoSize = LOGO_SIZE_DEFAULT,
  } = props;

  const hasBrand = !!(logoHref || sellerName);
  const titleFontPx = px(34, sizeTitle);
  const priceFontPxDesired = px(78, sizePrice);
  const titleLines = wrapTspans(title, titleFontPx, 480, 2);

  // Columna derecha: x=490 a x=970 (ancho 480).
  const INFO_X = 490;
  const INFO_W = 480;
  const PAD = 20;
  const logoY = PAD;
  const logoZoneH = hasBrand ? logoSize + PAD : 0;
  const titleY = logoY + logoZoneH + titleFontPx;
  const titleTotalH = titleLines.length * titleFontPx * 1.17;
  const priceY = titleY + titleTotalH + 30 + priceFontPxDesired;
  // Precio auto-shrink dentro del ancho de la columna.
  const priceFontPx = shrinkToFit(price, priceFontPxDesired, INFO_W);

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

        {/* Logo arriba de la columna derecha, sobre blanco */}
        {hasBrand ? (
          <BrandMark
            logoHref={logoHref}
            sellerName={sellerName}
            anchorX={INFO_X}
            anchorY={logoY}
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

        {/* Precio con auto-shrink */}
        <text
          x={INFO_X}
          y={priceY}
          fontSize={priceFontPx}
          fontWeight={fontWeight === 300 ? 400 : fontWeight}
          fill={colorSecondary}
        >
          {price}
        </text>

        {/* CTA */}
        <text x={INFO_X} y={priceY + 50} fontSize={20} fontWeight={fontWeight} fill="#444444">
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
// Vertical: [zona blanca con logo] → [banda color con título] →
// imagen → precio → QR + CTA.
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
    logoSize = LOGO_SIZE_DEFAULT,
  } = props;

  const hasBrand = !!(logoHref || sellerName);
  const titleFontPx = px(32, sizeTitle);
  const priceFontPxDesired = px(68, sizePrice);
  const titleLines = wrapTspans(title, titleFontPx, 580, 2);
  const titleTotalH = titleLines.length * titleFontPx * 1.17;

  // Zonas
  const LOGO_PAD = 20;
  const logoZoneH = hasBrand ? LOGO_PAD + logoSize + LOGO_PAD : 0;
  const BAND_PAD = 20;
  const bandY = logoZoneH;
  const bandH = BAND_PAD + titleTotalH + BAND_PAD;

  // Imagen compensa.
  const imgY = bandY + bandH + 20;
  const imgEnd = 780;
  const imgH = Math.max(260, imgEnd - imgY);

  // Precio auto-shrink dentro del canvas (margen 30 cada lado).
  const priceFontPx = shrinkToFit(price, priceFontPxDesired, 640);

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

        {/* Logo arriba sobre blanco */}
        {hasBrand ? (
          <BrandMark
            logoHref={logoHref}
            sellerName={sellerName}
            anchorX={30}
            anchorY={LOGO_PAD}
            zoneWidth={640}
            size={logoSize}
            align={logoAlign}
            textColor="#222222"
          />
        ) : null}

        {/* Banda color SÓLO detrás del título */}
        <rect x={0} y={bandY} width={700} height={bandH} fill={colorPrimary} />
        <text
          x={350}
          y={bandY + BAND_PAD + titleFontPx}
          fontSize={titleFontPx}
          fontWeight={fontWeight}
          textAnchor="middle"
          fill="#ffffff"
        >
          {titleLines.map((l, i) => (
            <tspan key={i} x={350} dy={i === 0 ? 0 : titleFontPx * 1.17}>
              {l}
            </tspan>
          ))}
        </text>

        {/* Imagen producto */}
        <ImageOrPlaceholder href={productImgHref} x={50} y={imgY} w={600} h={imgH} rx={16} />

        {/* Precio centrado abajo */}
        <text
          x={350}
          y={870}
          fontSize={priceFontPx}
          fontWeight={fontWeight === 300 ? 400 : fontWeight}
          textAnchor="middle"
          fill={colorSecondary}
        >
          {price}
        </text>

        {/* QR abajo izquierda + CTA abajo derecha */}
        {qrHref ? <image href={qrHref} x={40} y={880} width={120} height={120} /> : null}
        <text
          x={670}
          y={920}
          fontSize={18}
          fontWeight={fontWeight}
          textAnchor="end"
          fill="#444444"
        >
          {cta}
        </text>
        <text x={670} y={960} fontSize={13} textAnchor="end" fill="#888888">
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
