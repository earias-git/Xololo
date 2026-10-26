// XOLOLO: cron que cierra automáticamente listings tipo evento cuando
// pasa su fecha+hora de fin.
//
// Patrón: cada 30 min escanea listings con publicData.isEvent=true y
// state='published'. Si event.date_end + event.time_end ya pasó (con
// 1h de gracia), llama isdk.listings.close.
//
// Idempotente: un listing ya closed no vuelve a procesarse. Un error
// transitorio en una tx no bloquea el resto.
//
// Se llama desde server/index.js:
//   const { start } = require('./jobs/event-auto-close');
//   start();
//
// Scheduler simple setInterval, igual que tacit-acceptance.

const { getIntegrationSdk } = require('../api-util/integrationSdk');

const RUN_EVERY_MS = 30 * 60 * 1000; // cada 30 min
const GRACE_MS = 60 * 60 * 1000; // 1h de gracia después del end
const MAX_PAGES = 10;
const PER_PAGE = 100;

// Convierte "YYYY-MM-DD" + "HH:MM" (hora local MX, sin tz explícita)
// a timestamp ms UTC. Interpretamos como horario de CDMX (UTC-6) para
// que el cron sea predecible sin importar zona del servidor.
const parseEventEndTimestamp = ev => {
  if (!ev) return null;
  const d = ev.date_end || ev.date_start;
  const t = ev.time_end;
  if (!d || !t) return null;
  try {
    const [y, mo, day] = d.split('-').map(Number);
    const [h, mi] = t.split(':').map(Number);
    if (!y || !mo || !day || isNaN(h) || isNaN(mi)) return null;
    // CDMX = UTC-6 (sin DST desde 2022). Para convertir hora local MX a
    // UTC, sumamos 6h.
    return Date.UTC(y, mo - 1, day, h + 6, mi);
  } catch (_) {
    return null;
  }
};

const runTick = async () => {
  const isdk = getIntegrationSdk();
  if (!isdk) return { skipped: 'integration_api_missing', processed: 0 };

  const now = Date.now();
  let inspected = 0;
  let closed = 0;
  const errors = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    let resp;
    try {
      resp = await isdk.listings.query({
        page,
        perPage: PER_PAGE,
        'fields.listing': ['state', 'publicData'],
        states: ['published'],
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[event-auto-close] query failed:', e?.message);
      break;
    }
    const list = resp.data.data || [];
    if (list.length === 0) break;
    for (const l of list) {
      inspected += 1;
      const pd = l.attributes?.publicData || {};
      if (pd.isEvent !== true) continue;
      const endAt = parseEventEndTimestamp(pd.event);
      if (!endAt) continue;
      if (now < endAt + GRACE_MS) continue;
      try {
        await isdk.listings.close({ id: l.id.uuid });
        // Guarda breadcrumb para auditoría.
        await isdk.listings.update({
          id: l.id.uuid,
          publicData: {
            event: { ...pd.event, autoClosedAt: new Date().toISOString() },
          },
        });
        closed += 1;
      } catch (e) {
        errors.push({ listingId: l.id.uuid, error: e?.message || 'unknown' });
      }
    }
    const totalPages = resp.data.meta?.totalPages || 1;
    if (page >= totalPages) break;
  }

  return { inspected, closed, errors };
};

let intervalHandle = null;

const start = () => {
  if (intervalHandle) return;
  // Primer tick a los 60s de arrancar (deja que el server estabilice).
  setTimeout(() => {
    runTick().catch(e => {
      // eslint-disable-next-line no-console
      console.error('[event-auto-close] first tick failed:', e?.message);
    });
    intervalHandle = setInterval(() => {
      runTick().catch(e => {
        // eslint-disable-next-line no-console
        console.error('[event-auto-close] tick failed:', e?.message);
      });
    }, RUN_EVERY_MS);
  }, 60_000);
  // eslint-disable-next-line no-console
  console.log('[event-auto-close] scheduled every', RUN_EVERY_MS / 60_000, 'min');
};

const stop = () => {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
};

module.exports = { start, stop, runTick };
