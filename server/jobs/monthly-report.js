// XOLOLO F3 · Sprint 6B: cron que envía el reporte mensual a cada
// seller con ≥1 venta en el mes anterior.
//
// Diseño:
//   - Corre cada hora (setInterval). En cada tick verifica si hoy es
//     día 1 del mes en zona CDMX y si ya se envió este mes; si no,
//     dispara el batch.
//   - Batch: itera sellers activos (que tengan ownListings publicados)
//     y les genera el reporte del mes previo si tuvieron ≥1 venta.
//   - Gated por env MONTHLY_REPORT_ENABLED=true para no bombardear
//     en dev/staging.
//   - Fire-and-forget por seller: si un email falla, los demás se
//     mandan igual (Promise.allSettled).
//
// Ver server/api-util/monthlyReport.js para el helper que arma el
// context de cada seller.

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { sendEventNotifications } = require('../api-util/notifications');
const { buildMonthlyReportForSeller } = require('../api-util/monthlyReport');

const RUN_EVERY_MS = 60 * 60 * 1000; // 1h
const CDMX_UTC_OFFSET_HOURS = -6; // sin DST — CDMX es UTC-6 estable en 2026

// Estado en memoria: última fecha (YYYY-MM) en que corrimos el batch.
// Se resetea al reinicio del server — en el peor caso enviamos 2 veces
// el mismo mes si el server se reinició entre día 1 y día 2 (edge
// case aceptable).
let lastRunMonth = null;

// Devuelve 'YYYY-MM' del mes actual en CDMX (no UTC).
const currentMonthCdmx = () => {
  const now = new Date();
  const cdmx = new Date(now.getTime() + CDMX_UTC_OFFSET_HOURS * 60 * 60 * 1000);
  const y = cdmx.getUTCFullYear();
  const m = String(cdmx.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

const isDayOneCdmx = () => {
  const now = new Date();
  const cdmx = new Date(now.getTime() + CDMX_UTC_OFFSET_HOURS * 60 * 60 * 1000);
  return cdmx.getUTCDate() === 1;
};

// Trae sellers activos (los que han publicado al menos un listing).
// Usa listings.query con perPage grande y agrupa por authorId.
const fetchActiveSellers = async isdk => {
  const authors = new Map();
  for (let page = 1; page <= 20; page++) {
    const resp = await isdk.listings.query({
      states: ['published'],
      page,
      perPage: 100,
      include: ['author'],
      'fields.listing': ['title'],
      'fields.user': ['profile.displayName'],
    });
    const data = resp.data.data || [];
    for (const l of data) {
      const authorId = l.relationships?.author?.data?.id?.uuid;
      if (authorId) authors.set(authorId, true);
    }
    const totalPages = resp.data.meta?.totalPages || 1;
    if (page >= totalPages) break;
  }
  return Array.from(authors.keys());
};

// Ejecuta un batch: para cada seller activo, si tuvo ≥1 venta el mes
// previo → dispara el email.
const runBatch = async ({ year, month, dryRun = false }) => {
  const isdk = getIntegrationSdk();
  if (!isdk) {
    return { skipped: 'integration_api_not_configured' };
  }

  let sellers = [];
  try {
    sellers = await fetchActiveSellers(isdk);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[monthly-report] fetchActiveSellers falló:', e?.message);
    return { skipped: 'sellers_fetch_failed' };
  }

  const results = { sent: 0, skipped: 0, failed: 0, sellers: sellers.length };

  const jobs = sellers.map(async sellerId => {
    try {
      const ctx = await buildMonthlyReportForSeller(isdk, sellerId, { year, month });
      const count = Number(ctx.report?.count) || 0;
      if (count === 0) {
        results.skipped += 1;
        return;
      }
      if (dryRun) {
        results.sent += 1;
        return;
      }
      await sendEventNotifications('seller.monthly_report', ctx);
      results.sent += 1;
    } catch (e) {
      results.failed += 1;
      // eslint-disable-next-line no-console
      console.warn(`[monthly-report] seller ${sellerId} falló:`, e?.message);
    }
  });

  await Promise.allSettled(jobs);
  return results;
};

let intervalHandle = null;

const start = () => {
  if (intervalHandle) return;
  if (process.env.MONTHLY_REPORT_ENABLED !== 'true') {
    // eslint-disable-next-line no-console
    console.log('[monthly-report] disabled (set MONTHLY_REPORT_ENABLED=true to enable)');
    return;
  }

  const tick = async () => {
    try {
      const monthKey = currentMonthCdmx();
      if (!isDayOneCdmx()) return; // solo día 1
      if (lastRunMonth === monthKey) return; // ya lo hicimos este mes

      // Reporte del mes ANTERIOR al actual.
      const [y, m] = monthKey.split('-').map(Number);
      const prevMonth = m - 2 >= 0 ? { year: y, month: m - 2 } : { year: y - 1, month: 11 };
      // (nota: monthKey 'YYYY-MM' con m 1-based → m-1 sería este mes,
      // m-2 es el previo. Ej: monthKey='2026-09' → m=9 → month=7 → agosto)

      // eslint-disable-next-line no-console
      console.log(`[monthly-report] tick — enviando reporte de ${prevMonth.year}-${prevMonth.month + 1}`);
      const r = await runBatch(prevMonth);
      // eslint-disable-next-line no-console
      console.log('[monthly-report] batch:', r);
      lastRunMonth = monthKey;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[monthly-report] tick error:', e?.message);
    }
  };

  // Primer tick a los 5 min de arrancado.
  setTimeout(() => {
    tick();
    intervalHandle = setInterval(tick, RUN_EVERY_MS);
  }, 5 * 60 * 1000);
};

const stop = () => {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
};

module.exports = { start, stop, runBatch };
