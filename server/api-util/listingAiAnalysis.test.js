// Tests de los helpers puros de listingAiAnalysis. Las partes que tocan
// red (analyzeImage, analyzeListing) requieren mocks del SDK y están
// cubiertas por el commit siguiente cuando montemos el endpoint E2E.

const { aggregatePerImage, pickImagesToAnalyze, extractImageUrl } =
  require('./listingAiAnalysis');

describe('aggregatePerImage', () => {
  test('devuelve defaults si no hay imágenes', () => {
    const r = aggregatePerImage({});
    expect(r.moderation.status).toBe('safe');
    expect(r.tags).toEqual({});
    expect(r.autoDescription).toBe('');
  });

  test('agrega tags de múltiples imágenes como union sin duplicados', () => {
    const r = aggregatePerImage({
      a: {
        tags: {
          objects: ['jarrón', 'flores'],
          colors: ['negro'],
          materials: ['barro'],
          keywords: ['artesanía', 'mexicano'],
          style: 'artesanal',
          setting: 'mesa',
          quality: 'buena',
        },
        moderation: { status: 'safe', reasons: [] },
        autoDescription: 'Jarrón de barro negro con flores',
      },
      b: {
        tags: {
          objects: ['jarrón', 'girasol'],
          colors: ['negro', 'amarillo'],
          materials: ['barro'],
          keywords: ['artesanía'],
        },
        moderation: { status: 'safe', reasons: [] },
        autoDescription: 'Vista cercana del jarrón',
      },
    });
    expect(r.tags.objects.sort()).toEqual(['flores', 'girasol', 'jarrón']);
    expect(r.tags.colors.sort()).toEqual(['amarillo', 'negro']);
    expect(r.tags.materials).toEqual(['barro']);
    expect(r.tags.keywords.sort()).toEqual(['artesanía', 'mexicano']);
    expect(r.tags.style).toBe('artesanal');
    expect(r.autoDescription).toBe('Jarrón de barro negro con flores');
    expect(r.moderation.status).toBe('safe');
  });

  test('status=block si cualquier imagen es block', () => {
    const r = aggregatePerImage({
      a: { tags: {}, moderation: { status: 'safe', reasons: [] } },
      b: {
        tags: {},
        moderation: {
          status: 'block',
          reasons: ['arma de fuego'],
          notes: 'pistola visible',
        },
      },
      c: { tags: {}, moderation: { status: 'warn', reasons: ['alcohol sin marca'] } },
    });
    expect(r.moderation.status).toBe('block');
    expect(r.moderation.blockReasons).toContain('arma de fuego');
    // warn no se descarta, también se registra para el audit log
    expect(r.moderation.warnReasons).toContain('alcohol sin marca');
    expect(r.moderation.flaggedImages).toHaveLength(2);
    expect(r.moderation.flaggedImages.find(f => f.imageId === 'b').status).toBe('block');
  });

  test('status=warn si no hay block pero sí warn', () => {
    const r = aggregatePerImage({
      a: { tags: {}, moderation: { status: 'safe', reasons: [] } },
      b: {
        tags: {},
        moderation: { status: 'warn', reasons: ['réplica de marca'], notes: '' },
      },
    });
    expect(r.moderation.status).toBe('warn');
    expect(r.moderation.blockReasons).toEqual([]);
    expect(r.moderation.warnReasons).toContain('réplica de marca');
    expect(r.moderation.flaggedImages).toHaveLength(1);
  });

  test('normaliza case y trim en tags', () => {
    const r = aggregatePerImage({
      a: {
        tags: {
          objects: [' Jarrón ', 'JARRÓN', 'flores'],
          colors: [],
          materials: [],
          keywords: [],
        },
        moderation: { status: 'safe', reasons: [] },
      },
    });
    expect(r.tags.objects).toEqual(['jarrón', 'flores']);
  });
});

describe('pickImagesToAnalyze', () => {
  const mkImg = uuid => ({ id: { uuid }, type: 'image' });

  test('devuelve solo imágenes nuevas', () => {
    const result = pickImagesToAnalyze({
      listingImages: [mkImg('a'), mkImg('b'), mkImg('c')],
      existingPerImage: { a: {}, b: {} },
      force: false,
    });
    expect(result.map(i => i.id.uuid)).toEqual(['c']);
  });

  test('force=true devuelve todas', () => {
    const result = pickImagesToAnalyze({
      listingImages: [mkImg('a'), mkImg('b')],
      existingPerImage: { a: {}, b: {} },
      force: true,
    });
    expect(result).toHaveLength(2);
  });

  test('devuelve todas si no hay historial', () => {
    const result = pickImagesToAnalyze({
      listingImages: [mkImg('a')],
      existingPerImage: {},
      force: false,
    });
    expect(result).toHaveLength(1);
  });

  test('devuelve vacío si no hay imágenes', () => {
    const result = pickImagesToAnalyze({
      listingImages: [],
      existingPerImage: {},
      force: false,
    });
    expect(result).toEqual([]);
  });
});

describe('extractImageUrl', () => {
  test('prefiere scaled-large sobre otras variants', () => {
    const img = {
      attributes: {
        variants: {
          'scaled-large': { url: 'https://cdn/large.jpg' },
          'scaled-medium': { url: 'https://cdn/medium.jpg' },
          'listing-card': { url: 'https://cdn/card.jpg' },
        },
      },
    };
    expect(extractImageUrl(img)).toBe('https://cdn/large.jpg');
  });

  test('cae a listing-card-2x cuando no hay scaled', () => {
    const img = {
      attributes: {
        variants: {
          'listing-card-2x': { url: 'https://cdn/2x.jpg' },
          'listing-card': { url: 'https://cdn/card.jpg' },
        },
      },
    };
    expect(extractImageUrl(img)).toBe('https://cdn/2x.jpg');
  });

  test('devuelve null si no hay variants', () => {
    expect(extractImageUrl({})).toBe(null);
    expect(extractImageUrl(null)).toBe(null);
    expect(extractImageUrl({ attributes: {} })).toBe(null);
  });
});
