#!/usr/bin/env node
/* eslint-disable no-console */
require('dotenv').config();
const { getIntegrationSdk } = require('../server/api-util/integrationSdk');

const MASTER_ID = '6af2188d-3dea-406c-9cc9-7b8c8c69e1a4';

(async () => {
  const sdk = getIntegrationSdk();

  // 1. Autor del master.
  const mres = await sdk.listings.show({
    id: MASTER_ID,
    include: ['author'],
  });
  const authorId = mres.data.data.relationships.author.data.id.uuid;
  console.log('Author:', authorId);

  // 2. Query TODOS los listings del autor (incluye closed, draft, pending).
  const res = await sdk.listings.query({
    authorId,
    states: ['published', 'closed', 'pendingApproval', 'draft'],
    perPage: 100,
  });
  const listings = res.data.data || [];
  console.log(`\nTotal del autor: ${listings.length}`);

  // 3. Clasifica.
  const byState = {};
  for (const l of listings) {
    const state = l.attributes.state;
    byState[state] = byState[state] || [];
    byState[state].push(l);
  }
  for (const [state, list] of Object.entries(byState)) {
    console.log(`  ${state}: ${list.length}`);
  }

  // 4. Lista los CLOSED con su timestamp de last update.
  console.log('\n=== CLOSED listings (orden por fecha, más reciente arriba) ===');
  const closed = (byState.closed || [])
    .map(l => ({ l, ts: new Date(l.attributes.createdAt).getTime() }))
    .sort((a, b) => b.ts - a.ts);
  for (const { l } of closed) {
    const pd = l.attributes.publicData || {};
    const hasGroup = pd.variantGroupId ? `group=${pd.variantGroupId.slice(0, 8)}` : '';
    console.log(
      `  ${l.id.uuid} | state=closed | created=${l.attributes.createdAt} | "${l.attributes.title}" ${hasGroup}`
    );
  }
})().catch(e => {
  console.error('ERR:', e.message);
  if (e.data?.errors) console.error(JSON.stringify(e.data.errors, null, 2));
  process.exit(1);
});
