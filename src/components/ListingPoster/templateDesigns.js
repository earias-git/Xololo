import React from 'react';

// XOLOLO Promote · Diseños para Imprimir — sub-commit 1 (base SVG).
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
//   { title, price, cta, color, productImgHref, qrHref }
//
// productImgHref y qrHref son data: URLs (resueltas por el host) para
// que la serialización del SVG no dependa de recursos externos y el
// export a canvas no sufra "tainted canvas" por CORS.

// --- Helpers ---

// Trunca texto en N líneas usando <tspan>. Approx porque SVG no mide
// texto sin DOM; usamos chars-per-line razonables por tamaño de fuente.
const wrapTspans = (text, fontPx, maxWidthPx, maxLines) => {
  const avgCharWidth = fontPx * 0.55; // heurística razonable para sans serif
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
  if (href) {
    return (
      <g>
        <clipPath id={`clip-${x}-${y}-${w}-${h}`}>
          <rect x={x} y={y} width={w} height={h} rx={rx} />
        </clipPath>
        <image
          href={href}
          x={x}
          y={y}
          width={w}
          height={h}
          preserveAspectRatio="xMidYMid slice"
          clipPath={`url(#clip-${x}-${y}-${w}-${h})`}
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

// --- Template 1: Poster carta vertical ---
// viewBox 850×1100 (ratio 0.773 = carta ratio).
const PosterDesign = ({ title, price, cta, color, productImgHref, qrHref }) => {
  const titleLines = wrapTspans(title, 48, 730, 2);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 850 1100"
      preserveAspectRatio="xMidYMid meet"
      fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
    >
      <rect x={0} y={0} width={850} height={1100} fill="#ffffff" />

      {/* Banda superior con color */}
      <rect x={0} y={0} width={850} height={180} fill={color} />
      <text x={60} y={80} fontSize={28} fontWeight={700} fill="#ffffff">
        XOLOLO
      </text>
      <text x={60} y={135} fontSize={46} fontWeight={700} fill="#ffffff">
        {titleLines.map((l, i) => (
          <tspan key={i} x={60} dy={i === 0 ? 0 : 52}>
            {l}
          </tspan>
        ))}
      </text>

      {/* Imagen producto */}
      <ImageOrPlaceholder href={productImgHref} x={100} y={240} w={650} h={500} rx={24} />

      {/* Precio */}
      <text
        x={425}
        y={820}
        fontSize={92}
        fontWeight={800}
        textAnchor="middle"
        fill="#111111"
      >
        {price}
      </text>

      {/* CTA */}
      <text x={425} y={900} fontSize={26} textAnchor="middle" fill="#555555">
        {cta}
      </text>

      {/* QR abajo derecha */}
      {qrHref ? (
        <g>
          <rect x={602} y={852} width={196} height={196} fill="#ffffff" />
          <image href={qrHref} x={610} y={860} width={180} height={180} />
        </g>
      ) : null}
    </svg>
  );
};

// --- Template 2: Etiqueta horizontal 10×7cm ---
// viewBox 1000×700. Imagen izquierda, info derecha.
const LabelHorizontalDesign = ({
  title,
  price,
  cta,
  color,
  productImgHref,
  qrHref,
}) => {
  const titleLines = wrapTspans(title, 36, 490, 2);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1000 700"
      preserveAspectRatio="xMidYMid meet"
      fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
    >
      <rect x={0} y={0} width={1000} height={700} fill="#ffffff" />

      {/* Marco/borde con color */}
      <rect
        x={0}
        y={0}
        width={1000}
        height={700}
        fill="none"
        stroke={color}
        strokeWidth={10}
      />

      {/* Imagen producto izquierda */}
      <ImageOrPlaceholder href={productImgHref} x={30} y={30} w={420} h={540} rx={16} />

      {/* Marca mini */}
      <text x={30} y={660} fontSize={18} fontWeight={700} fill={color}>
        XOLOLO.MX
      </text>

      {/* Título */}
      <text x={490} y={100} fontSize={36} fontWeight={700} fill="#111111">
        {titleLines.map((l, i) => (
          <tspan key={i} x={490} dy={i === 0 ? 0 : 40}>
            {l}
          </tspan>
        ))}
      </text>

      {/* Línea decorativa */}
      <line
        x1={490}
        y1={200}
        x2={700}
        y2={200}
        stroke={color}
        strokeWidth={3}
      />

      {/* Precio GRANDE */}
      <text x={490} y={310} fontSize={78} fontWeight={800} fill={color}>
        {price}
      </text>

      {/* CTA */}
      <text x={490} y={380} fontSize={20} fill="#444444">
        {cta}
      </text>

      {/* QR abajo derecha */}
      {qrHref ? (
        <image href={qrHref} x={760} y={430} width={210} height={210} />
      ) : null}
    </svg>
  );
};

// --- Template 3: Etiqueta vertical 7×10cm ---
// viewBox 700×1000. Imagen arriba todo-ancho, info abajo.
const LabelVerticalDesign = ({
  title,
  price,
  cta,
  color,
  productImgHref,
  qrHref,
}) => {
  const titleLines = wrapTspans(title, 36, 580, 2);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 700 1000"
      preserveAspectRatio="xMidYMid meet"
      fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
    >
      <rect x={0} y={0} width={700} height={1000} fill="#ffffff" />

      {/* Banda superior */}
      <rect x={0} y={0} width={700} height={60} fill={color} />
      <text x={350} y={42} fontSize={22} fontWeight={700} textAnchor="middle" fill="#ffffff">
        XOLOLO.MX
      </text>

      {/* Imagen producto arriba */}
      <ImageOrPlaceholder href={productImgHref} x={50} y={90} w={600} h={450} rx={16} />

      {/* Título */}
      <text x={350} y={610} fontSize={36} fontWeight={700} textAnchor="middle" fill="#111111">
        {titleLines.map((l, i) => (
          <tspan key={i} x={350} dy={i === 0 ? 0 : 42}>
            {l}
          </tspan>
        ))}
      </text>

      {/* Precio */}
      <text x={350} y={790} fontSize={82} fontWeight={800} textAnchor="middle" fill={color}>
        {price}
      </text>

      {/* QR abajo izquierda */}
      {qrHref ? (
        <image href={qrHref} x={60} y={830} width={140} height={140} />
      ) : null}

      {/* CTA abajo derecha */}
      <text x={670} y={910} fontSize={20} textAnchor="end" fill="#444444">
        {cta}
      </text>
      <text x={670} y={960} fontSize={14} textAnchor="end" fill="#888888">
        Escanea el QR
      </text>
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
    exportPx: [1700, 2200], // DPI razonable para impresión en carta
  },
  {
    key: 'labelH',
    label: 'Etiqueta H',
    hint: '10 × 7 cm',
    render: LabelHorizontalDesign,
    viewBox: [1000, 700],
    pdf: { widthMm: 100, heightMm: 70, orientation: 'landscape', format: [100, 70] },
    exportPx: [1181, 827], // 300 dpi
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

export const DESIGN_COLOR_SWATCHES = [
  '#ff6b35', // naranja
  '#2d7a46', // verde
  '#1e40af', // azul
  '#be185d', // magenta
  '#111111', // negro
];
