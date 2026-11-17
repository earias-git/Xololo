// XOLOLO 2026-11-17 — diag de bug OPS /ops/tax-reviews: todos los
// items muestran "Oxford bostoniano...". Verifica si los listings
// realmente tienen ese título en Sharetribe o es bug de UI.
//
// Uso:
//   node scripts/diag-tax-reviews.js [--author-email=<email>]
//
// Ejemplo:
//   node scripts/diag-tax-reviews.js --author-email=kikearias1972+secprimario@gmail.com

require('dotenv').config();
const { getIntegrationSdk } = require('../server/api-util/integrationSdk');

const ARGS = process.argv.slice(2);
const emailArg = ARGS.find(a => a.startsWith('--author-email='));
const TARGET_EMAIL = emailArg ? emailArg.split('=')[1] : null;

(async () => {
  const isdk = getIntegrationSdk();
  if (!isdk) {
    console.error('Integration SDK no configurado');
    process.exit(1);
  }

  const seen = [];
  for (let page = 1; page <= 20; page++) {
    const resp = await isdk.listings.query({
      page,
      perPage: 100,
      'fields.listing': ['title', 'publicData', 'price', 'createdAt'],
      include: ['author'],
    });
    const data = resp.data.data || [];
    const inc = resp.data.included || [];
    const userById = new Map(
      inc.filter(i => i.type === 'user').map(u => [u.id.uuid, u])
    );

    for (const l of data) {
      const pd = l.attributes?.publicData || {};
      const tc = pd.taxClassification;
      if (!tc || !tc.code) continue;
      if (tc.reviewStatus === 'approved') continue;

      const authorId = l.relationships?.author?.data?.id?.uuid;
      const author = userById.get(authorId);
      const authorEmail = author?.attributes?.email || '';
      if (TARGET_EMAIL && authorEmail !== TARGET_EMAIL) continue;

      seen.push({
        listingId: l.id.uuid,
        title: l.attributes?.title,
        price: l.attributes?.price?.amount,
        currency: l.attributes?.price?.currency,
        category: pd.categoryLevel1,
        condition: pd.condition,
        taxCode: tc.code,
        createdAt: l.attributes?.createdAt,
        authorEmail,
      });
    }
    const totalPages = resp.data.meta?.totalPages || 1;
    if (page >= totalPages) break;
  }

  console.log(`\nTotal pendientes: ${seen.length}\n`);
  for (const r of seen) {
    console.log(
      `  [${r.listingId.slice(0, 8)}…] "${r.title}" · ${r.currency} ${(r.price || 0) / 100} · ${r.category} · ${r.taxCode} · ${r.authorEmail}`
    );
  }

  // Resumen
  const titleCounts = new Map();
  for (const r of seen) titleCounts.set(r.title, (titleCounts.get(r.title) || 0) + 1);
  console.log('\nTítulos únicos:');
  for (const [title, count] of titleCounts.entries()) {
    console.log(`  ${count}× "${title}"`);
  }
})().catch(e => {
  console.error(e.message);
  process.exit(1);
});
