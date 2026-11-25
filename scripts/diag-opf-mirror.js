#!/usr/bin/env node
// XOLOLO diag: cuántos listings tienen 'opf' en su mirror sellerCommunities
// y cuántos devuelve el filtro :has:opf (para verificar lag de Sharetribe).
require('dotenv').config();
const { getIntegrationSdk } = require('../server/api-util/integrationSdk');

(async () => {
  const sdk = getIntegrationSdk();

  // (1) :has:opf filter
  const hasResp = await sdk.listings.query({
    pub_sellerCommunities: 'has:opf',
    perPage: 100,
    page: 1,
  });
  const hasCount = hasResp.data.data.length;
  const hasMeta = hasResp.data.meta || {};

  // (2) full scan published → cuántos tienen opf en mirror
  let page = 1;
  const PER_PAGE = 100;
  let scanned = 0;
  const opfInMirror = [];
  for (;;) {
    const r = await sdk.listings.query({ perPage: PER_PAGE, page, states: 'published' });
    const data = r.data.data || [];
    if (!data.length) break;
    scanned += data.length;
    for (const l of data) {
      const pd = l.attributes?.publicData || {};
      if (Array.isArray(pd.sellerCommunities) && pd.sellerCommunities.includes('opf')) {
        opfInMirror.push({ id: l.id.uuid, title: l.attributes.title });
      }
    }
    if (data.length < PER_PAGE) break;
    page++;
    if (page > 30) break;
  }

  console.log('=== :has:opf filter (Sharetribe index) ===');
  console.log('devueltos page 1:', hasCount);
  console.log('meta:', JSON.stringify(hasMeta));
  console.log('');
  console.log('=== mirror scan (publicData.sellerCommunities incluye "opf") ===');
  console.log('listings scanned:', scanned);
  console.log('listings con opf en mirror:', opfInMirror.length);
  opfInMirror.slice(0, 5).forEach(l => console.log(`  - ${l.id} | ${l.title}`));
})().catch(e => {
  console.error('ERR:', e.message);
  if (e.data) console.error(JSON.stringify(e.data, null, 2));
  process.exit(1);
});
