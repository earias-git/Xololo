#!/usr/bin/env node
/*
 * XOLOLO 2026-11-18 — ADR-006 PR-5: ejecutor CLI del repair del mirror.
 *
 * Uso:
 *   node scripts/communities-mirror-repair.js            # modo dry-run
 *   node scripts/communities-mirror-repair.js --apply    # ejecuta writes
 *
 * Variables de entorno requeridas (ya existen en Render):
 *   SHARETRIBE_INTEGRATION_CLIENT_ID
 *   SHARETRIBE_INTEGRATION_CLIENT_SECRET
 *
 * Ejecutar en Render Cron Job con comando:
 *   node scripts/communities-mirror-repair.js --apply
 * Frecuencia sugerida: diario a las 03:00 America/Mexico_City.
 */

require('dotenv').config();
const { repairMirror } = require('../server/cron/communitiesMirrorRepair');

const apply = process.argv.includes('--apply');
const dryRun = !apply;

(async () => {
  const label = dryRun ? 'DRY-RUN' : 'APPLY';
  console.log(`[mirrorRepair] starting ${label}…`);
  try {
    const stats = await repairMirror({ dryRun });
    console.log(JSON.stringify(stats, null, 2));
    if (dryRun && stats.listingsUpdated > 0) {
      console.log(
        `\n[mirrorRepair] DRY-RUN found ${stats.listingsUpdated} drifts. Re-ejecuta con --apply para corregir.`
      );
    } else if (!dryRun) {
      console.log(
        `\n[mirrorRepair] APPLY done. Updated=${stats.listingsUpdated}, Skipped=${stats.listingsSkipped}, Errors=${stats.errors}.`
      );
    }
    process.exit(stats.errors > 0 ? 2 : 0);
  } catch (e) {
    console.error('[mirrorRepair] fatal:', e.message);
    process.exit(1);
  }
})();
