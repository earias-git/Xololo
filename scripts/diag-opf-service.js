// XOLOLO diag: llama al service de comunidades como lo haría /api/communities/opf
require('dotenv').config();
const svc = require('../server/api-util/communitiesService');

(async () => {
  svc.invalidateCache();
  const t0 = Date.now();
  const r = await svc.getCommunityPayload('opf');
  const t1 = Date.now();
  console.log(`\n=== OPF payload (${t1 - t0} ms) ===`);
  console.log('community:', r?.community?.name, r?.community?.slug);
  console.log('listings count:', r?.listings?.data?.length);
  console.log('included:', r?.listings?.included?.length);
  console.log('meta:', r?.listings?.meta);
  r?.listings?.data?.slice(0, 5).forEach(l => {
    console.log(`  - ${l.id.uuid} | ${l.attributes.title}`);
  });
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
