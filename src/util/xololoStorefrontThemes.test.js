// XOLOLO Web Studio PR 3 — blindaje del sistema de temas del storefront.

const {
  THEMES,
  VALID_THEME_IDS,
  getTheme,
  normalizeThemeId,
  themeToFormPatch,
} = require('./xololoStorefrontThemes');

describe('THEMES', () => {
  it('ship con 4 temas base', () => {
    expect(THEMES.length).toBe(4);
  });

  it('todos los temas tienen id + name + colores válidos', () => {
    for (const t of THEMES) {
      expect(typeof t.id).toBe('string');
      expect(typeof t.name).toBe('string');
      expect(t.brandPrimaryColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(t.brandSecondaryColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('los ids son únicos', () => {
    const ids = THEMES.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('expone los 4 ids esperados', () => {
    const ids = new Set(THEMES.map(t => t.id));
    expect(ids.has('minimal')).toBe(true);
    expect(ids.has('classic')).toBe(true);
    expect(ids.has('bold')).toBe(true);
    expect(ids.has('editorial')).toBe(true);
  });
});

describe('getTheme', () => {
  it('devuelve el tema por id', () => {
    const t = getTheme('bold');
    expect(t).not.toBe(null);
    expect(t.id).toBe('bold');
  });

  it('null para id desconocido', () => {
    expect(getTheme('surrealist')).toBe(null);
    expect(getTheme('')).toBe(null);
    expect(getTheme(undefined)).toBe(null);
  });
});

describe('normalizeThemeId', () => {
  it('devuelve el id si está en VALID_THEME_IDS', () => {
    expect(normalizeThemeId('minimal')).toBe('minimal');
  });

  it('null para cualquier otra cosa', () => {
    expect(normalizeThemeId('nope')).toBe(null);
    expect(normalizeThemeId(null)).toBe(null);
    expect(normalizeThemeId(42)).toBe(null);
  });
});

describe('themeToFormPatch', () => {
  it('devuelve patch con theme id + 2 colores', () => {
    const patch = themeToFormPatch('classic');
    expect(patch.storefrontTheme).toBe('classic');
    expect(patch.brandPrimaryColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(patch.brandSecondaryColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('NO toca logo/banner (solo tema+colores)', () => {
    const patch = themeToFormPatch('minimal');
    expect(patch.logoUrl).toBe(undefined);
    expect(patch.bannerUrl).toBe(undefined);
  });

  it('null si el id no existe', () => {
    expect(themeToFormPatch('nope')).toBe(null);
    expect(themeToFormPatch(null)).toBe(null);
  });
});
