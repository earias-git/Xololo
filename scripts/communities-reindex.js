#!/usr/bin/env node
/*
 * XOLOLO 2026-11-23 — fuerza re-index del filtro
 * pub_sellerCommunities:has:<id> cuando el índice de Sharetribe quedó
 * stale (listings devueltos por el filtro cuyo mirror actual ya no los
 * incluye). Ver server/cron/communitiesReindex.js para el detalle.
 *
 * Uso:
 *   node scripts/communities-reindex.js                        # dry-run, todas las comunidades
 *   node scripts/communities-reindex.js --apply                # ejecuta writes, todas
 *   node scripts/communities-reindex.js --community opf        # dry-run, sólo OPF
 *   node scripts/communities-reindex.js --community opf --apply
 *
 * Variables de entorno requeridas:
 *   SHARETRIBE_INTEGRATION_CLIENT_ID
 *   SHARETRIBE_INTEGRATION_CLIENT_SECRET
 *
 * Idempotente: tras un run con --apply, el siguiente dry-run debería
 * mostrar `falsePositives: 0` (o un número decreciendo hasta 0).
 */

require('dotenv').config();
const { reindexCommunities } = require('../server/cron/communitiesReindex');

const apply = process.argv.includes('--apply');
const dryRun = !apply;
const commIdx = process.argv.indexOf('--community');
const communityIds = commIdx >= 0 && process.argv[commIdx + 1]
  ? [process.argv[commIdx + 1]]
  : undefined;

(async () => {
  const label = dryRun ? 'DRY-RUN' : 'APPLY';
  const scope = communityIds ? communityIds.join(',') : 'ALL';
  // eslint-disable-next-line no-console
  console.log(`[reindex] starting ${label} on communities=${scope}…`);
  try {
    const stats = await reindexCommunities({ dryRun, communityIds });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(stats, null, 2));
    if (dryRun && stats.totals.falsePositives > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `\n[reindex] DRY-RUN encontró ${stats.totals.falsePositives} falsos positivos. Re-ejecuta con --apply para corregir.`
      );
    } else if (!dryRun) {
      // eslint-disable-next-line no-console
      console.log(
        `\n[reindex] APPLY done. Reindexed=${stats.totals.reindexed}, Errors=${stats.totals.errors}.`
      );
    }
    process.exit(stats.totals.errors > 0 ? 2 : 0);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[reindex] fatal:', e.message);
    process.exit(1);
  }
})();
