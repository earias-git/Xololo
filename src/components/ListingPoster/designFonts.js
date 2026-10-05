import { useEffect } from 'react';

// XOLOLO Promote · Diseños para Imprimir — sub-commit 3.
//
// Catálogo curado de 20 Google Fonts para el editor + utilidades para:
//   1) Cargar la fuente en pantalla (preview): inyecta un <link>
//      Google Fonts al <head> on-demand, deduplicado.
//   2) Embeber la fuente dentro del <svg> al exportar: fetchea el CSS
//      de Google, extrae las URLs .woff2, las convierte a base64 y
//      genera un <style>@font-face> para pegar en <defs>. Esto es
//      necesario porque cuando serializamos el SVG y lo renderizamos
//      en un <img>, el <img> NO hereda las fuentes del documento. Sin
//      embed, el export cae a sans-serif por default.

// --- Catálogo curado ---
// weights disponibles por familia (según lo que Google Fonts expone).
// Si una familia no tiene Light (300), el UI deshabilita el chip Light.
export const CURATED_FONTS = [
  // Sans serif (versátiles, lectura)
  { family: 'Montserrat', weights: [300, 400, 700], category: 'sans' },
  { family: 'Poppins', weights: [300, 400, 700], category: 'sans' },
  { family: 'Inter', weights: [300, 400, 700], category: 'sans' },
  { family: 'Lato', weights: [300, 400, 700], category: 'sans' },
  { family: 'Open Sans', weights: [300, 400, 700], category: 'sans' },
  { family: 'Raleway', weights: [300, 400, 700], category: 'sans' },
  { family: 'Work Sans', weights: [300, 400, 700], category: 'sans' },
  { family: 'Archivo', weights: [300, 400, 700], category: 'sans' },

  // Display / impacto (títulos grandes)
  { family: 'Oswald', weights: [300, 400, 700], category: 'display' },
  { family: 'Bebas Neue', weights: [400], category: 'display' },
  { family: 'Anton', weights: [400], category: 'display' },

  // Serif elegante
  { family: 'Playfair Display', weights: [400, 700], category: 'serif' },
  { family: 'Merriweather', weights: [300, 400, 700], category: 'serif' },
  { family: 'Lora', weights: [400, 700], category: 'serif' },
  { family: 'DM Serif Display', weights: [400], category: 'serif' },
  { family: 'Cormorant Garamond', weights: [300, 400, 700], category: 'serif' },
  { family: 'Fraunces', weights: [300, 400, 700], category: 'serif' },

  // Script / handwritten (acentos informales)
  { family: 'Pacifico', weights: [400], category: 'script' },
  { family: 'Dancing Script', weights: [400, 700], category: 'script' },
  { family: 'Caveat', weights: [400, 700], category: 'script' },
];

export const FONT_CATEGORIES = [
  { key: 'sans', label: 'Sans serif' },
  { key: 'display', label: 'Display / Impacto' },
  { key: 'serif', label: 'Serif' },
  { key: 'script', label: 'Script' },
];

export const WEIGHT_OPTIONS = [
  { value: 300, label: 'Light' },
  { value: 400, label: 'Normal' },
  { value: 700, label: 'Bold' },
];

// Util: resuelve weights efectivos de una familia (intersección entre
// los pedidos y los disponibles). Si ninguno aplica, cae a 400.
export const resolveWeights = (family, requestedWeights) => {
  const font = CURATED_FONTS.find(f => f.family === family);
  const available = font?.weights || [400];
  const intersection = requestedWeights.filter(w => available.includes(w));
  return intersection.length > 0 ? intersection : [400];
};

export const familyIsAvailable = (family, weight) => {
  const font = CURATED_FONTS.find(f => f.family === family);
  return font ? font.weights.includes(weight) : false;
};

// ============================================================
// Preview: cargar la fuente en el <head> on-demand
// ============================================================

// Guard global para no inyectar la misma combinación 2 veces.
const injectedLinks = new Set();

const linkKey = (family, weights) => `${family}:${weights.join(',')}`;

const buildGoogleFontsUrl = (family, weights) => {
  // https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;700&display=swap
  const q = encodeURIComponent(family).replace(/%20/g, '+');
  const w = weights.slice().sort((a, b) => a - b).join(';');
  return `https://fonts.googleapis.com/css2?family=${q}:wght@${w}&display=swap`;
};

export const injectGoogleFontLink = (family, weights) => {
  if (typeof document === 'undefined') return;
  const key = linkKey(family, weights);
  if (injectedLinks.has(key)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = buildGoogleFontsUrl(family, weights);
  link.setAttribute('data-xolo-font', key);
  document.head.appendChild(link);
  injectedLinks.add(key);
};

// Hook: inyecta la fuente para la familia+weights pedidos. Si cambian,
// agrega el nuevo <link> (los viejos se quedan — así cambiar entre
// familias es instantáneo porque ya están cacheadas).
export const useGoogleFontOnPage = (family, weights) => {
  useEffect(() => {
    if (!family) return;
    const effective = resolveWeights(family, weights);
    injectGoogleFontLink(family, effective);
  }, [family, weights.join(',')]);
};

// ============================================================
// Export: embeber la fuente dentro del SVG
// ============================================================

// Fetchea el CSS de Google y devuelve el string tal cual. Google
// detecta el UA del cliente y devuelve WOFF2 cuando lo soporta
// (siempre, desde un navegador moderno).
const fetchGoogleFontsCss = async (family, weights) => {
  const url = buildGoogleFontsUrl(family, weights);
  const res = await fetch(url);
  if (!res.ok) throw new Error('fonts_css_fetch_failed');
  return res.text();
};

// Extrae pares { url, format } de un bloque CSS.
// Google Fonts emite 1 bloque @font-face por weight (y a veces por
// unicode-range). Capturamos todos los src: url(...) format('woff2').
const WOFF2_URL_RE = /src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)\s*format\(['"]woff2['"]\)/g;

const fetchWoff2AsBase64 = async url => {
  const res = await fetch(url);
  if (!res.ok) throw new Error('woff2_fetch_failed');
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onloadend = () => {
      // readAsDataURL devuelve "data:font/woff2;base64,...". Extraemos
      // solo la parte base64 para construir el data: URL explícitamente
      // con el content-type correcto (algunos navegadores devuelven
      // "application/octet-stream" en lugar de "font/woff2").
      const dataUrl = String(fr.result || '');
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : '';
      resolve(`data:font/woff2;base64,${base64}`);
    };
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
};

// Dada una familia y una lista de weights, devuelve un string con el
// contenido de un <style> listo para pegar dentro del <defs> del SVG.
// Las URLs externas quedan reemplazadas por data: URLs base64.
export const buildEmbeddedFontCss = async (family, weights) => {
  const effective = resolveWeights(family, weights);
  const css = await fetchGoogleFontsCss(family, effective);
  // Para cada URL .woff2 encontrada, descargar y reemplazar inline.
  const matches = [...css.matchAll(WOFF2_URL_RE)];
  if (matches.length === 0) return css; // ya es embebible (raro)

  // Dedupe URLs (si Google devuelve varios bloques con el mismo woff2
  // por unicode-range, sólo lo descargamos una vez).
  const uniqueUrls = Array.from(new Set(matches.map(m => m[1])));
  const dataUrls = await Promise.all(uniqueUrls.map(fetchWoff2AsBase64));
  const map = new Map(uniqueUrls.map((u, i) => [u, dataUrls[i]]));

  // Reemplazo literal.
  let embedded = css;
  for (const [orig, data] of map.entries()) {
    // Escape \n y chars especiales de regex por si acaso.
    const escaped = orig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    embedded = embedded.replace(new RegExp(escaped, 'g'), data);
  }
  return embedded;
};
