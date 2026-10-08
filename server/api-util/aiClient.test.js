// Tests del aiClient. En vez de mockear el SDK oficial (frágil con el
// resetMocks:true del jest config), inyectamos un cliente fake vía
// __setClientForTests. Más simple y resiliente.

const originalEnv = process.env;
const aiClient = require('./aiClient');

let createMock;

beforeEach(() => {
  process.env = { ...originalEnv, ANTHROPIC_API_KEY: 'sk-ant-test-key' };
  createMock = jest.fn();
  aiClient.__setClientForTests({ messages: { create: createMock } });
});

afterAll(() => {
  process.env = originalEnv;
  aiClient.__resetForTests();
});

describe('aiClient.isConfigured', () => {
  test('true cuando hay cliente inyectado', () => {
    expect(aiClient.isConfigured()).toBe(true);
  });

  test('false cuando no hay cliente ni env var', () => {
    aiClient.__resetForTests();
    delete process.env.ANTHROPIC_API_KEY;
    expect(aiClient.isConfigured()).toBe(false);
  });
});

describe('aiClient.chat', () => {
  test('devuelve el texto concatenado de los bloques text', async () => {
    createMock.mockResolvedValueOnce({
      content: [
        { type: 'text', text: 'Hola' },
        { type: 'text', text: 'mundo' },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const result = await aiClient.chat({
      system: 'Sé breve.',
      messages: [{ role: 'user', content: 'hi' }],
      purpose: 'test',
    });
    expect(result).toBe('Hola\nmundo');
    expect(createMock).toHaveBeenCalledTimes(1);
    const callArgs = createMock.mock.calls[0][0];
    expect(callArgs.system).toBe('Sé breve.');
    expect(callArgs.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  test('retry en 429 y éxito en segundo intento', async () => {
    const err429 = Object.assign(new Error('rate limit'), { status: 429 });
    createMock
      .mockRejectedValueOnce(err429)
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    const result = await aiClient.chat({
      messages: [{ role: 'user', content: 'x' }],
      purpose: 'retry-test',
    });
    expect(result).toBe('ok');
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  test('no retry en 400 (no retryable)', async () => {
    const err400 = Object.assign(new Error('bad request'), { status: 400 });
    createMock.mockRejectedValue(err400);
    await expect(
      aiClient.chat({ messages: [{ role: 'user', content: 'x' }] })
    ).rejects.toThrow('bad request');
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  test('propaga ai_not_configured si no hay cliente ni env var', async () => {
    aiClient.__resetForTests();
    delete process.env.ANTHROPIC_API_KEY;
    await expect(
      aiClient.chat({ messages: [{ role: 'user', content: 'x' }] })
    ).rejects.toThrow('ai_not_configured');
  });

  test('rechaza messages inválidos', async () => {
    await expect(aiClient.chat({ messages: [] })).rejects.toThrow('ai_invalid_messages');
    await expect(aiClient.chat({ messages: null })).rejects.toThrow('ai_invalid_messages');
  });
});

describe('aiClient.chatJson', () => {
  test('parsea JSON crudo', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"foo":"bar","n":1}' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const r = await aiClient.chatJson({
      messages: [{ role: 'user', content: 'x' }],
      expectShape: ['foo', 'n'],
    });
    expect(r).toEqual({ foo: 'bar', n: 1 });
  });

  test('parsea JSON envuelto en ```json fences', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: '```json\n{"ok":true}\n```' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const r = await aiClient.chatJson({ messages: [{ role: 'user', content: 'x' }] });
    expect(r).toEqual({ ok: true });
  });

  test('parsea JSON con texto preamble', async () => {
    createMock.mockResolvedValueOnce({
      content: [
        { type: 'text', text: 'Aquí tienes:\n{"a":1,"b":{"c":2}}\nEspero sea útil.' },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const r = await aiClient.chatJson({ messages: [{ role: 'user', content: 'x' }] });
    expect(r).toEqual({ a: 1, b: { c: 2 } });
  });

  test('lanza ai_invalid_json si no se puede parsear', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'No tengo nada que devolver' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await expect(
      aiClient.chatJson({ messages: [{ role: 'user', content: 'x' }] })
    ).rejects.toThrow('ai_invalid_json');
  });

  test('lanza ai_shape_mismatch si faltan claves esperadas', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"foo":"bar"}' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await expect(
      aiClient.chatJson({
        messages: [{ role: 'user', content: 'x' }],
        expectShape: ['foo', 'missingKey'],
      })
    ).rejects.toThrow('ai_shape_mismatch');
  });
});

describe('aiClient.vision', () => {
  test('construye content block con imageUrl', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"tags":{}}' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await aiClient.vision({
      imageUrl: 'https://example.com/foo.jpg',
      instruction: 'Describe esta imagen',
      expectShape: ['tags'],
    });
    const callArgs = createMock.mock.calls[0][0];
    expect(callArgs.messages[0].content[0]).toEqual({
      type: 'image',
      source: { type: 'url', url: 'https://example.com/foo.jpg' },
    });
    expect(callArgs.messages[0].content[1]).toEqual({
      type: 'text',
      text: 'Describe esta imagen',
    });
  });

  test('construye content block con imageBase64', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await aiClient.vision({
      imageBase64: 'iVBORw0KGgo=',
      mediaType: 'image/png',
      instruction: 'ver',
    });
    const callArgs = createMock.mock.calls[0][0];
    expect(callArgs.messages[0].content[0]).toEqual({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: 'iVBORw0KGgo=',
      },
    });
  });

  test('rechaza si no viene imagen', async () => {
    await expect(
      aiClient.vision({ instruction: 'ver' })
    ).rejects.toThrow('ai_vision_requires_image');
  });
});

describe('aiClient.parseJsonFromText', () => {
  test('maneja todos los casos edge sin lanzar', () => {
    expect(aiClient.parseJsonFromText('')).toBeNull();
    expect(aiClient.parseJsonFromText(null)).toBeNull();
    expect(aiClient.parseJsonFromText('no json here')).toBeNull();
    expect(aiClient.parseJsonFromText('{"a":1}')).toEqual({ a: 1 });
    expect(aiClient.parseJsonFromText('texto\n{"ok":1}\nmás texto')).toEqual({ ok: 1 });
  });
});
