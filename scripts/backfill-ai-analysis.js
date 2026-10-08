#!/usr/bin/env node
/* eslint-disable no-console */
//
// XOLOLO Fase 2 — scripts/backfill-ai-analysis.js
//
// Analiza con IA los listings publicados que todavía no tienen
// publicData.aiAnalysis. Útil para la primera activación de la feature
// (los listings ya existentes nunca pasaron por el hook post-publish).
//
// Uso:
//   node scripts/backfill-ai-analysis.js                 # DRY RUN
//   node scripts/backfill-ai-analysis.js --apply         # ejecuta
//   node scripts/backfill-ai-analysis.js --apply --force # re-analiza aunque ya tenga
//   node scripts/backfill-ai-analysis.js --apply --listing <uuid>  # solo uno
//   node scripts/backfill-ai-analysis.js --apply --limit 10        # cap de volumen
//
// Requiere en el entorno:
//   SHARETRIBE_INTEGRATION_CLIENT_ID / _SECRET
//   ANTHROPIC_API_KEY

try {
  require('dotenv').config();
} catch (_) {}

const { getIntegrationSdk } = require('../server/api-util/integrationSdk');
const { analyzeListing } = require('../server/api-util/listingAiAnalysis');
const { isConfigured } = require('../server/api-util/aiClient');

const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes('--apply');
const FORCE = ARGS.includes('--force');
const LISTING_IDX = ARGS.indexOf('--listing');
const LIMIT_IDX = ARGS.indexOf('--limit');
const ONLY_LISTING = LISTING_IDX > -1 ? ARGS[LISTING_IDX + 1] : null;
const LIMIT = LIMIT_IDX > -1 ? parseInt(ARGS[LIMIT_IDX + 1], 10) : Infinity;

const estimateCostUsd = count => {
  // ~$0.0023 por imagen con Claude Haiku 5.5. Asumimos ~3 fotos/listing.
  return (count * 3 * 0.0023).toFixed(2);
};

const main = async () => {
  if (!isConfigured()) {
    console.error('ERROR: ANTHROPIC_API_KEY no configurada en env.');
    process.exit(1);
  }
  const sdk = getIntegrationSdk();
  if (!sdk) {
    console.error('ERROR: Integration SDK no configurado.');
    process.exit(1);
  }

  console.log(`\n=== Backfill AI analysis ${APPLY ? '(APLICANDO)' : '(DRY RUN)'} ===\n`);

  // 1. Decidir el conjunto de listings a procesar.
  let listingsToConsider = [];
  if (ONLY_LISTING) {
    const r = await sdk.listings.show({ id: ONLY_LISTING });
    listingsToConsider = [r.data.data];
  } else {
    // Pagina todos los listings PUBLICADOS.
    let page = 1;
    let totalPages = 1;
    do {
      const r = await sdk.listings.query({
        perPage: 100,
        page,
        states: ['published'],
      });
      listingsToConsider.push(...(r.data.data || []));
      totalPages = r.data.meta?.totalPages || 1;
      page += 1;
    } while (page <= totalPages && listingsToConsider.length < LIMIT * 2);
  }

  // 2. Filtrar los que ya tienen aiAnalysis (a menos que --force).
  const needsAnalysis = listingsToConsider.filter(l => {
    if (FORCE) return true;
    const pd = l.attributes.publicData || {};
    return !pd.aiAnalysis;
  });

  const toProcess = needsAnalysis.slice(0, LIMIT);

  console.log(`Listings publicados escaneados: ${listingsToConsider.length}`);
  console.log(`Listings sin análisis (o --force): ${needsAnalysis.length}`);
  console.log(`Procesables en esta corrida (--limit=${LIMIT === Infinity ? '∞' : LIMIT}): ${toProcess.length}`);
  console.log(`Costo estimado: ~$${estimateCostUsd(toProcess.length)} USD (asumiendo ~3 fotos/listing)`);

  if (toProcess.length > 0 && !APPLY) {
    console.log('\n--- Listings que se analizarían ---');
    toProcess.forEach(l => {
      console.log(`  - ${l.id.uuid}  "${l.attributes.title}"`);
    });
  }

  if (!APPLY) {
    console.log('\nDRY RUN: nada se envió a Claude. Vuelve a correr con --apply.');
    return;
  }

  if (toProcess.length === 0) {
    console.log('\nNada que hacer. Fin.');
    return;
  }

  // 3. Correr secuencialmente para evitar rate limit + hacer logs legibles.
  console.log(`\n--- Procesando ---`);
  let ok = 0, failed = 0, blocked = 0, flagged = 0;
  for (let i = 0; i < toProcess.length; i += 1) {
    const l = toProcess[i];
    const progress = `[${i + 1}/${toProcess.length}]`;
    try {
      const result = await analyzeListing({ listingId: l.id.uuid, force: FORCE });
      ok += 1;
      const mod = result.aggregated.moderation.status;
      if (mod === 'block') blocked += 1;
      if (mod === 'warn') flagged += 1;
      const tags = result.aggregated.tags;
      const topTags = [
        ...(tags.objects || []).slice(0, 3),
        ...(tags.keywords || []).slice(0, 3),
      ].join(', ');
      console.log(
        `  ${progress} ✓ ${l.attributes.title}  mod=${mod} ` +
          `imgs=${result.newlyAnalyzedCount}/${result.totalImageCount} ` +
          `tags=[${topTags}] action=${result.moderationAction}`
      );
    } catch (err) {
      failed += 1;
      console.error(`  ${progress} ✗ ${l.attributes.title}  ${err?.message}`);
    }
  }

  console.log(`\n--- Resumen ---`);
  console.log(`  OK:         ${ok}`);
  console.log(`  Fallidos:   ${failed}`);
  console.log(`  Flagged:    ${flagged} (operador debe revisar)`);
  console.log(`  Bloqueados: ${blocked} (listings cerrados automáticamente)`);
};

main().catch(err => {
  console.error('ERROR fatal:', err);
  process.exit(1);
});
