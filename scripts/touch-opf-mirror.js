#!/usr/bin/env node
// XOLOLO 2026-11-25 — Touch (re-write idempotente) de listings que tienen
// 'opf' en publicData.sellerCommunities para forzar que Sharetribe los
// reindexe bajo el schema `sellerCommunities` recién registrado en Console.
//
// Uso:
//   node scripts/touch-opf-mirror.js             # dry-run
//   node scripts/touch-opf-mirror.js --apply     # ejecuta writes
require('dotenv').config();
const { getIntegrationSdk } = require('../server/api-util/integrationSdk');

const apply = process.argv.includes('--apply');

(async () => {
  const sdk = getIntegrationSdk();
  const touched = [];
  let page = 1;
  const PER_PAGE = 100;
  for (;;) {
    const r = await sdk.listings.query({ perPage: PER_PAGE, page });
    const data = r.data.data || [];
    if (!data.length) break;
    for (const l of data) {
      const pd = l.attributes?.publicData || {};
      if (!Array.isArray(pd.sellerCommunities) || !pd.sellerCommunities.includes('opf')) continue;
      const id = l.id.uuid;
      const title = l.attributes.title;
      if (apply) {
        try {
          await sdk.listings.update({
            id,
            publicData: { sellerCommunities: pd.sellerCommunities },
          });
          touched.push({ id, title, status: 'ok' });
          console.log(`[touch] OK  ${id} | ${title}`);
        } catch (e) {
          touched.push({ id, title, status: 'err', err: e.message });
          console.error(`[touch] ERR ${id} | ${title} | ${e.message}`);
        }
      } else {
        touched.push({ id, title, status: 'dry' });
        console.log(`[dry]  WOULD TOUCH ${id} | ${title} | sc=${JSON.stringify(pd.sellerCommunities)}`);
      }
    }
    if (data.length < PER_PAGE) break;
    page++;
    if (page > 30) break;
  }
  console.log('');
  console.log(`total: ${touched.length} | mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  if (!apply && touched.length) {
    console.log('\nRun again with --apply to force reindex.');
  }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
