// XOLOLO 2026-11-10 — Migración puntual del master Chamarra.
//
// Problema: el master (listingId 6af2188d-3dea-406c-9cc9-7b8c8c69e1a4)
// tiene publicData.attributes = {talla:'M', color:['Verde']} (el producto
// canónico) pero publicData.variantValues = {talla:'S', color:'Blanco'}
// (tomado por bug del row[0] del matrix). Además la fila M/Verde nunca
// se incluyó en el matrix.
//
// Fix (solo este script): parchar publicData del master.
//   1. master.publicData.variantValues = {talla:'M', color:'Verde'}
//   2. Prepend a master.publicData.variantsMatrix una fila M/Verde
//      con el stock actual del master (100) — para que ListingPage
//      muestre la pill del master y resync-variants.js sepa que es
//      la fila del master.
//
// Después de correr este script con --apply, correr resync-variants.js
// para crear el sibling S/Blanco faltante (ya tiene la lógica de
// descarga/re-upload de imágenes):
//
//   node scripts/resync-variants.js --master 6af2188d-3dea-406c-9cc9-7b8c8c69e1a4 --apply
//
// Uso:
//   node scripts/fix-chamarra-master.js          # dry-run
//   node scripts/fix-chamarra-master.js --apply  # aplica

require('dotenv').config();
const { getIntegrationSdk } = require('../server/api-util/integrationSdk');

const MASTER_ID = '6af2188d-3dea-406c-9cc9-7b8c8c69e1a4';
const APPLY = process.argv.includes('--apply');

(async () => {
  const sdk = getIntegrationSdk();
  const r = await sdk.listings.show({ id: MASTER_ID, include: ['currentStock', 'author'] });
  const master = r.data.data;
  const pd = master.attributes.publicData;

  console.log('MASTER:', master.id.uuid, '-', master.attributes.title);
  console.log('author:', master.relationships.author.data.id.uuid);
  console.log('attributes.talla:', pd.attributes?.talla);
  console.log('attributes.color:', JSON.stringify(pd.attributes?.color));
  console.log('variantValues (actual, WRONG):', JSON.stringify(pd.variantValues));
  console.log('variantAxes:', JSON.stringify(pd.variantAxes));
  console.log('matrix rows actual:', pd.variantsMatrix?.length);

  // --- Fix 1: variantValues del master ---
  const correctMasterValues = { talla: 'M', color: 'Verde' };

  // --- Fix 2: prepend M/Verde a la matrix (si no existe ya) ---
  const existingMatrix = Array.isArray(pd.variantsMatrix) ? pd.variantsMatrix : [];
  const hasMasterRow = existingMatrix.some(
    row =>
      row?.variantValues?.talla === 'M' &&
      row?.variantValues?.color === 'Verde'
  );
  let newMatrix;
  if (hasMasterRow) {
    newMatrix = existingMatrix;
    console.log('\n→ Fila M/Verde ya existe en matrix, sin cambios.');
  } else {
    newMatrix = [
      { variantValues: correctMasterValues, stock: 100, priceOverride: null },
      ...existingMatrix,
    ];
    console.log('\n→ Prepending fila M/Verde a matrix (stock=100).');
  }

  if (!APPLY) {
    console.log('\n[DRY-RUN] Re-ejecuta con --apply para aplicar.');
    console.log('Después del --apply, corre:');
    console.log('  node scripts/resync-variants.js --master ' + MASTER_ID + ' --apply');
    return;
  }

  // ---- APPLY ----
  console.log('\n[APPLY] Actualizando master.publicData.variantValues + matrix...');
  await sdk.listings.update({
    id: MASTER_ID,
    publicData: {
      variantValues: correctMasterValues,
      variantsMatrix: newMatrix,
    },
  });
  console.log('  ✓ master actualizado.');
  console.log('\nSiguiente paso: crear sibling S/Blanco con resync-variants.js:');
  console.log('  node scripts/resync-variants.js --master ' + MASTER_ID + ' --apply');
  console.log('\n✅ Migración de publicData completada.');
})().catch(e => {
  console.error('ERROR:', e.message);
  if (e.data) console.error(JSON.stringify(e.data, null, 2));
  process.exit(1);
});
