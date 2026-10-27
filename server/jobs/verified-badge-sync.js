// XOLOLO Task #22: cron que re-sincroniza el badge Xololo Verified en
// todos los sellers una vez por mes.
//
// Por qué:
//   - syncVerifiedBadge se llama desde los call sites conocidos
//     (upload-legal-doc, admin-legal-docs, webhook Stripe billing),
//     pero puede haber estado que cambie sin disparar un sync (ej. el
//     Stripe webhook no llegó, el seller cambió metadata por fuera,
//     drift histórico).
//   - Correr el backfill 1 vez al mes garantiza que el badge nunca
//     esté desactualizado > 30 días.
//
// Scheduler: simple setInterval cada 24h. En cada tick verifica si
// hoy es el día 1 del mes y, si es, corre el barrido. Idempotente —
// syncVerifiedBadge no escribe si el estado no cambió.
//
// Alternativa manual: /ops/backfill-verified (hace lo mismo on-demand).

const CHECK_EVERY_MS = 24 * 60 * 60 * 1000; // 24h
const RUN_ON_DAY_OF_MONTH = 1; // día 1 de cada mes

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { syncVerifiedBadge } = require('../api-util/sellerVerified');

const MAX_PAGES = 50;
const PER_PAGE = 100;

const fetchAllSellerIds = async isdk => {
  const ids = new Set();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const resp = await isdk.listings.query({
      page,
      perPage: PER_PAGE,
      include: ['author'],
      'fields.listing': ['state'],
    });
    const included = resp.data.included || [];
    for (const inc of included) {
      if (inc.type === 'user') ids.add(inc.id.uuid);
    }
    const totalPages = resp.data.meta?.totalPages || 1;
    if (page >= totalPages) break;
  }
  return [...ids];
};

const runOnce = async () => {
  const isdk = getIntegrationSdk();
  if (!isdk) {
    // eslint-disable-next-line no-console
    console.warn('[verified-badge-sync] Integration SDK no configurado, skip');
    return;
  }
  const startedAt = Date.now();
  let total = 0;
  let changed = 0;
  let errors = 0;
  try {
    const sellerIds = await fetchAllSellerIds(isdk);
    total = sellerIds.length;
    for (const sellerId of sellerIds) {
      try {
        const result = await syncVerifiedBadge({ isdk, sellerId });
        if (result?.changed) changed += 1;
      } catch (_) {
        errors += 1;
      }
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[verified-badge-sync] fatal:', e?.message);
  }
  const elapsedMs = Date.now() - startedAt;
  // eslint-disable-next-line no-console
  console.log(
    `[verified-badge-sync] done total=${total} changed=${changed} errors=${errors} elapsedMs=${elapsedMs}`
  );
};

let intervalHandle = null;

const tick = async () => {
  const dom = new Date().getUTCDate();
  if (dom !== RUN_ON_DAY_OF_MONTH) return;
  // eslint-disable-next-line no-console
  console.log('[verified-badge-sync] firing monthly tick');
  await runOnce();
};

const start = () => {
  if (intervalHandle) return; // idempotente
  // Primer tick con delay para no colisionar con otros jobs al boot.
  setTimeout(tick, 60 * 1000);
  intervalHandle = setInterval(tick, CHECK_EVERY_MS);
};

const stop = () => {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
};

module.exports = { start, stop, runOnce };
