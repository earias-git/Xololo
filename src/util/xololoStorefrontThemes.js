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

export const THEMES = [
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Limpio y confiable. Fondo blanco, acentos azules sobrios.',
    brandPrimaryColor: '#2a3a60',
    brandSecondaryColor: '#f7f4ee',
    fitFor: 'Servicios profesionales, papelería, tecnología',
  },
  {
    id: 'classic',
    name: 'Clásico',
    description: 'Navy profundo con detalle dorado. Transmite trayectoria.',
    brandPrimaryColor: '#1e2a48',
    brandSecondaryColor: '#c8a560',
    fitFor: 'Moda formal, joyería, hogar premium',
  },
  {
    id: 'bold',
    name: 'Bold',
    description: 'Coral y magenta. Energía alta para enganchar en scroll.',
    brandPrimaryColor: '#e8846f',
    brandSecondaryColor: '#d96c84',
    fitFor: 'Moda juvenil, mascotas, belleza, lifestyle',
  },
  {
    id: 'editorial',
    name: 'Editorial',
    description: 'Tierra y salvia. Tono reposado, artesanal.',
    brandPrimaryColor: '#5a3620',
    brandSecondaryColor: '#8aa484',
    fitFor: 'Alimentos, artesanías, hogar rústico, café',
  },
];

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
