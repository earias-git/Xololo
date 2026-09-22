// XOLOLO F3 · Sprint 2: cola in-memory + agregador de eventos de tracking.
//
// Diseño:
//   - Los eventos entran por /api/track/event y se pushean a `queue`.
//   - Un timer flush cada FLUSH_INTERVAL_MS agrupa por listingId y hace
//     UN updateMetadata por listing (Integration SDK) con los deltas.
//   - Storage por listing en metadata.xololoAnalytics:
//       {
//         totals: { [event]: { [source]: n } },
//         byDay:  { 'YYYY-MM-DD': { [event]: { [source]: n } } },
//         updatedAt: ISO,
//       }
//   - byDay se recorta a últimos BYDAY_KEEP_DAYS = 90 días en cada
//     flush del listing.
//   - Trade-off aceptado (v1): la queue en memoria se pierde si el
//     server reinicia. Máximo perdemos FLUSH_INTERVAL_MS de tracking.
//     En v2 se promueve a queue durable (Redis / DB row).
//
// Rate limit: se aplica en el endpoint (no acá). La queue asume que
// lo que llega ya pasó por rate-limit.

const { getIntegrationSdk } = require('./integrationSdk');

const FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const BYDAY_KEEP_DAYS = 90;
const MAX_QUEUE_SIZE = 50000; // fusible de seguridad

// Eventos válidos. Sync con src/util/tracking.js.
const VALID_EVENTS = new Set([
  'listing.viewed',
  'listing.added_to_cart',
  'checkout.started',
  'listing.shared_external',
]);

// Sources válidas. Sync con src/util/tracking.js.
const VALID_SOURCES = new Set([
  'direct',
  'xololo',
  'seller_store',
  'facebook',
  'instagram',
  'whatsapp',
  'twitter',
  'tiktok',
  'search',
  'other',
]);

// Channels válidos para shared_external.
const VALID_CHANNELS = new Set([
  'whatsapp',
  'facebook',
  'instagram',
  'twitter',
  'copy_link',
  'other',
]);

let queue = [];
let flushTimer = null;
let started = false;

// --------- helpers ---------

const todayYmd = () => new Date().toISOString().slice(0, 10);

const cutoffYmd = daysAgo => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
};

// Agrupa la queue por listingId: { listingId → deltas por evento y source }
const groupByListing = events => {
  const out = new Map();
  for (const evt of events) {
    const { listingId, event, source, channel } = evt;
    // Para shared_external tratamos `channel` como sub-source dentro
    // del "totals.shares" — Simplifica el shape del metadata.
    const bucketEvent = event;
    const bucketSource = event === 'listing.shared_external' ? channel : source;
    if (!bucketSource) continue;

    let entry = out.get(listingId);
    if (!entry) {
      entry = { totals: {}, day: {} };
      out.set(listingId, entry);
    }
    if (!entry.totals[bucketEvent]) entry.totals[bucketEvent] = {};
    entry.totals[bucketEvent][bucketSource] =
      (entry.totals[bucketEvent][bucketSource] || 0) + 1;

    const day = todayYmd();
    if (!entry.day[day]) entry.day[day] = {};
    if (!entry.day[day][bucketEvent]) entry.day[day][bucketEvent] = {};
    entry.day[day][bucketEvent][bucketSource] =
      (entry.day[day][bucketEvent][bucketSource] || 0) + 1;
  }
  return out;
};

// Merge shallow-safe de dos objetos {evt: {src: n}} sumando counts.
const mergeCounts = (dst, delta) => {
  for (const [evt, srcMap] of Object.entries(delta || {})) {
    if (!dst[evt]) dst[evt] = {};
    for (const [src, n] of Object.entries(srcMap)) {
      dst[evt][src] = (dst[evt][src] || 0) + n;
    }
  }
};

// Recorta byDay a los últimos BYDAY_KEEP_DAYS días.
const trimByDay = byDay => {
  const cutoff = cutoffYmd(BYDAY_KEEP_DAYS);
  const trimmed = {};
  for (const [day, data] of Object.entries(byDay || {})) {
    if (day >= cutoff) trimmed[day] = data;
  }
  return trimmed;
};

// Aplica los deltas a la analytics existente del listing y devuelve
// el objeto nuevo listo para persistir.
const applyDeltas = (existing, delta) => {
  const totals = { ...(existing?.totals || {}) };
  mergeCounts(totals, delta.totals);

  const byDay = { ...(existing?.byDay || {}) };
  for (const [day, dayDelta] of Object.entries(delta.day)) {
    byDay[day] = { ...(byDay[day] || {}) };
    mergeCounts(byDay[day], dayDelta);
  }
  const byDayTrimmed = trimByDay(byDay);

  return {
    totals,
    byDay: byDayTrimmed,
    updatedAt: new Date().toISOString(),
  };
};

// --------- flush ---------

const flushOnce = async () => {
  if (queue.length === 0) return { flushed: 0 };
  const batch = queue;
  queue = [];

  const sdk = getIntegrationSdk();
  if (!sdk) {
    // Integration SDK missing → devolvemos los eventos a la queue para
    // reintentar en el próximo tick (no perdemos data en dev local).
    queue = batch.concat(queue);
    // eslint-disable-next-line no-console
    console.warn('[tracking] flush: Integration SDK missing, requeued', batch.length);
    return { flushed: 0, requeued: batch.length };
  }

  const grouped = groupByListing(batch);
  let ok = 0;
  let fail = 0;

  for (const [listingId, delta] of grouped) {
    try {
      const showResp = await sdk.listings.show({ id: listingId });
      const existing = showResp.data.data.attributes?.metadata?.xololoAnalytics || null;
      const next = applyDeltas(existing, delta);
      await sdk.listings.update({
        id: listingId,
        metadata: { xololoAnalytics: next },
      });
      ok += 1;
    } catch (err) {
      fail += 1;
      // eslint-disable-next-line no-console
      console.warn('[tracking] flush listing failed:', listingId, err?.message);
      // No re-enqueueamos por listing individual — si un listing falla
      // repetidamente pierde eventos, no bloqueamos el resto.
    }
  }

  return { flushed: ok, failed: fail, events: batch.length };
};

// --------- public API ---------

const enqueue = evt => {
  if (!evt || !evt.listingId) return { ok: false, reason: 'invalid' };
  if (!VALID_EVENTS.has(evt.event)) return { ok: false, reason: 'invalid_event' };
  if (evt.source && !VALID_SOURCES.has(evt.source)) evt.source = 'other';
  if (evt.channel && !VALID_CHANNELS.has(evt.channel)) evt.channel = 'other';
  if (queue.length >= MAX_QUEUE_SIZE) {
    // eslint-disable-next-line no-console
    console.warn('[tracking] queue full — dropping oldest');
    queue.shift();
  }
  queue.push({ ...evt, at: Date.now() });
  return { ok: true, queued: true };
};

const start = () => {
  if (started) return;
  started = true;
  // Primer flush a los 30s para no coincidir con arranque del server.
  setTimeout(() => {
    flushOnce().then(r => {
      // eslint-disable-next-line no-console
      console.log('[tracking] first flush:', r);
    });
    flushTimer = setInterval(() => {
      flushOnce().then(r => {
        if (r.flushed || r.failed) {
          // eslint-disable-next-line no-console
          console.log('[tracking] flush:', r);
        }
      });
    }, FLUSH_INTERVAL_MS);
  }, 30 * 1000);
};

const stop = () => {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  started = false;
};

module.exports = {
  enqueue,
  start,
  stop,
  flushOnce,
  VALID_EVENTS,
  VALID_SOURCES,
  VALID_CHANNELS,
  _queueSize: () => queue.length, // testing
};
