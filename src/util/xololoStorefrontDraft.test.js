// XOLOLO Web Studio PR 2 — blindaje del modelo staging del storefront.
//
// LOCKED invariants:
//   1. Sólo BRANDING_FIELDS se stagean; otros campos van flat siempre.
//   2. readPublishedBranding lee del flat, nunca del draft.
//   3. hasActiveDraft requiere AL MENOS UN campo distinto; un draft
//      idéntico al publicado no cuenta como activo.
//   4. buildPublishPatch copia draft→flat y limpia el draft.
//   5. buildDiscardPatch limpia el draft SIN tocar el flat.

const {
  BRANDING_FIELDS,
  readPublishedBranding,
  readDraftBranding,
  readEffectiveBranding,
  hasActiveDraft,
  getDraftDiff,
  buildDraftPatch,
  buildPublishPatch,
  buildDiscardPatch,
} = require('./xololoStorefrontDraft');

const makeUser = publicData => ({
  attributes: { profile: { publicData } },
});

describe('BRANDING_FIELDS', () => {
  it('es un array exportado y estable', () => {
    expect(Array.isArray(BRANDING_FIELDS)).toBe(true);
    expect(BRANDING_FIELDS).toContain('brandPrimaryColor');
    expect(BRANDING_FIELDS).toContain('brandSecondaryColor');
    expect(BRANDING_FIELDS).toContain('logoUrl');
  });
});

describe('readPublishedBranding', () => {
  it('lee del flat, normaliza vacío a null', () => {
    const u = makeUser({
      brandPrimaryColor: '#1f8f52',
      brandSecondaryColor: '',
      logoUrl: 'https://x/l.png',
    });
    const p = readPublishedBranding(u);
    expect(p.brandPrimaryColor).toBe('#1f8f52');
    expect(p.brandSecondaryColor).toBe(null);
    expect(p.logoUrl).toBe('https://x/l.png');
    expect(p.bannerUrl).toBe(null);
  });

  it('IGNORA el draft al leer publicado (invariante)', () => {
    const u = makeUser({
      brandPrimaryColor: '#111111',
      storefrontDraft: { brandPrimaryColor: '#999999' },
    });
    expect(readPublishedBranding(u).brandPrimaryColor).toBe('#111111');
  });

  it('safe con publicData vacío', () => {
    expect(readPublishedBranding({}).brandPrimaryColor).toBe(null);
  });
});

describe('readDraftBranding', () => {
  it('devuelve null si no hay storefrontDraft', () => {
    expect(readDraftBranding(makeUser({ brandPrimaryColor: '#111' }))).toBe(null);
  });

  it('devuelve null si el draft existe pero todos los campos son nulos', () => {
    const u = makeUser({ storefrontDraft: { brandPrimaryColor: '', logoUrl: null } });
    expect(readDraftBranding(u)).toBe(null);
  });

  it('devuelve el shape del draft cuando tiene al menos un campo', () => {
    const u = makeUser({
      storefrontDraft: { brandPrimaryColor: '#ABCDEF', bannerUrl: 'https://b.png' },
    });
    const d = readDraftBranding(u);
    expect(d.brandPrimaryColor).toBe('#ABCDEF');
    expect(d.bannerUrl).toBe('https://b.png');
    expect(d.logoUrl).toBe(null);
  });
});

describe('readEffectiveBranding', () => {
  it('cae al publicado si no hay draft', () => {
    const u = makeUser({ brandPrimaryColor: '#111' });
    expect(readEffectiveBranding(u).brandPrimaryColor).toBe('#111');
  });

  it('prioriza draft sobre publicado', () => {
    const u = makeUser({
      brandPrimaryColor: '#111',
      storefrontDraft: { brandPrimaryColor: '#222' },
    });
    expect(readEffectiveBranding(u).brandPrimaryColor).toBe('#222');
  });
});

describe('hasActiveDraft', () => {
  it('false sin draft', () => {
    expect(hasActiveDraft(makeUser({}))).toBe(false);
  });

  it('false si el draft es idéntico al publicado', () => {
    const u = makeUser({
      brandPrimaryColor: '#111',
      logoUrl: 'https://l',
      storefrontDraft: { brandPrimaryColor: '#111', logoUrl: 'https://l' },
    });
    expect(hasActiveDraft(u)).toBe(false);
  });

  it('true si al menos un campo del draft difiere', () => {
    const u = makeUser({
      brandPrimaryColor: '#111',
      storefrontDraft: { brandPrimaryColor: '#222' },
    });
    expect(hasActiveDraft(u)).toBe(true);
  });
});

describe('getDraftDiff', () => {
  it('[] sin draft', () => {
    expect(getDraftDiff(makeUser({}))).toEqual([]);
  });

  it('solo las keys que difieren', () => {
    const u = makeUser({
      brandPrimaryColor: '#111',
      logoUrl: 'https://l',
      storefrontDraft: { brandPrimaryColor: '#222', logoUrl: 'https://l', bannerUrl: 'https://b' },
    });
    const diff = getDraftDiff(u);
    expect(diff).toContain('brandPrimaryColor');
    expect(diff).toContain('bannerUrl');
    expect(diff).not.toContain('logoUrl');
  });
});

describe('buildDraftPatch', () => {
  it('rutea branding a storefrontDraft, deja otros flat', () => {
    const patch = buildDraftPatch({
      branding: { brandPrimaryColor: '#111', logoUrl: '  ' },
      other: { whatsapp: '5551234567', slug: 'mitienda' },
    });
    expect(patch.storefrontDraft.brandPrimaryColor).toBe('#111');
    expect(patch.storefrontDraft.logoUrl).toBe(null);
    expect(patch.whatsapp).toBe('5551234567');
    expect(patch.slug).toBe('mitienda');
    // Nunca escribimos el branding al flat en save-draft.
    expect(patch.brandPrimaryColor).toBe(undefined);
    expect(patch.logoUrl).toBe(undefined);
  });

  it('other opcional', () => {
    const patch = buildDraftPatch({ branding: { brandPrimaryColor: '#111' } });
    expect(patch.storefrontDraft.brandPrimaryColor).toBe('#111');
  });
});

describe('buildPublishPatch', () => {
  it('copia draft→flat y limpia draft', () => {
    const u = makeUser({
      brandPrimaryColor: '#000',
      storefrontDraft: { brandPrimaryColor: '#222', logoUrl: 'https://l' },
    });
    const patch = buildPublishPatch({ user: u });
    expect(patch.brandPrimaryColor).toBe('#222');
    expect(patch.logoUrl).toBe('https://l');
    expect(patch.storefrontDraft).toBe(null);
  });

  it('si no hay draft, publica el flat tal cual (no-op funcional)', () => {
    const u = makeUser({ brandPrimaryColor: '#111' });
    const patch = buildPublishPatch({ user: u });
    expect(patch.brandPrimaryColor).toBe('#111');
    expect(patch.storefrontDraft).toBe(null);
  });

  it('acepta draft explícito como override', () => {
    const u = makeUser({ brandPrimaryColor: '#000' });
    const patch = buildPublishPatch({ user: u, draft: { brandPrimaryColor: '#FFF' } });
    expect(patch.brandPrimaryColor).toBe('#FFF');
  });
});

describe('buildDiscardPatch', () => {
  it('solo limpia el draft, no toca flat', () => {
    const patch = buildDiscardPatch();
    expect(patch).toEqual({ storefrontDraft: null });
  });
});
