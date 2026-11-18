// XOLOLO 2026-11-17 — diag del bug "stock del master no sincroniza
// con matrix de variantes". Lee los listings del grupo del traje
// de baño rojo y muestra: variantValues del master, variantValues
// de cada fila del matrix, rowKeys y si coinciden.
//
// Uso:
//   node scripts/diag-variants-sync.js <master-listing-id>
// Ej:
//   node scripts/diag-variants-sync.js 6adbbafd-9dbd-477b-80a5-227f1f049e76

require('dotenv').config();
const { getIntegrationSdk } = require('../server/api-util/integrationSdk');

const MASTER_ID = process.argv[2];
if (!MASTER_ID) {
  console.error('Usage: node scripts/diag-variants-sync.js <master-listing-id>');
  process.exit(1);
}

const rowKey = (axes, variantValues) =>
  axes.map(ax => variantValues?.[ax] ?? '').join('||');

(async () => {
  const isdk = getIntegrationSdk();
  if (!isdk) {
    console.error('no sdk');
    process.exit(1);
  }

  const masterResp = await isdk.listings.show({
    id: MASTER_ID,
    include: ['currentStock'],
  });
  const master = masterResp.data?.data;
  if (!master) {
    console.error('master no encontrado');
    process.exit(1);
  }

  const pd = master.attributes?.publicData || {};
  const axes = pd.variantAxes || [];
  const masterValues = pd.variantValues || {};
  const matrix = pd.variantsMatrix || [];
  const stock = master.currentStock?.attributes?.quantity;

  console.log('=== MASTER ===');
  console.log(`  title: "${master.attributes?.title}"`);
  console.log(`  isVariantMaster: ${pd.isVariantMaster}`);
  console.log(`  variantGroupId: ${pd.variantGroupId}`);
  console.log(`  variantAxes: ${JSON.stringify(axes)}`);
  console.log(`  variantValues: ${JSON.stringify(masterValues)}`);
  console.log(`  publicData.attributes: ${JSON.stringify(pd.attributes || {})}`);
  console.log(`  currentStock.quantity: ${stock}`);
  console.log(`  categoryLevel1: ${pd.categoryLevel1}`);

  const masterKey = rowKey(axes, masterValues);
  console.log(`\n=== MASTER KEY (axes.map) ===`);
  console.log(`  masterKey: "${masterKey}"`);

  console.log(`\n=== MATRIX (${matrix.length} rows) ===`);
  matrix.forEach((row, i) => {
    const k = rowKey(axes, row.variantValues);
    const match = k === masterKey ? ' ← MATCH MASTER' : '';
    console.log(`  [${i}] vv=${JSON.stringify(row.variantValues)} stock=${row.stock}${match}`);
    console.log(`       rowKey: "${k}"`);
  });

  // Query siblings
  const siblingsResp = await isdk.listings.query({
    pub_variantGroupId: pd.variantGroupId,
    perPage: 50,
    include: ['currentStock'],
  });
  const all = siblingsResp.data?.data || [];
  const siblings = all.filter(
    l =>
      l.attributes?.publicData?.variantGroupId === pd.variantGroupId &&
      l.id?.uuid !== MASTER_ID
  );
  console.log(`\n=== SIBLINGS DEL GRUPO (${siblings.length}) ===`);
  siblings.forEach(s => {
    const spd = s.attributes?.publicData || {};
    const sstock = s.currentStock?.attributes?.quantity;
    console.log(
      `  [${s.id.uuid.slice(0, 8)}…] vv=${JSON.stringify(spd.variantValues)} stock=${sstock} title="${s.attributes?.title?.slice(0, 50)}"`
    );
  });
})().catch(e => {
  console.error(e.message);
  process.exit(1);
});
