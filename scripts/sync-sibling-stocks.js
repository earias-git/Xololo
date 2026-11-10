// XOLOLO 2026-11-10 — Solo-stock sync de siblings existentes.
//
// Lee master.publicData.variantsMatrix y ajusta stock de siblings
// existentes al valor del matrix. NO crea siblings nuevos y NO
// cierra orphans (eso lo hace resync-variants.js con images.upload,
// que a veces se cuelga). Aquí el objetivo es solo "arreglar lo que
// buyers están comprando con stock fantasma".
//
// Uso:
//   node scripts/sync-sibling-stocks.js --master <uuid>          # dry-run
//   node scripts/sync-sibling-stocks.js --master <uuid> --apply

require('dotenv').config();
const { getIntegrationSdk } = require('../server/api-util/integrationSdk');

const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes('--apply');
const masterIdx = ARGS.indexOf('--master');
const MASTER_ID = masterIdx === -1 ? null : ARGS[masterIdx + 1];
if (!MASTER_ID) {
  console.error('Falta --master <uuid>');
  process.exit(1);
}

const rowKey = (axes, vv) => axes.map(a => vv?.[a] ?? '').join('||');

(async () => {
  const sdk = getIntegrationSdk();

  const mres = await sdk.listings.show({ id: MASTER_ID, include: ['currentStock'] });
  const master = mres.data.data;
  const mPd = master.attributes.publicData;
  const mIncluded = mres.data.included || [];
  const mStockRel = master.relationships?.currentStock?.data;
  const mStockEntity = mStockRel
    ? mIncluded.find(i => i.type === 'stock' && i.id?.uuid === mStockRel.id?.uuid)
    : null;

  const axes = mPd.variantAxes || [];
  const matrix = mPd.variantsMatrix || [];
  const groupId = mPd.variantGroupId;
  console.log(`Master: ${master.attributes.title}`);
  console.log(`  mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`  axes: ${axes.join(', ')}`);

  const sibRes = await sdk.listings.query({
    pub_variantGroupId: groupId,
    include: ['currentStock'],
    perPage: 100,
  });
  const sibIncluded = sibRes.data.included || [];
  const siblings = (sibRes.data.data || [])
    .filter(l => l.attributes?.publicData?.variantGroupId === groupId)
    .map(l => {
      const rel = l.relationships?.currentStock?.data;
      if (rel) {
        l.currentStock = sibIncluded.find(
          i => i.type === 'stock' && i.id?.uuid === rel.id?.uuid
        );
      }
      return l;
    })
    .filter(l => l.id.uuid !== MASTER_ID);

  console.log(`  siblings encontrados: ${siblings.length}\n`);

  let updated = 0,
    failed = 0,
    noChange = 0,
    noSibling = 0;

  // Master stock (si hay fila del master en matrix)
  const masterKey = rowKey(axes, mPd.variantValues);
  const masterRow = matrix.find(r => rowKey(axes, r?.variantValues) === masterKey);
  if (masterRow && typeof masterRow.stock === 'number') {
    const cur = mStockEntity?.attributes?.quantity;
    if (masterRow.stock !== cur) {
      const label = Object.values(mPd.variantValues || {}).join(' · ');
      console.log(`[master] ${label}: ${cur} → ${masterRow.stock}`);
      if (APPLY) {
        try {
          await sdk.stock.compareAndSet({
            listingId: master.id,
            oldTotal: typeof cur === 'number' ? cur : null,
            newTotal: masterRow.stock,
          });
          updated += 1;
        } catch (e) {
          console.error('  ✗', e.message);
          failed += 1;
        }
      }
    } else {
      noChange += 1;
    }
  }

  // Siblings
  for (const row of matrix) {
    const key = rowKey(axes, row.variantValues);
    if (key === masterKey) continue; // ya tratado
    const label = Object.values(row.variantValues || {}).join(' · ');
    const sib = siblings.find(
      l => rowKey(axes, l.attributes?.publicData?.variantValues) === key
    );
    if (!sib) {
      console.log(`[${label}] NO EXISTE sibling (necesita CREATE, usar resync-variants.js)`);
      noSibling += 1;
      continue;
    }
    const cur = sib.currentStock?.attributes?.quantity;
    if (typeof row.stock !== 'number') continue;
    if (row.stock === cur) {
      noChange += 1;
      continue;
    }
    console.log(`[${label}] ${cur} → ${row.stock}`);
    if (APPLY) {
      try {
        await sdk.stock.compareAndSet({
          listingId: sib.id,
          oldTotal: typeof cur === 'number' ? cur : null,
          newTotal: row.stock,
        });
        updated += 1;
      } catch (e) {
        console.error('  ✗', e.message);
        failed += 1;
      }
    }
  }

  console.log(
    `\nResultado: updated=${updated} noChange=${noChange} noSibling=${noSibling} failed=${failed}`
  );
})().catch(e => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
