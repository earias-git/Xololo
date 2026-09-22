// XOLOLO F3 · Sprint 2 (+ ampliación admin): cola in-memory + agregador
// de eventos de tracking.
//
// Diseño:
//   - Los eventos entran por /api/track/event y se pushean a una de dos
//     colas según el evento:
//       · listingQueue  (listing.viewed, listing.added_to_cart,
//         checkout.started, listing.shared_external) — agrupados por
//         listingId, se persisten en listing.metadata.xololoAnalytics.
//       · storeViewQueue (store.viewed) — agrupados por sellerId, se
//         persisten en user.metadata.xololoStoreAnalytics. Esto es lo
//         que alimenta "analytics de páginas de sellers" en /admin.
//   - Un timer flush cada FLUSH_INTERVAL_MS vacía ambas colas y hace
//     UN updateProfile/update por recurso (Integration SDK) con los
//     deltas acumulados.
//   - Storage (mismo shape para listing y user):
//       {
//         totals: { [event]: { [source]: n } },
//         byDay:  { 'YYYY-MM-DD': { [event]: { [source]: n } } },
//         updatedAt: ISO,
//       }
//   - byDay se recorta a últimos BYDAY_KEEP_DAYS = 90 días en cada
//     flush del recurso.
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
  'store.viewed',
]);

// Eventos que se agrupan por sellerId (user.metadata) en vez de
// listingId (listing.metadata).
const USER_KEYED_EVENTS = new Set(['store.viewed']);

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

let listingQueue = [];
let storeViewQueue = [];
let flushTimer = null;
let started = false;

// --------- helpers compartidos (listing y user usan el mismo shape) ---------

const todayYmd = () => new Date().toISOString().slice(0, 10);

const cutoffYmd = daysAgo => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
};

// Agrupa eventos por una key (listingId o sellerId) → deltas por
// evento y source.
const groupByKey = (events, keyField) => {
  const out = new Map();
  for (const evt of events) {
    const key = evt[keyField];
    const { event, source, channel } = evt;
    // Para shared_external tratamos `channel` como sub-source dentro
    // del "totals.shares" — simplifica el shape del metadata.
    const bucketEvent = event;
    const bucketSource = event === 'listing.shared_external' ? channel : source;
    if (!bucketSource || !key) continue;

    let entry = out.get(key);
    if (!entry) {
      entry = { totals: {}, day: {} };
      out.set(key, entry);
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

// Aplica los deltas a la analytics existente del recurso y devuelve
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

// --------- flush: listings (xololoAnalytics) ---------

const flushOnce = async () => {
  if (listingQueue.length === 0) return { flushed: 0 };
  const batch = listingQueue;
  listingQueue = [];

  const sdk = getIntegrationSdk();
  if (!sdk) {
    listingQueue = batch.concat(listingQueue);
    // eslint-disable-next-line no-console
    console.warn('[tracking] flush: Integration SDK missing, requeued', batch.length);
    return { flushed: 0, requeued: batch.length };
  }

  const grouped = groupByKey(batch, 'listingId');
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

// --------- flush: sellers/stores (xololoStoreAnalytics) ---------
//
// Mismo patrón que flushOnce pero persiste en user.metadata via
// sdk.users.updateProfile (Integration API expone metadata en el
// profile update, igual que listings.update). Alimenta la sección
// "Tráfico" de /admin con vistas de storefront por seller.

const flushStoreViewsOnce = async () => {
  if (storeViewQueue.length === 0) return { flushed: 0 };
  const batch = storeViewQueue;
  storeViewQueue = [];

  const sdk = getIntegrationSdk();
  if (!sdk) {
    storeViewQueue = batch.concat(storeViewQueue);
    // eslint-disable-next-line no-console
    console.warn('[tracking] store flush: Integration SDK missing, requeued', batch.length);
    return { flushed: 0, requeued: batch.length };
  }

  const grouped = groupByKey(batch, 'sellerId');
  let ok = 0;
  let fail = 0;

  for (const [sellerId, delta] of grouped) {
    try {
      const showResp = await sdk.users.show({ id: sellerId });
      const existing = showResp.data.data.attributes?.metadata?.xololoStoreAnalytics || null;
      const next = applyDeltas(existing, delta);
      await sdk.users.updateProfile({
        id: sellerId,
        metadata: { xololoStoreAnalytics: next },
      });
      ok += 1;
    } catch (err) {
      fail += 1;
      // eslint-disable-next-line no-console
      console.warn('[tracking] store flush failed:', sellerId, err?.message);
    }
  }

  return { flushed: ok, failed: fail, events: batch.length };
};

// --------- public API ---------

const enqueue = evt => {
  if (!evt) return { ok: false, reason: 'invalid' };
  if (!VALID_EVENTS.has(evt.event)) return { ok: false, reason: 'invalid_event' };
  if (evt.source && !VALID_SOURCES.has(evt.source)) evt.source = 'other';
  if (evt.channel && !VALID_CHANNELS.has(evt.channel)) evt.channel = 'other';

  if (USER_KEYED_EVENTS.has(evt.event)) {
    if (!evt.sellerId) return { ok: false, reason: 'invalid' };
    if (storeViewQueue.length >= MAX_QUEUE_SIZE) {
      // eslint-disable-next-line no-console
      console.warn('[tracking] store queue full — dropping oldest');
      storeViewQueue.shift();
    }
    storeViewQueue.push({ ...evt, at: Date.now() });
    return { ok: true, queued: true };
  }

  if (!evt.listingId) return { ok: false, reason: 'invalid' };
  if (listingQueue.length >= MAX_QUEUE_SIZE) {
    // eslint-disable-next-line no-console
    console.warn('[tracking] queue full — dropping oldest');
    listingQueue.shift();
  }
  listingQueue.push({ ...evt, at: Date.now() });
  return { ok: true, queued: true };
};

const start = () => {
  if (started) return;
  started = true;
  // Primer flush a los 30s para no coincidir con arranque del server.
  setTimeout(() => {
    Promise.all([flushOnce(), flushStoreViewsOnce()]).then(([listingR, storeR]) => {
      // eslint-disable-next-line no-console
      console.log('[tracking] first flush:', { listings: listingR, stores: storeR });
    });
    flushTimer = setInterval(() => {
      Promise.all([flushOnce(), flushStoreViewsOnce()]).then(([listingR, storeR]) => {
        if (listingR.flushed || listingR.failed || storeR.flushed || storeR.failed) {
          // eslint-disable-next-line no-console
          console.log('[tracking] flush:', { listings: listingR, stores: storeR });
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
  flushStoreViewsOnce,
  VALID_EVENTS,
  VALID_SOURCES,
  VALID_CHANNELS,
  USER_KEYED_EVENTS,
  _queueSize: () => listingQueue.length, // testing
  _storeQueueSize: () => storeViewQueue.length, // testing
};
