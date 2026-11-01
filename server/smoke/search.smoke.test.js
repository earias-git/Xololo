// XOLOLO Blindaje — smoke tests del motor de búsqueda.
// Verifica el orden Algolia → Sharetribe → IA definido en
// docs/decisions/ADR-001-search-order.md.
//
// Estos tests NO llaman red real — mockean search() (Algolia),
// interpretQuery (Haiku) y el SDK de Sharetribe. Sirven para
// garantizar que la LÓGICA del handler respeta el orden acordado,
// aunque alguien reorganice el código.
//
// Si estos fallan, PARAR: alguien cambió el orden del search sin
// seguir el protocolo del ADR-001.

jest.mock('../api-util/algoliaClient', () => {
  const mock = {
    search: jest.fn(),
    isConfigured: jest.fn(() => true),
  };
  return mock;
});

jest.mock('../api-util/aiClient', () => ({
  chatJson: jest.fn(),
  isConfigured: jest.fn(() => true),
}));

jest.mock('../api-util/aiMetrics', () => ({
  recordAiCall: jest.fn(),
}));

jest.mock('../api-util/aiPrompts', () => ({
  SEARCH_QUERY_UNDERSTAND_V1: {
    system: 'test',
    instruction: () => 'test',
    expectShape: {},
  },
}));

jest.mock('../api-util/sdk', () => ({
  getSdk: jest.fn(),
}));

jest.mock('../api-util/integrationSdk', () => ({
  getIntegrationSdk: jest.fn(() => null),
}));

const algoliaClient = require('../api-util/algoliaClient');
const aiClient = require('../api-util/aiClient');
const sdkUtil = require('../api-util/sdk');
const handler = require('../api/search');

const makeRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const sdkListingShape = ({ id, title, price = 10000, slug = null, cover = 'https://x.mx/img.jpg' }) => ({
  id: { uuid: id },
  attributes: {
    title,
    state: 'published',
    price: { amount: price, currency: 'MXN' },
    publicData: slug ? { slug } : {},
    metadata: {},
  },
  relationships: {
    images: cover
      ? { data: [{ id: { uuid: `img-${id}` }, type: 'image' }] }
      : { data: [] },
    author: { data: { id: { uuid: `author-${id}` } } },
  },
});

const sdkIncludedImage = (id, url) => ({
  type: 'image',
  id: { uuid: `img-${id}` },
  attributes: {
    variants: { 'listing-card-2x': { url }, 'listing-card': { url } },
  },
});

const makeMockSdk = ({ queryHits = [], queryIncluded = [], showResp = null } = {}) => ({
  listings: {
    query: jest.fn(() =>
      Promise.resolve({
        data: { data: queryHits, included: queryIncluded, meta: { totalItems: queryHits.length } },
      })
    ),
    show: jest.fn(() =>
      Promise.resolve({
        data: showResp || { data: null, included: [] },
      })
    ),
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  // Reinicializar impls después de clearAllMocks.
  algoliaClient.isConfigured.mockReturnValue(true);
  aiClient.isConfigured.mockReturnValue(true);
});

// ============================================================
// ADR-001 §1: Algolia siempre va primero.
// ============================================================

describe('ADR-001: Algolia primero', () => {
  it('invoca algoliaClient.search() ANTES que cualquier otra fuente', async () => {
    algoliaClient.search.mockResolvedValue({
      hits: [
        {
          objectID: 'l-1',
          title: 'T-Bone de cerdo',
          coverUrl: 'https://x.mx/a.jpg',
          priceSubunits: 8000,
          currency: 'MXN',
          slug: 't-bone',
        },
      ],
      nbHits: 1,
      processingTimeMS: 10,
    });
    sdkUtil.getSdk.mockReturnValue(makeMockSdk());

    const req = { query: { q: 'cerdo' } };
    const res = makeRes();
    await handler(req, res);

    expect(algoliaClient.search).toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.ok).toBe(true);
    expect(payload.listings).toHaveLength(1);
    expect(payload.listings[0].title).toBe('T-Bone de cerdo');
  });
});

// ============================================================
// ADR-001 §3: IA NO se dispara para query simple de 1-2 palabras.
// ============================================================

describe('ADR-001: IA NO se dispara para query simple', () => {
  it('"cerdo" (1 palabra) con Algolia hit → NO llama a chatJson', async () => {
    algoliaClient.search.mockResolvedValue({
      hits: [{ objectID: 'l-1', title: 'Carne de cerdo', coverUrl: 'u', priceSubunits: 5000 }],
      nbHits: 1,
      processingTimeMS: 5,
    });
    sdkUtil.getSdk.mockReturnValue(makeMockSdk());

    const req = { query: { q: 'cerdo' } };
    const res = makeRes();
    await handler(req, res);

    expect(aiClient.chatJson).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.usedAi).toBe(false);
  });

  it('"cerdo" con 0 hits Algolia → PRIMERO Sharetribe, NO IA', async () => {
    algoliaClient.search.mockResolvedValue({ hits: [], nbHits: 0, processingTimeMS: 5 });
    const sdk = makeMockSdk({
      queryHits: [sdkListingShape({ id: 'l-99', title: 'T-Bone de cerdo' })],
      queryIncluded: [sdkIncludedImage('l-99', 'https://x.mx/tbone.jpg')],
    });
    sdkUtil.getSdk.mockReturnValue(sdk);

    const req = { query: { q: 'cerdo' } };
    const res = makeRes();
    await handler(req, res);

    expect(sdk.listings.query).toHaveBeenCalledWith(
      expect.objectContaining({ keywords: 'cerdo' })
    );
    expect(aiClient.chatJson).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.usedAi).toBe(false);
    expect(payload.listings).toHaveLength(1);
    expect(payload.listings[0].title).toBe('T-Bone de cerdo');
  });
});

// ============================================================
// ADR-001 §3: IA SÍ se dispara para query compleja.
// ============================================================

describe('ADR-001: IA SÍ se dispara en query compleja', () => {
  it('"algo para regalo artesanal" con pocos hits → chatJson llamado', async () => {
    algoliaClient.search.mockResolvedValue({ hits: [], nbHits: 0, processingTimeMS: 5 });
    aiClient.chatJson.mockResolvedValue({
      intent: 'regalo artesanal',
      keywords: ['regalo', 'artesanal'],
      categories: ['artesanias'],
      listingTypes: [],
      giftContext: true,
      ambiguous: false,
      reasoning: 'test',
    });
    sdkUtil.getSdk.mockReturnValue(makeMockSdk());

    const req = { query: { q: 'algo para regalo artesanal' } };
    const res = makeRes();
    await handler(req, res);

    expect(aiClient.chatJson).toHaveBeenCalled();
  });
});

// ============================================================
// ADR-001 §5: enriquecer covers faltantes.
// ============================================================

describe('ADR-001: enriquecer covers faltantes', () => {
  it('hits de Algolia sin coverUrl → se enriquecen con sdk.listings.show', async () => {
    algoliaClient.search.mockResolvedValue({
      hits: [
        { objectID: 'l-1', title: 'Velero', coverUrl: null, priceSubunits: 450000 },
        { objectID: 'l-2', title: 'Jarrón', coverUrl: 'ok', priceSubunits: 195000 },
      ],
      nbHits: 2,
      processingTimeMS: 7,
    });
    const sdk = makeMockSdk({
      showResp: {
        data: sdkListingShape({ id: 'l-1', title: 'Velero' }),
        included: [sdkIncludedImage('l-1', 'https://x.mx/velero.jpg')],
      },
    });
    sdkUtil.getSdk.mockReturnValue(sdk);

    const req = { query: { q: 'barco mar' } };
    const res = makeRes();
    await handler(req, res);

    expect(sdk.listings.show).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'l-1' })
    );
    const payload = res.json.mock.calls[0][0];
    const veleroHit = payload.listings.find(l => l.id === 'l-1');
    expect(veleroHit.cover).toBe('https://x.mx/velero.jpg');
  });
});
