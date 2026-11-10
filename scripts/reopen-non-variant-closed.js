#!/usr/bin/env node
/* eslint-disable no-console */
//
// XOLOLO — Reabrir listings cerrados erróneamente por el sync buggy de
// PR 2b (antes de PR 2c). El bug: syncVariantSiblingsThunk cerraba como
// "huérfanos" todos los ownListings del seller que no matcheaban la
// matrix del master. Los listings legítimos sin variantGroupId sufrieron.
//
// Este script reabre TODOS los listings cerrados del autor que:
//   - no tienen publicData.variantGroupId (no son hermanos reales), Y
//   - no estaban explícitamente cerrados por el seller (heurística: se
//     cerraron el mismo día que se publicó el master del grupo, es decir
//     los que se ven "cerrados por el bug").
//
// Uso:
//   node scripts/reopen-non-variant-closed.js --author <uuid>            # DRY RUN
//   node scripts/reopen-non-variant-closed.js --author <uuid> --apply
//   node scripts/reopen-non-variant-closed.js --author <uuid> --apply --all  # reabre todos los closed sin filtro de fecha

require('dotenv').config();
const { getIntegrationSdk } = require('../server/api-util/integrationSdk');

const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes('--apply');
const ALL = ARGS.includes('--all');
const authorIdx = ARGS.indexOf('--author');
const AUTHOR_ID = authorIdx === -1 ? null : ARGS[authorIdx + 1];
if (!AUTHOR_ID) {
  console.error('Falta --author <uuid>');
  process.exit(1);
}

(async () => {
  const sdk = getIntegrationSdk();
  const res = await sdk.listings.query({
    authorId: AUTHOR_ID,
    states: ['closed'],
    perPage: 100,
  });
  const closed = res.data.data || [];
  console.log(`Closed total: ${closed.length}`);

  // Filtra: NO tienen variantGroupId (= no son siblings legítimos).
  const candidates = closed.filter(l => !l.attributes.publicData?.variantGroupId);
  console.log(`Candidatos (sin variantGroupId): ${candidates.length}`);

  let reopened = 0;
  let failed = 0;
  console.log(`\nMode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);
  for (const l of candidates) {
    const title = l.attributes.title;
    console.log(`  ${l.id.uuid} | "${title}"`);
    if (!APPLY) {
      reopened += 1;
      continue;
    }
    try {
      await sdk.listings.open({ id: l.id });
      console.log('    ✓ reopened');
      reopened += 1;
    } catch (e) {
      console.error('    ✗', e.message);
      if (e.data?.errors) console.error('      ', JSON.stringify(e.data.errors));
      failed += 1;
    }
  }
  console.log(`\nResultado: ${APPLY ? 'reopened' : 'would reopen'}=${reopened} failed=${failed}`);
})().catch(e => {
  console.error('ERR:', e.message);
  if (e.data?.errors) console.error(JSON.stringify(e.data.errors, null, 2));
  process.exit(1);
});
