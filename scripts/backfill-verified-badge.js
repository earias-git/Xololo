#!/usr/bin/env node
/*
 * XOLOLO Task #22 — backfill del badge Xololo Verified desde CLI.
 *
 * Alternativa a la UI (/ops/backfill-verified) y al cron mensual
 * (server/jobs/verified-badge-sync.js, día 1 UTC). Útil para:
 *   - correrlo on-demand desde la terminal de un operador
 *   - automatizarlo desde un pipeline (deploy, migration)
 *   - debuggear sin pasar por el router HTTP
 *
 * Idempotente: syncVerifiedBadge sólo escribe cuando el estado cambia.
 *
 * Uso:
 *   node scripts/backfill-verified-badge.js              # dry-run
 *   node scripts/backfill-verified-badge.js --apply      # ejecuta writes
 *
 * Variables de entorno requeridas:
 *   SHARETRIBE_INTEGRATION_CLIENT_ID
 *   SHARETRIBE_INTEGRATION_CLIENT_SECRET
 *
 * Output: JSON con estadísticas (misma shape que el endpoint HTTP).
 */

require('dotenv').config();
const { getIntegrationSdk } = require('../server/api-util/integrationSdk');
const {
  computeDryRun,
  executeBackfill,
} = require('../server/api/admin-backfill-verified');

const apply = process.argv.includes('--apply');
const dryRun = !apply;

(async () => {
  const isdk = getIntegrationSdk();
  if (!isdk) {
    // eslint-disable-next-line no-console
    console.error('[backfill-verified] Integration SDK no configurado.');
    // eslint-disable-next-line no-console
    console.error('[backfill-verified] Define SHARETRIBE_INTEGRATION_CLIENT_ID + _CLIENT_SECRET en tu .env');
    process.exit(1);
  }

  const label = dryRun ? 'DRY-RUN' : 'APPLY';
  // eslint-disable-next-line no-console
  console.log(`[backfill-verified] starting ${label}…`);
  try {
    const stats = dryRun ? await computeDryRun(isdk) : await executeBackfill(isdk);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(stats, null, 2));
    if (!dryRun && stats.errorCount > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[backfill-verified] completó con ${stats.errorCount} errores`);
    }
    process.exit(0);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[backfill-verified] fatal: ${e?.message || e}`);
    process.exit(1);
  }
})();
