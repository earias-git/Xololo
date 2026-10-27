const { evaluateShippingFit } = require('./carrierProhibitedCatalog');

describe('evaluateShippingFit', () => {
  it('devuelve ok para producto sin match', () => {
    const r = evaluateShippingFit({
      title: 'Collar de perlas naturales',
      description: 'Collar artesanal hecho a mano con perlas de río.',
    });
    expect(r.verdict).toBe('ok');
    expect(r.matched).toHaveLength(0);
    expect(r.allowedMethods).toContain('skydropxCarrier');
  });

  it('detecta orquídea como prohibido', () => {
    const r = evaluateShippingFit({
      title: 'Orquídea blanca en maceta',
      description: 'Orquídea viva en maceta de barro.',
    });
    expect(r.verdict).toBe('prohibited');
    expect(r.allowedMethods).not.toContain('skydropxCarrier');
    expect(r.matched[0].key).toBe('live_plants_delicate');
  });

  it('detecta tanque de buceo como prohibido (aerosoles/presurizado)', () => {
    const r = evaluateShippingFit({
      title: 'Tanque de buceo usado',
      description: 'Tanque de aluminio en buen estado.',
    });
    expect(r.verdict).toBe('prohibited');
    expect(r.matched[0].key).toBe('aerosols_pressurized');
  });

  it('detecta vino como restringido (requiere condiciones)', () => {
    const r = evaluateShippingFit({
      title: 'Vino tinto reserva 2020',
      description: 'Botella de vino tinto artesanal.',
    });
    expect(r.verdict).toBe('restricted');
    expect(r.allowedMethods).toContain('skydropxCarrier');
    expect(r.matched[0].key).toBe('alcohol_regulated');
  });

  it('usa aiAnalysis tags cuando no hay match en texto', () => {
    const r = evaluateShippingFit({
      title: 'Bebida especial',
      description: 'Un regalo elegante.',
      aiAnalysis: { tags: { objects: ['tequila', 'botella'] } },
    });
    expect(r.verdict).toBe('restricted');
  });

  it('respeta word boundaries (no false positive en "doctoro")', () => {
    const r = evaluateShippingFit({
      title: 'Libro de doctorado',
      description: 'Tesis publicada.',
    });
    expect(r.verdict).toBe('ok');
  });

  it('prohibited gana sobre restricted si ambos matchean', () => {
    const r = evaluateShippingFit({
      title: 'Perfume de orquídea en spray',
      description: 'Perfume premium.',
    });
    expect(r.verdict).toBe('prohibited');
  });
});
