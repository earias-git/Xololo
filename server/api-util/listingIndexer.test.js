const { listingToAlgoliaDoc, toSlug } = require('./listingIndexer');

describe('toSlug', () => {
  test('normaliza acentos y símbolos', () => {
    expect(toSlug('Diadema con Flores Dísecadas')).toBe('diadema-con-flores-disecadas');
    expect(toSlug('Jarrón de barro "cilindro" 40 x 40 cm.')).toBe('jarron-de-barro-cilindro-40-x-40-cm');
    expect(toSlug('')).toBe('listing');
    expect(toSlug(null)).toBe('listing');
  });
});

describe('listingToAlgoliaDoc', () => {
  const baseListing = {
    id: { uuid: 'abc-123' },
    attributes: {
      title: 'Diadema FLORES Disecadas',
      description: 'Decorativa',
      state: 'published',
      createdAt: '2026-10-06T18:45:06.364Z',
      price: { amount: 350000, currency: 'MXN' },
      publicData: {
        listingType: 'product',
        categoryLevel1: 'artesanias',
        aiAnalysis: {
          aggregated: {
            moderation: { status: 'safe' },
            autoDescription: 'Diademas artesanales con flores secas',
            tags: {
              objects: ['diadema', 'flores'],
              colors: ['rosa'],
              materials: ['flores secas', 'tela'],
              keywords: ['diadema floral', 'tocado floral'],
              style: 'artesanal',
              setting: 'estudio',
              quality: 'buena',
            },
          },
        },
      },
    },
    relationships: {
      author: { data: { id: { uuid: 'user-999' } } },
      images: { data: [{ id: { uuid: 'img-1' } }] },
    },
  };

  const included = [
    {
      type: 'image',
      id: { uuid: 'img-1' },
      attributes: {
        variants: {
          'listing-card-2x': { url: 'https://cdn/foo-2x.jpg' },
          'listing-card': { url: 'https://cdn/foo.jpg' },
        },
      },
    },
    {
      type: 'user',
      id: { uuid: 'user-999' },
      attributes: { profile: { displayName: 'DVIDA MORELOS' } },
    },
  ];

  test('construye un documento con todos los campos esperados', () => {
    const doc = listingToAlgoliaDoc(baseListing, included);
    expect(doc.objectID).toBe('abc-123');
    expect(doc.title).toBe('Diadema FLORES Disecadas');
    expect(doc.slug).toBe('diadema-flores-disecadas');
    expect(doc.priceSubunits).toBe(350000);
    expect(doc.currency).toBe('MXN');
    expect(doc.listingType).toBe('product');
    expect(doc.category).toBe('artesanias');
    expect(doc.authorName).toBe('DVIDA MORELOS');
    expect(doc.authorId).toBe('user-999');
    expect(doc.coverUrl).toBe('https://cdn/foo-2x.jpg');
    expect(doc.hasAiAnalysis).toBe(true);
    expect(doc.moderation).toBe('safe');
    expect(doc.aiTags.objects).toEqual(['diadema', 'flores']);
    expect(doc.aiTags.keywords).toEqual(['diadema floral', 'tocado floral']);
    expect(doc.aiTags.style).toBe('artesanal');
    expect(doc.createdAtTs).toBeGreaterThan(1700000000);
  });

  test('tolera listings sin aiAnalysis', () => {
    const l = {
      ...baseListing,
      attributes: { ...baseListing.attributes, publicData: { listingType: 'service' } },
    };
    const doc = listingToAlgoliaDoc(l, included);
    expect(doc.hasAiAnalysis).toBe(false);
    expect(doc.moderation).toBe('safe'); // default
    expect(doc.autoDescription).toBe('');
    expect(doc.aiTags.objects).toEqual([]);
    expect(doc.aiTags.keywords).toEqual([]);
    expect(doc.aiTags.style).toBe('');
  });

  test('tolera listings sin imagen', () => {
    const l = {
      ...baseListing,
      relationships: { ...baseListing.relationships, images: { data: [] } },
    };
    const doc = listingToAlgoliaDoc(l, included);
    expect(doc.coverUrl).toBe(null);
  });

  test('lanza si falta el uuid', () => {
    expect(() => listingToAlgoliaDoc({}, [])).toThrow('listing_missing_id');
  });
});
