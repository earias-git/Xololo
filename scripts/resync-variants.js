#!/usr/bin/env node
/* eslint-disable no-console */
//
// XOLOLO — Resync de siblings para un master de grupo de variantes.
//
// Se usa cuando el seller guardó la pestaña Variantes pero el chain
// client-side falló silenciosamente (PR 2c arregla el bug para futuros).
// Este script crea los siblings faltantes contra Sharetribe via
// Integration SDK, respetando la variantsMatrix ya guardada en el master.
//
// Uso:
//   node scripts/resync-variants.js --master <uuid>        # DRY RUN
//   node scripts/resync-variants.js --master <uuid> --apply
//
// Flujo (idempotente):
//   1. Lee master → variantAxes + variantsMatrix.
//   2. Query hermanos del grupo (filtro client-side).
//   3. Row 0 del matrix = master: ajusta stock si difiere.
//   4. Rows 1..N:
//      - Existe sibling con mismos variantValues → update stock/price.
//      - No existe → crea sibling (published) con las mismas imágenes,
//        descripción, categoría, etc. + stock.
//   5. Siblings huérfanos (publicados con variantValues no en matrix)
//      → cerrar (close).

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

  // 1. Lee el master.
  const mres = await sdk.listings.show({
    id: MASTER_ID,
    include: ['author', 'images', 'currentStock'],
  });
  const master = mres.data.data;
  const mAttrs = master.attributes;
  const mPd = mAttrs.publicData;
  if (!mPd.variantGroupId) {
    console.error('El listing no es parte de un grupo.');
    process.exit(1);
  }
  if (!mPd.isVariantMaster) {
    console.error('El listing NO es master del grupo.');
    process.exit(1);
  }
  const axes = mPd.variantAxes || [];
  const matrix = mPd.variantsMatrix || [];
  if (matrix.length === 0) {
    console.error('El master no tiene variantsMatrix guardado.');
    process.exit(1);
  }

  const groupId = mPd.variantGroupId;
  const authorId = master.relationships.author.data.id;
  const masterImages = (master.relationships.images.data || []).map(i => i.id);

  console.log(`\n=== Master: ${mAttrs.title} ===`);
  console.log(`  groupId: ${groupId}`);
  console.log(`  axes: ${axes.join(', ')}`);
  console.log(`  matrix rows: ${matrix.length}`);
  console.log(`  images: ${masterImages.length}`);
  console.log(`  mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  // 2. Query siblings existentes + filtro cliente.
  const sibRes = await sdk.listings.query({
    pub_variantGroupId: groupId,
    perPage: 100,
  });
  const allInQuery = sibRes.data.data || [];
  const inGroup = allInQuery.filter(
    l => l.attributes?.publicData?.variantGroupId === groupId
  );
  const existingSiblings = inGroup.filter(l => l.id.uuid !== MASTER_ID);
  console.log(
    `Query: Sharetribe devolvió ${allInQuery.length}, en el grupo ${inGroup.length}, siblings no-master ${existingSiblings.length}\n`
  );

  // Base del publicData para un sibling: clon del master sin campos
  // master-only.
  const basePublicData = (() => {
    const { variantsMatrix, isVariantMaster, variantValues, ...rest } = mPd;
    return rest;
  })();

  const matchedExistingIds = new Set();
  let created = 0;
  let updated = 0;
  let failed = 0;

  // 3. Row 0 (master) stock.
  const row0 = matrix[0];
  const row0Key = rowKey(axes, row0?.variantValues);
  const masterKey = rowKey(axes, mPd.variantValues);
  if (row0 && row0Key === masterKey && typeof row0.stock === 'number') {
    const curStock = master.currentStock?.attributes?.quantity;
    if (row0.stock !== curStock) {
      console.log(`Master stock: ${curStock} → ${row0.stock}`);
      if (APPLY) {
        try {
          await sdk.stock.compareAndSet({
            listingId: master.id,
            oldTotal: typeof curStock === 'number' ? curStock : null,
            newTotal: row0.stock,
          });
        } catch (e) {
          console.error('  ✗ master stock set failed:', e.message);
        }
      }
    }
  }

  // 4. Rows 1..N.
  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i];
    const key = rowKey(axes, row.variantValues);
    const label = Object.values(row.variantValues).join(' · ');
    const existing = existingSiblings.find(
      l => rowKey(axes, l.attributes?.publicData?.variantValues) === key
    );

    if (existing) {
      matchedExistingIds.add(existing.id.uuid);
      const curStock = existing.currentStock?.attributes?.quantity;
      if (typeof row.stock === 'number' && row.stock !== curStock) {
        console.log(`[${i}] ${label}: exists, stock ${curStock} → ${row.stock}`);
        if (APPLY) {
          try {
            await sdk.stock.compareAndSet({
              listingId: existing.id,
              oldTotal: typeof curStock === 'number' ? curStock : null,
              newTotal: row.stock,
            });
            updated += 1;
          } catch (e) {
            console.error('  ✗ update stock failed:', e.message);
            failed += 1;
          }
        }
      } else {
        console.log(`[${i}] ${label}: exists, stock OK`);
      }
      continue;
    }

    // Create new sibling (Integration SDK: sdk.listings.create con state).
    const payload = {
      title: `${mAttrs.title} · ${label}`,
      description: mAttrs.description || '',
      price: mAttrs.price,
      authorId,
      state: 'published',
      publicData: {
        ...basePublicData,
        isVariantMaster: false,
        variantValues: row.variantValues,
      },
      images: masterImages,
    };
    if (mAttrs.geolocation) payload.geolocation = mAttrs.geolocation;
    console.log(`[${i}] ${label}: CREATE`);
    if (!APPLY) {
      created += 1;
      continue;
    }
    try {
      const createRes = await sdk.listings.create(payload);
      const newId = createRes.data.data.id;
      if (typeof row.stock === 'number' && row.stock > 0) {
        await sdk.stock.compareAndSet({
          listingId: newId,
          oldTotal: null,
          newTotal: row.stock,
        });
      }
      console.log(`  ✓ ${newId.uuid}`);
      created += 1;
    } catch (e) {
      console.error('  ✗ create failed:', e.message);
      if (e.data?.errors) {
        console.error('  errors:', JSON.stringify(e.data.errors, null, 4));
      }
      failed += 1;
    }
  }

  // 5. Siblings huérfanos.
  const orphans = existingSiblings.filter(l => !matchedExistingIds.has(l.id.uuid));
  for (const o of orphans) {
    const label = Object.values(o.attributes.publicData.variantValues || {}).join(' · ');
    console.log(`[close] ${label}`);
    if (APPLY) {
      try {
        await sdk.listings.close({ id: o.id });
      } catch (e) {
        console.error('  ✗ close failed:', e.message);
      }
    }
  }

  console.log(
    `\nResultado: created=${created} updated=${updated} failed=${failed} orphans-closed=${orphans.length}`
  );
  if (!APPLY) {
    console.log('DRY RUN — nada se envió. Re-correr con --apply.');
  }
})().catch(e => {
  console.error('ERR:', e.message);
  if (e.data?.errors) console.error(JSON.stringify(e.data.errors, null, 2));
  process.exit(1);
});
