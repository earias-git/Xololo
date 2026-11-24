// XOLOLO Web Studio PR 3 — temas base del storefront. Cada tema es un
// "punto de arranque" opinado: el seller lo elige, los campos del form
// se auto-rellenan con los colores del tema, y luego puede ajustar lo
// que quiera. El id del tema se guarda en publicData.storefrontDraft.theme
// (via BRANDING_FIELDS en xololoStorefrontDraft) para que futuros PRs
// puedan vestir tipografía / hero / spacing según el tema.
//
// Por qué 4 temas y no 20:
//   - Demasiadas opciones paralizan al seller que no sabe de diseño.
//   - 4 cubren los arquetipos reales: editorial, confiable, energético, minimal.
//   - Agregar más es trivial — basta agregar un objeto a THEMES.
//
// Por qué 2 colores por tema y no una paleta completa:
//   - Hoy el storefront usa --xololo-brand-primary + --xololo-brand-secondary.
//     Cubrir eso es lo mínimo útil.
//   - Paletas extendidas (acento, superficies, ink) vienen en PR 4+.
//
// Identidad visual deliberada en cada tema:
//   - minimal: neutrales fríos, azul SAT (confianza, institucional)
//   - classic: navy profundo + oro, se ve más "tienda consolidada"
//   - bold: coral energético + magenta, atrae click en categorías juveniles
//   - editorial: tierra + verde salvia, para alimentos, artesanías, hogar

// XOLOLO Web Studio PR 4 — cada tema ahora expone también `tokens`
// visuales (fuentes, radio de cards, variante de hero). El preview
// (StorefrontPreview) consume estos tokens y vista el mini-storefront
// según el tema; el storefront REAL sigue recibiendo sólo los colores
// — la aplicación completa de los tokens en el storefront público
// vendrá en un PR siguiente, cuando ajustemos SSR + Google Fonts loading.
export const THEMES = [
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Limpio y confiable. Fondo blanco, acentos azules sobrios.',
    brandPrimaryColor: '#2a3a60',
    brandSecondaryColor: '#f7f4ee',
    fitFor: 'Servicios profesionales, papelería, tecnología',
    tokens: {
      headingFont: 'Inter',
      bodyFont: 'Inter',
      cardRadius: 4,
      heroVariant: 'minimal',
    },
  },
  {
    id: 'classic',
    name: 'Clásico',
    description: 'Navy profundo con detalle dorado. Transmite trayectoria.',
    brandPrimaryColor: '#1e2a48',
    brandSecondaryColor: '#c8a560',
    fitFor: 'Moda formal, joyería, hogar premium',
    tokens: {
      headingFont: 'Playfair Display',
      bodyFont: 'Lora',
      cardRadius: 2,
      heroVariant: 'solid',
    },
  },
  {
    id: 'bold',
    name: 'Bold',
    description: 'Coral y magenta. Energía alta para enganchar en scroll.',
    brandPrimaryColor: '#e8846f',
    brandSecondaryColor: '#d96c84',
    fitFor: 'Moda juvenil, mascotas, belleza, lifestyle',
    tokens: {
      headingFont: 'Space Grotesk',
      bodyFont: 'Inter',
      cardRadius: 14,
      heroVariant: 'gradient',
    },
  },
  {
    id: 'editorial',
    name: 'Editorial',
    description: 'Tierra y salvia. Tono reposado, artesanal.',
    brandPrimaryColor: '#5a3620',
    brandSecondaryColor: '#8aa484',
    fitFor: 'Alimentos, artesanías, hogar rústico, café',
    tokens: {
      headingFont: 'Frank Ruhl Libre',
      bodyFont: 'Source Serif 4',
      cardRadius: 6,
      heroVariant: 'editorial',
    },
  },
];

// Valores default cuando el seller NO eligió tema. Compatible con el
// shape de tokens — sirve para que StorefrontPreview tenga algo que
// aplicar al frame aun sin tema seleccionado.
export const DEFAULT_TOKENS = {
  headingFont: 'Inter',
  bodyFont: 'Inter',
  cardRadius: 6,
  heroVariant: 'gradient',
};

export const VALID_HERO_VARIANTS = new Set(['gradient', 'solid', 'minimal', 'editorial']);

const THEMES_BY_ID = Object.fromEntries(THEMES.map(t => [t.id, t]));

export const VALID_THEME_IDS = new Set(THEMES.map(t => t.id));

// Devuelve el tema o null (nunca lanza para ids inválidos).
export const getTheme = id => (id && THEMES_BY_ID[id]) || null;

// Normaliza: id válido → id. Cualquier otra cosa → null.
export const normalizeThemeId = id => (VALID_THEME_IDS.has(id) ? id : null);

// Dado un tema, devuelve el patch de valores que el picker del form
// debe aplicar (via form.change) al elegirlo. Deliberadamente SOLO
// escribe los campos del tema — no toca logo, banner, nada más que el
// seller pudo haber subido ya.
export const themeToFormPatch = themeId => {
  const t = getTheme(themeId);
  if (!t) return null;
  return {
    storefrontTheme: t.id,
    brandPrimaryColor: t.brandPrimaryColor,
    brandSecondaryColor: t.brandSecondaryColor,
  };
};

// XOLOLO Web Studio PR 4 — devuelve los tokens visuales efectivos.
// Si el seller eligió tema, usa sus tokens; si no, DEFAULT_TOKENS.
// Nunca devuelve null — consumers siempre tienen algo que aplicar.
export const resolveTokens = themeId => {
  const t = getTheme(themeId);
  return t?.tokens || DEFAULT_TOKENS;
};

// XOLOLO Web Studio PR 4 — convierte los tokens de un tema en un objeto
// { cssVars, heroVariant } para aplicar al root del preview / storefront.
// cssVars se spreada con style={{ ...cssVars }} en el elemento root.
// heroVariant se pasa como data-attribute para que el CSS seleccione
// la variante correcta sin lógica JS extra.
export const themeToCssVars = themeId => {
  const t = resolveTokens(themeId);
  return {
    cssVars: {
      '--xf-heading-font': `"${t.headingFont}", system-ui, sans-serif`,
      '--xf-body-font': `"${t.bodyFont}", system-ui, sans-serif`,
      '--xf-card-radius': `${t.cardRadius}px`,
    },
    heroVariant: VALID_HERO_VARIANTS.has(t.heroVariant) ? t.heroVariant : 'gradient',
    headingFont: t.headingFont,
    bodyFont: t.bodyFont,
  };
};

// XOLOLO Web Studio PR 4 — URL del Google Fonts CSS que cubre ambas
// fuentes del tema con sus pesos típicos. Para inyectar en el <link>
// del preview (y eventualmente el storefront real en PR siguiente).
export const buildGoogleFontsHref = themeId => {
  const t = resolveTokens(themeId);
  // Dedupe por si heading y body son la misma fuente.
  const families = new Set([t.headingFont, t.bodyFont]);
  const params = [...families]
    .map(f => `family=${encodeURIComponent(f)}:wght@400;600;800`)
    .join('&');
  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
};
