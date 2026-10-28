// XOLOLO Fase 2 — tracker de uso IA (calls, tokens, costo estimado).
//
// Cada feature de IA (search interpret, image analysis, text suggest)
// llama a recordAiCall() tras cada request a Claude. Los contadores
// viven en memoria y se persisten a R2 cada 60s (o cuando se forzan
// con flush()). Si el server reinicia antes del flush, se pierden
// hasta ~60s de contadores — aceptable para un dashboard de costos.
//
// Shape persistido en R2 (operators/ai-metrics/YYYY-MM-DD.json):
//   {
//     date: "2026-10-12",
//     calls: { search: 42, imageAnalysis: 10, textSuggest: 5 },
//     tokens: {
//       search:         { in: 35000, out: 28000 },
//       imageAnalysis:  { in: 24000, out: 9000 },
//       textSuggest:    { in: 7200,  out: 15500 },
//     },
//     estimatedCostUsd: 0.1823,
//     updatedAt: "2026-10-12T18:30:41.123Z"
//   }
//
// Precios de referencia (Claude Haiku 5.5, 2026):
//   input:  $0.80 / 1M tokens
//   output: $4.00 / 1M tokens

const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

const PRICE_INPUT_PER_1M = 0.8;
const PRICE_OUTPUT_PER_1M = 4.0;

const FLUSH_INTERVAL_MS = 60_000;

const PURPOSES = ['search', 'imageAnalysis', 'textSuggest'];

const todayKey = () => new Date().toISOString().slice(0, 10);
const r2Key = date => `operators/ai-metrics/${date}.json`;

let r2 = null;
const getR2 = () => {
  if (r2) return r2;
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) return null;
  r2 = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
  return r2;
};
const BUCKET = () => process.env.R2_BUCKET || 'xololo-media';

const emptyDay = date => ({
  date,
  calls: Object.fromEntries(PURPOSES.map(p => [p, 0])),
  tokens: Object.fromEntries(PURPOSES.map(p => [p, { in: 0, out: 0 }])),
  estimatedCostUsd: 0,
  updatedAt: new Date().toISOString(),
});

// Estado in-memory. Se mergea con el documento R2 cuando flush() lo lee.
let buffer = { date: todayKey(), deltaCalls: {}, deltaTokens: {} };
let flushing = false;
let flushTimer = null;

const resetBuffer = (date = todayKey()) => {
  buffer = { date, deltaCalls: {}, deltaTokens: {} };
};

/**
 * Registra una llamada a Claude. purpose debe ser uno de PURPOSES.
 * Tokens se extraen de response.usage (shape de Anthropic SDK).
 *
 * @param {Object} params
 * @param {string} params.purpose
 * @param {Object} [params.usage] - { input_tokens, output_tokens }
 */
const recordAiCall = ({ purpose, usage }) => {
  if (!PURPOSES.includes(purpose)) return;
  const today = todayKey();
  if (buffer.date !== today) {
    // Cambió el día desde el último call → flush y arranca día nuevo.
    flush().catch(() => {});
    resetBuffer(today);
  }
  buffer.deltaCalls[purpose] = (buffer.deltaCalls[purpose] || 0) + 1;
  const inTokens = Number(usage?.input_tokens) || 0;
  const outTokens = Number(usage?.output_tokens) || 0;
  if (!buffer.deltaTokens[purpose]) {
    buffer.deltaTokens[purpose] = { in: 0, out: 0 };
  }
  buffer.deltaTokens[purpose].in += inTokens;
  buffer.deltaTokens[purpose].out += outTokens;
  scheduleFlush();
};

const scheduleFlush = () => {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush().catch(err => {
      // eslint-disable-next-line no-console
      console.error('[aiMetrics] flush failed:', err?.message);
    });
  }, FLUSH_INTERVAL_MS);
  if (flushTimer.unref) flushTimer.unref(); // no bloquea process exit
};

const computeCost = tokens => {
  let cost = 0;
  for (const p of PURPOSES) {
    const t = tokens[p] || { in: 0, out: 0 };
    cost += (t.in / 1_000_000) * PRICE_INPUT_PER_1M;
    cost += (t.out / 1_000_000) * PRICE_OUTPUT_PER_1M;
  }
  return Math.round(cost * 10000) / 10000;
};

const mergeDeltaIntoDoc = (doc, buf) => {
  for (const p of PURPOSES) {
    doc.calls[p] = (doc.calls[p] || 0) + (buf.deltaCalls[p] || 0);
    const bt = buf.deltaTokens[p] || { in: 0, out: 0 };
    doc.tokens[p] = doc.tokens[p] || { in: 0, out: 0 };
    doc.tokens[p].in += bt.in;
    doc.tokens[p].out += bt.out;
  }
  doc.estimatedCostUsd = computeCost(doc.tokens);
  doc.updatedAt = new Date().toISOString();
  return doc;
};

/**
 * Flush: lee el doc del día de R2, mergea el delta in-memory, escribe
 * de vuelta. Si no hay nada que escribir, no-op.
 */
const flush = async () => {
  if (flushing) return;
  const hasDeltas = Object.keys(buffer.deltaCalls).length > 0;
  if (!hasDeltas) return;
  const client = getR2();
  if (!client) return;
  flushing = true;
  const date = buffer.date;
  const snapshot = buffer;
  resetBuffer(date);
  try {
    let doc;
    try {
      const resp = await client.send(new GetObjectCommand({ Bucket: BUCKET(), Key: r2Key(date) }));
      const text = await resp.Body.transformToString('utf-8');
      doc = JSON.parse(text);
    } catch (err) {
      // Si no existe, arrancamos documento del día.
      if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) {
        doc = emptyDay(date);
      } else {
        throw err;
      }
    }
    mergeDeltaIntoDoc(doc, snapshot);
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET(),
        Key: r2Key(date),
        Body: JSON.stringify(doc, null, 2),
        ContentType: 'application/json',
        CacheControl: 'no-cache',
      })
    );
  } finally {
    flushing = false;
  }
};

/**
 * Lee el doc de un día específico desde R2 (o combina con delta
 * in-memory si es hoy). Si no hay nada todavía, devuelve emptyDay().
 */
const getMetricsForDate = async date => {
  const client = getR2();
  if (!client) {
    return { ...emptyDay(date), error: 'r2_not_configured' };
  }
  let doc;
  try {
    const resp = await client.send(new GetObjectCommand({ Bucket: BUCKET(), Key: r2Key(date) }));
    const text = await resp.Body.transformToString('utf-8');
    doc = JSON.parse(text);
  } catch (err) {
    if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) {
      doc = emptyDay(date);
    } else {
      throw err;
    }
  }
  // Mergeamos buffer in-memory si es del mismo día (datos aún no persistidos).
  if (buffer.date === date) {
    doc = mergeDeltaIntoDoc(doc, buffer);
  }
  return doc;
};

/**
 * Lee los últimos N días (incluido hoy). Útil para gráficas.
 */
const getMetricsForLastDays = async (nDays = 30) => {
  const out = [];
  for (let i = nDays - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    try {
      // eslint-disable-next-line no-await-in-loop
      out.push(await getMetricsForDate(date));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[aiMetrics] read failed for', date, err?.message);
      out.push({ ...emptyDay(date), error: 'read_failed' });
    }
  }
  return out;
};

// Helper usado en tests para resetear estado.
const __resetForTests = () => {
  resetBuffer();
  r2 = null;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
};

module.exports = {
  recordAiCall,
  flush,
  getMetricsForDate,
  getMetricsForLastDays,
  computeCost,
  PRICE_INPUT_PER_1M,
  PRICE_OUTPUT_PER_1M,
  PURPOSES,
  __resetForTests,
};
