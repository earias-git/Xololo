import React from 'react';

// XOLOLO Promote · Diseños para Imprimir — sub-commit 2.
//
// Cada template devuelve un <svg> JSX con slots pre-definidos.
// Motor: SVG inline (no canvas 2D). Ventajas vs canvas:
//   - Tipografías nativas (sub-commit 3 pondrá Google Fonts aquí)
//   - Zoom infinito sin pixelado
//   - Cada slot es DOM editable (futuro click-to-edit)
//   - Export a PDF/PNG via serialize + drawImage → canvas limpio
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
//     fontFamily, fontWeight, sizeTitle, sizePrice }
//
// fontFamily: nombre tal cual lo expone Google Fonts (ej. 'Montserrat').
// fontWeight: numeric (300 Light, 400 Normal, 700 Bold).
// sizeTitle / sizePrice: escalas 0.7–1.4 que multiplican los fontSize
// base de cada template.
//
// productImgHref / qrHref / logoHref son data: URLs (resueltas por el
// host) para que la serialización del SVG no dependa de recursos
// externos y el export a canvas no sufra "tainted canvas" por CORS.
//
// blackWhite: cuando true, el root <g> aplica un <filter> con
// feColorMatrix (grayscale ITU-R BT.601 .299/.587/.114). Esto SOBREVIVE
// a la serialización + render en <img> + draw a canvas, mientras que
// `filter: grayscale(1)` CSS NO sobrevive.

// --- Helpers ---

// Trunca texto en N líneas usando <tspan>. Approx porque SVG no mide
// texto sin DOM; usamos chars-per-line razonables por tamaño de fuente.
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

// Marca del seller con cascada:
//   1) logoHref (data:URL del logo del seller)  → <image>
//   2) sellerName                               → <text> con el nombre
//   3) null + null                              → no renderiza nada
//
// Nunca mete texto placeholder tipo "XOLOLO" por default — si el seller
// no tiene marca configurada, el diseño queda limpio.
const BrandMark = ({ logoHref, sellerName, x, y, size, color, align = 'left' }) => {
  if (logoHref) {
    const w = size;
    const h = size;
    const ax = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    return (
      <image
        href={logoHref}
        x={ax}
        y={y}
        width={w}
        height={h}
        preserveAspectRatio="xMidYMid meet"
      />
    );
  }
  if (sellerName) {
    const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
    const name = String(sellerName).trim();
    const fontPx = size * 0.55;
    return (
      <text
        x={x}
        y={y + size * 0.72}
        fontSize={fontPx}
        fontWeight={800}
        fill={color}
        textAnchor={anchor}
      >
        {name.length > 24 ? name.slice(0, 23) + '…' : name}
      </text>
    );
  }
  return null;
};

// Filtro B/N aplicable al root <g> del diseño. Matrix grayscale
// estándar ITU-R BT.601: R' = G' = B' = 0.299R + 0.587G + 0.114B.
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

// Fallback stack cuando no hay familia definida (p.ej. hasta que carga
// Google Fonts). También se aplica después de la familia elegida como
// red de seguridad para unicode-ranges no cubiertos por la WOFF2.
const FALLBACK_STACK = "system-ui, -apple-system, 'Segoe UI', sans-serif";

const fontStack = family =>
  family ? `'${family}', ${FALLBACK_STACK}` : FALLBACK_STACK;

const px = (base, scale = 1) => Math.round(base * (scale || 1));

// --- Template 1: Poster carta vertical ---
// viewBox 850×1100 (ratio 0.773 = carta ratio).
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
  } = props;
  const titleFontPx = px(40, sizeTitle);
  const priceFontPx = px(92, sizePrice);
  const titleLines = wrapTspans(title, titleFontPx, 650, 2);
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

        {/* Banda superior con color primario */}
        <rect x={0} y={0} width={850} height={180} fill={colorPrimary} />

        {/* Logo o nombre de la tienda; null si el seller no tiene nada */}
        <BrandMark
          logoHref={logoHref}
          sellerName={sellerName}
          x={60}
          y={45}
          size={70}
          color="#ffffff"
        />

        {/* Título sobre la banda, con offset si hay logo/nombre o pegado
            a la izquierda si no hay marca */}
        <text
          x={logoHref || sellerName ? 160 : 60}
          y={70}
          fontSize={titleFontPx}
          fontWeight={fontWeight}
          fill="#ffffff"
        >
          {titleLines.map((l, i) => (
            <tspan key={i} x={logoHref || sellerName ? 160 : 60} dy={i === 0 ? 0 : titleFontPx * 1.15}>
              {l}
            </tspan>
          ))}
        </text>

        {/* Imagen producto */}
        <ImageOrPlaceholder href={productImgHref} x={100} y={240} w={650} h={500} rx={24} />

        {/* Precio en color secundario */}
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

        {/* CTA */}
        <text
          x={425}
          y={900}
          fontSize={26}
          fontWeight={fontWeight}
          textAnchor="middle"
          fill="#555555"
        >
          {cta}
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

// --- Template 2: Etiqueta horizontal 10×7cm ---
// viewBox 1000×700. Imagen izquierda, info derecha.
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
  } = props;
  const titleFontPx = px(34, sizeTitle);
  const priceFontPx = px(78, sizePrice);
  const titleLines = wrapTspans(title, titleFontPx, 480, 2);
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

        {/* Marco de color primario */}
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
        <ImageOrPlaceholder href={productImgHref} x={30} y={30} w={420} h={540} rx={16} />

        {/* Logo o nombre del seller abajo izquierda */}
        <BrandMark
          logoHref={logoHref}
          sellerName={sellerName}
          x={30}
          y={600}
          size={56}
          color={colorPrimary}
        />

        {/* Título */}
        <text x={490} y={100} fontSize={titleFontPx} fontWeight={fontWeight} fill="#111111">
          {titleLines.map((l, i) => (
            <tspan key={i} x={490} dy={i === 0 ? 0 : titleFontPx * 1.17}>
              {l}
            </tspan>
          ))}
        </text>

        {/* Línea decorativa color secundario */}
        <line x1={490} y1={200} x2={700} y2={200} stroke={colorSecondary} strokeWidth={4} />

        {/* Precio en color secundario */}
        <text
          x={490}
          y={310}
          fontSize={priceFontPx}
          fontWeight={fontWeight === 300 ? 400 : fontWeight}
          fill={colorSecondary}
        >
          {price}
        </text>

        {/* CTA */}
        <text x={490} y={380} fontSize={20} fontWeight={fontWeight} fill="#444444">
          {cta}
        </text>

        {/* QR abajo derecha */}
        {qrHref ? <image href={qrHref} x={760} y={430} width={210} height={210} /> : null}
      </g>
    </svg>
  );
};

// --- Template 3: Etiqueta vertical 7×10cm ---
// viewBox 700×1000. Imagen arriba todo-ancho, info abajo.
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
  } = props;
  const titleFontPx = px(36, sizeTitle);
  const priceFontPx = px(82, sizePrice);
  const titleLines = wrapTspans(title, titleFontPx, 580, 2);
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

        {/* Banda superior color primario */}
        <rect x={0} y={0} width={700} height={80} fill={colorPrimary} />
        <BrandMark
          logoHref={logoHref}
          sellerName={sellerName}
          x={350}
          y={14}
          size={52}
          color="#ffffff"
          align="center"
        />

        {/* Imagen producto arriba */}
        <ImageOrPlaceholder href={productImgHref} x={50} y={110} w={600} h={450} rx={16} />

        {/* Título */}
        <text
          x={350}
          y={620}
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

        {/* Precio color secundario */}
        <text
          x={350}
          y={790}
          fontSize={priceFontPx}
          fontWeight={fontWeight === 300 ? 400 : fontWeight}
          textAnchor="middle"
          fill={colorSecondary}
        >
          {price}
        </text>

        {/* QR abajo izquierda */}
        {qrHref ? <image href={qrHref} x={60} y={830} width={140} height={140} /> : null}

        {/* CTA abajo derecha */}
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
// pdf: tamaño físico final del documento al imprimir (jsPDF usa mm).
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

// Paleta curada: primero el swatch para color primario, abajo el
// color secundario. Mantenemos un pool común — el seller elige dos
// cualesquiera de aquí.
export const DESIGN_COLOR_SWATCHES = [
  '#ff6b35', // naranja
  '#2d7a46', // verde
  '#1e40af', // azul
  '#be185d', // magenta
  '#f59e0b', // ámbar
  '#111111', // negro
];
