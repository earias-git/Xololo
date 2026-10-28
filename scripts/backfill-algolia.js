#!/usr/bin/env node
/* eslint-disable no-console */
//
// XOLOLO Fase 2 — Backfill Algolia.
//
// Indexa todos los listings de Sharetribe en Algolia. También aplica
// la configuración del índice (searchableAttributes, facets, etc).
//
// Uso:
//   node scripts/backfill-algolia.js            # DRY RUN
//   node scripts/backfill-algolia.js --apply    # ejecuta
//   node scripts/backfill-algolia.js --apply --states published,closed  # subset
//   node scripts/backfill-algolia.js --apply --configure-only   # solo settings
//   node scripts/backfill-algolia.js --apply --wipe             # borra todo primero

try {
  require('dotenv').config();
} catch (_) {}

const { getIntegrationSdk } = require('../server/api-util/integrationSdk');
const {
  isConfigured,
  configureIndex,
  saveDocumentsBatch,
  getIndexName,
} = require('../server/api-util/algoliaClient');
const { listingToAlgoliaDoc } = require('../server/api-util/listingIndexer');

const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes('--apply');
const CONFIGURE_ONLY = ARGS.includes('--configure-only');
const WIPE = ARGS.includes('--wipe');

const parseList = flag => {
  const i = ARGS.indexOf(flag);
  if (i === -1) return null;
  const v = ARGS[i + 1];
  return v
    ? v
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    : null;
};

const STATES = parseList('--states') || ['published'];

const BATCH_SIZE = 50;

const main = async () => {
  if (!isConfigured()) {
    console.error('ERROR: ALGOLIA_APP_ID / ALGOLIA_ADMIN_API_KEY faltan en el entorno.');
    process.exit(1);
  }
  const sdk = getIntegrationSdk();
  if (!sdk) {
    console.error('ERROR: Integration SDK no configurado.');
    process.exit(1);
  }

  console.log(`\n=== Backfill Algolia ${APPLY ? '(APLICANDO)' : '(DRY RUN)'} ===`);
  console.log(`Índice: ${getIndexName()}`);
  console.log(`Estados a indexar: ${STATES.join(', ')}\n`);

  if (APPLY) {
    console.log('→ Aplicando configuración del índice...');
    await configureIndex();
    console.log('  ✓ searchableAttributes, facets y custom ranking aplicados.\n');
  } else {
    console.log(
      '(se aplicaría la configuración del índice: searchableAttributes, facets, custom ranking)\n'
    );
  }

  if (CONFIGURE_ONLY) {
    console.log('Modo --configure-only. Fin.');
    return;
  }

  if (WIPE && APPLY) {
    console.log('→ --wipe: borrando TODOS los documentos del índice...');
    const { getIndexName: idx } = require('../server/api-util/algoliaClient');
    const client = require('algoliasearch').algoliasearch(
      process.env.ALGOLIA_APP_ID,
      process.env.ALGOLIA_ADMIN_API_KEY
    );
    await client.clearObjects({ indexName: idx() });
    console.log('  ✓ índice vaciado.\n');
  }

  // Paginar sobre todos los listings con los estados pedidos.
  let page = 1;
  let totalPages = 1;
  let allDocs = [];
  let totalListings = 0;
  do {
    const r = await sdk.listings.query({
      perPage: 100,
      page,
      states: STATES,
      include: ['author', 'images'],
      'fields.image': [
        'variants.listing-card',
        'variants.listing-card-2x',
        'variants.scaled-medium',
      ],
    });
    const listings = r.data.data || [];
    const included = r.data.included || [];
    totalListings += listings.length;
    for (const l of listings) {
      try {
        allDocs.push(listingToAlgoliaDoc(l, included));
      } catch (e) {
        console.error(`  ! No se pudo convertir ${l.id?.uuid}:`, e.message);
      }
    }
    totalPages = r.data.meta?.totalPages || 1;
    console.log(`  Página ${page}/${totalPages}: ${listings.length} listings`);
    page += 1;
  } while (page <= totalPages);

  console.log(`\nTotal listings escaneados: ${totalListings}`);
  console.log(`Documentos a indexar: ${allDocs.length}`);
  console.log(`Batches de ${BATCH_SIZE}: ${Math.ceil(allDocs.length / BATCH_SIZE)}\n`);

  if (allDocs.length > 0 && !APPLY) {
    console.log('--- Preview de los primeros 3 documentos ---');
    allDocs.slice(0, 3).forEach(d => {
      const tagsSummary = [
        `objects=${d.aiTags.objects.length}`,
        `keywords=${d.aiTags.keywords.length}`,
      ].join(' ');
      console.log(
        `  ${d.objectID}  "${d.title}"  cat=${d.category || '-'} mod=${d.moderation} ${tagsSummary}`
      );
    });
    console.log('\nDRY RUN: nada se envió a Algolia. Vuelve a correr con --apply.');
    return;
  }

  if (allDocs.length === 0) {
    console.log('Nada que indexar. Fin.');
    return;
  }

  // Enviar en batches para respetar límites y ver progreso.
  console.log('--- Enviando a Algolia ---');
  let indexed = 0;
  for (let i = 0; i < allDocs.length; i += BATCH_SIZE) {
    const chunk = allDocs.slice(i, i + BATCH_SIZE);
    try {
      await saveDocumentsBatch(chunk);
      indexed += chunk.length;
      console.log(`  ✓ batch ${Math.floor(i / BATCH_SIZE) + 1}  (${indexed}/${allDocs.length})`);
    } catch (err) {
      console.error(`  ✗ batch ${Math.floor(i / BATCH_SIZE) + 1} FAILED:`, err.message);
    }
  }

  console.log(`\n✓ ${indexed}/${allDocs.length} documentos indexados.`);
  console.log(`\nValida en https://dashboard.algolia.com → tu índice "${getIndexName()}"`);
};

main().catch(err => {
  console.error('ERROR fatal:', err);
  process.exit(1);
});
