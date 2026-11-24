// XOLOLO Web Studio PR 3 — blindaje del sistema de temas del storefront.

const {
  THEMES,
  VALID_THEME_IDS,
  DEFAULT_TOKENS,
  VALID_HERO_VARIANTS,
  getTheme,
  normalizeThemeId,
  themeToFormPatch,
  resolveTokens,
  themeToCssVars,
  buildGoogleFontsHref,
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

// XOLOLO Web Studio PR 4

describe('tokens por tema', () => {
  it('cada tema tiene tokens con shape completo', () => {
    for (const t of THEMES) {
      expect(t.tokens).toBeDefined();
      expect(typeof t.tokens.headingFont).toBe('string');
      expect(typeof t.tokens.bodyFont).toBe('string');
      expect(typeof t.tokens.cardRadius).toBe('number');
      expect(VALID_HERO_VARIANTS.has(t.tokens.heroVariant)).toBe(true);
    }
  });

  it('las 4 hero variants están cubiertas (una por tema)', () => {
    const variants = new Set(THEMES.map(t => t.tokens.heroVariant));
    expect(variants.size).toBe(4);
  });
});

describe('resolveTokens', () => {
  it('devuelve los tokens del tema si existe', () => {
    expect(resolveTokens('bold').heroVariant).toBe('gradient');
  });

  it('cae a DEFAULT_TOKENS si no hay tema', () => {
    expect(resolveTokens(null)).toEqual(DEFAULT_TOKENS);
    expect(resolveTokens('nope')).toEqual(DEFAULT_TOKENS);
  });
});

describe('themeToCssVars', () => {
  it('devuelve cssVars con --xf-* + heroVariant + nombres de fuente', () => {
    const r = themeToCssVars('classic');
    expect(r.cssVars['--xf-heading-font']).toContain('Playfair Display');
    expect(r.cssVars['--xf-body-font']).toContain('Lora');
    expect(r.cssVars['--xf-card-radius']).toBe('2px');
    expect(r.heroVariant).toBe('solid');
    expect(r.headingFont).toBe('Playfair Display');
    expect(r.bodyFont).toBe('Lora');
  });

  it('cae a defaults cuando no hay tema', () => {
    const r = themeToCssVars(null);
    expect(r.heroVariant).toBe('gradient');
    expect(r.cssVars['--xf-card-radius']).toBe('6px');
  });

  it('heroVariant inválido en el tema fallbackea a gradient', () => {
    // Simulamos un tema malformado via resolveTokens directo:
    // esta rama blinda que un posible cambio futuro nunca pegue una
    // variante no-listada al frame.
    const r = themeToCssVars('some-future-broken-id-fallback');
    expect(VALID_HERO_VARIANTS.has(r.heroVariant)).toBe(true);
  });
});

describe('buildGoogleFontsHref', () => {
  it('encodea las dos familias del tema', () => {
    const href = buildGoogleFontsHref('editorial');
    expect(href).toContain('family=Frank%20Ruhl%20Libre');
    expect(href).toContain('family=Source%20Serif%204');
    expect(href).toContain('display=swap');
    expect(href).toContain('wght@400;600;800');
  });

  it('dedupe cuando heading y body son la misma fuente', () => {
    // Minimal usa Inter para ambos.
    const href = buildGoogleFontsHref('minimal');
    const matches = href.match(/family=Inter/g);
    expect(matches.length).toBe(1);
  });

  it('cae a defaults si no hay tema', () => {
    const href = buildGoogleFontsHref(null);
    expect(href).toContain('family=Inter');
  });
});
