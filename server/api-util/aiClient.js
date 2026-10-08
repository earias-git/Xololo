// XOLOLO Fase 2 — Cliente centralizado para llamadas a Claude (Anthropic).
//
// Un solo wrapper del SDK oficial para que TODAS las features de IA
// (image analysis, moderación, text helpers, SEO, smart search, seller
// insights) compartan: inicialización perezosa de la API key, retry con
// backoff, timeout por request, parsing robusto de responses JSON y logs
// uniformes de latencia/costo.
//
// Patrón de uso:
//
//   const { chat, chatJson, vision, isConfigured } = require('./aiClient');
//
//   // Texto plano
//   const text = await chat({
//     system: 'Eres un asistente que resume en 1 línea.',
//     messages: [{ role: 'user', content: 'Qué es Xololo?' }],
//   });
//
//   // Esperando JSON estricto (parsea y valida con Zod opcional)
//   const data = await chatJson({
//     system: PROMPTS.imageAnalysis.system,
//     messages: [{ role: 'user', content: [...] }],
//     expectShape: ['tags', 'moderation'], // claves top-level mínimas
//   });
//
// Env vars:
//   ANTHROPIC_API_KEY — key creada en console.anthropic.com (requerida)
//   XOLOLO_AI_MODEL   — opcional, default 'claude-haiku-5-5'
//   XOLOLO_AI_DEBUG   — '1' para loggear request/response completos

const DEFAULT_MODEL = 'claude-haiku-5-5';
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_TIMEOUT_MS = 30_000; // 30s para fotos; textos son más rápidos
const MAX_RETRIES = 2; // además del intento inicial

let cachedClient = null;

/**
 * Lazy init del SDK oficial. Devuelve null si falta la env var —
 * nunca lanza, para que un servicio sin IA siga arrancando y los
 * handlers decidan qué hacer (fallback a flujo clásico, etc.).
 */
const getClient = () => {
  if (cachedClient !== null) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    cachedClient = false; // marker: ya intentamos y no hay key
    return null;
  }
  // Import perezoso para que el bundle no explote si el SDK no está
  // instalado en algún build minimal.
  // eslint-disable-next-line global-require
  const Anthropic = require('@anthropic-ai/sdk');
  cachedClient = new Anthropic.default({ apiKey });
  return cachedClient;
};

const isConfigured = () => !!getClient();

const DEBUG = () => process.env.XOLOLO_AI_DEBUG === '1';
const MODEL = () => process.env.XOLOLO_AI_MODEL || DEFAULT_MODEL;

const sleep = ms => new Promise(r => setTimeout(r, ms));

const sanitizeForLog = payload => {
  try {
    const copy = JSON.parse(JSON.stringify(payload));
    const walk = node => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      for (const [k, v] of Object.entries(node)) {
        if (k === 'data' && typeof v === 'string' && v.length > 120) {
          node[k] = `[base64:${v.length}chars]`;
        } else {
          walk(v);
        }
      }
    };
    walk(copy);
    return copy;
  } catch (_) {
    return '[unserializable]';
  }
};

/**
 * Llamada base. Retorna el mensaje completo del SDK para que los
 * wrappers superiores extraigan texto / JSON según necesiten.
 *
 * @param {Object} opts
 * @param {string} [opts.system] - System prompt.
 * @param {Array} opts.messages - Mensajes en formato Anthropic.
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.purpose] - Etiqueta para logs (p.ej. 'image-analysis').
 * @returns {Promise<Object>} Respuesta cruda del SDK.
 */
const callClaude = async opts => {
  const client = getClient();
  if (!client) throw new Error('ai_not_configured');

  const {
    system,
    messages,
    maxTokens = DEFAULT_MAX_TOKENS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    purpose = 'generic',
  } = opts;

  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('ai_invalid_messages');
  }

  const started = Date.now();
  let attempt = 0;
  let lastErr;

  while (attempt <= MAX_RETRIES) {
    attempt += 1;
    try {
      if (DEBUG()) {
        // eslint-disable-next-line no-console
        console.log(
          `[aiClient] → ${purpose} attempt=${attempt} model=${MODEL()}`,
          sanitizeForLog({ system: system?.slice(0, 200), messages })
        );
      }
      const resp = await client.messages.create(
        {
          model: MODEL(),
          max_tokens: maxTokens,
          ...(system ? { system } : {}),
          messages,
        },
        { timeout: timeoutMs }
      );
      const elapsed = Date.now() - started;
      // eslint-disable-next-line no-console
      console.log(
        `[aiClient] ✓ ${purpose} attempt=${attempt} elapsed=${elapsed}ms ` +
          `in=${resp.usage?.input_tokens} out=${resp.usage?.output_tokens}`
      );
      return resp;
    } catch (err) {
      lastErr = err;
      const status = err?.status || err?.response?.status;
      const retryable =
        !status ||
        status === 408 ||
        status === 409 ||
        status === 429 ||
        (status >= 500 && status < 600);
      // eslint-disable-next-line no-console
      console.error(
        `[aiClient] ✗ ${purpose} attempt=${attempt} status=${status} msg=${err?.message}`
      );
      if (!retryable || attempt > MAX_RETRIES) break;
      await sleep(200 * 2 ** (attempt - 1)); // 200ms, 400ms, 800ms...
    }
  }
  throw lastErr;
};

/**
 * Extrae texto plano del response. Concatena todos los bloques text.
 */
const extractText = response => {
  if (!response?.content || !Array.isArray(response.content)) return '';
  return response.content
    .filter(b => b?.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('\n')
    .trim();
};

/**
 * Chat simple: devuelve el texto plano del response.
 */
const chat = async opts => {
  const resp = await callClaude(opts);
  return extractText(resp);
};

/**
 * Chat que parsea JSON. El modelo puede devolver JSON "sucio"
 * (envuelto en ```json ... ``` o con texto preamble). Extraemos el
 * primer objeto {} válido. Si expectShape se pasa, verifica que las
 * claves top-level mínimas estén presentes.
 *
 * @throws {Error} 'ai_invalid_json' | 'ai_shape_mismatch'
 */
const chatJson = async ({ expectShape, ...opts }) => {
  const text = await chat(opts);
  const parsed = parseJsonFromText(text);
  if (parsed == null) {
    const sample = text.slice(0, 200);
    const err = new Error('ai_invalid_json');
    err.sample = sample;
    throw err;
  }
  if (Array.isArray(expectShape) && expectShape.length) {
    const missing = expectShape.filter(k => !(k in parsed));
    if (missing.length) {
      const err = new Error('ai_shape_mismatch');
      err.missing = missing;
      throw err;
    }
  }
  return parsed;
};

/**
 * Helper visión: construye un mensaje con imagen (URL o base64) +
 * instrucción textual. El SDK v0.x usa este formato para content blocks.
 */
const vision = async ({ system, imageUrl, imageBase64, mediaType, instruction, expectShape, ...rest }) => {
  if (!imageUrl && !imageBase64) throw new Error('ai_vision_requires_image');
  const imageBlock = imageUrl
    ? { type: 'image', source: { type: 'url', url: imageUrl } }
    : {
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType || 'image/jpeg',
          data: imageBase64,
        },
      };
  const messages = [
    {
      role: 'user',
      content: [imageBlock, { type: 'text', text: instruction }],
    },
  ];
  if (expectShape) {
    return chatJson({ system, messages, expectShape, ...rest });
  }
  return chat({ system, messages, ...rest });
};

/**
 * Extrae el primer objeto JSON de un texto. Tolera ```json fences,
 * texto preamble/postamble, y errores de encoding.
 */
const parseJsonFromText = text => {
  if (!text) return null;
  // Intento 1: JSON crudo directo.
  try {
    return JSON.parse(text);
  } catch (_) {
    // sigue
  }
  // Intento 2: entre fences ```json ... ```
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1]);
    } catch (_) {
      // sigue
    }
  }
  // Intento 3: substring entre primera { y última } balanceadas.
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    try {
      return JSON.parse(text.slice(first, last + 1));
    } catch (_) {
      // sigue
    }
  }
  return null;
};

// Reset interno sólo para tests.
const __resetForTests = () => {
  cachedClient = null;
};

// Inyección directa de cliente mockeado para tests. En producción nunca
// se usa — getClient() siempre crea el cliente real desde ANTHROPIC_API_KEY.
const __setClientForTests = client => {
  cachedClient = client;
};

module.exports = {
  isConfigured,
  chat,
  chatJson,
  vision,
  callClaude,
  extractText,
  parseJsonFromText,
  __resetForTests,
  __setClientForTests,
};
