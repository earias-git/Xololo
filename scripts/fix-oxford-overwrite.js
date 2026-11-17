// XOLOLO 2026-11-17 — Reparación de los 8 listings de kikeagri cuyo
// título fue pisado por el bug replicate (commit 0b100d554).
// Sharetribe no versiona `title` → no se pueden recuperar originales.
//
// Estrategia:
//   - Título placeholder descriptivo basado en categoryLevel1 + precio + condition.
//   - Pasar a `closed` (unpublished) para sacarlos de storefront y de OPS,
//     manteniendo toda su data (publicData, price, images, stock).
//   - Seller los retoma en ManageListings, corrige título y republica.
//
// Uso:
//   node scripts/fix-oxford-overwrite.js           # dry-run (default)
//   node scripts/fix-oxford-overwrite.js --apply   # ejecuta cambios
//
// SOLO para los 8 listings pisados. NO toca el master Oxford legítimo
// (que vive en otro grupo/categoría).

require('dotenv').config();
const { getIntegrationSdk } = require('../server/api-util/integrationSdk');

const APPLY = process.argv.includes('--apply');
const TARGET_EMAIL = 'kikearias1972+secprimario@gmail.com';
const PISADO_TITLE = 'Oxford bostoniano cuero negro hombre talla 28 nuevo';

const categoryLabels = {
  alimentos: 'Alimento',
  hogar: 'Artículo de hogar',
  'servicios-pro': 'Servicio profesional',
  papeleria: 'Papelería',
  artesanias: 'Artesanía',
  ropa: 'Prenda',
  calzado: 'Calzado',
  electronica: 'Electrónico',
};

const buildPlaceholder = (listing) => {
  const pd = listing.attributes?.publicData || {};
  const cat = pd.categoryLevel1 || 'producto';
  const label = categoryLabels[cat] || `Producto (${cat})`;
  const priceAmount = listing.attributes?.price?.amount || 0;
  const priceMxn = Math.round(priceAmount / 100);
  return `[Reeditar título] ${label} · $${priceMxn} MXN`;
};

(async () => {
  const isdk = getIntegrationSdk();
  if (!isdk) {
    console.error('Integration SDK no configurado. Abort.');
    process.exit(1);
  }

  // Localizar los 8 pisados del email target.
  const pisados = [];
  for (let page = 1; page <= 20; page++) {
    const resp = await isdk.listings.query({
      page,
      perPage: 100,
      'fields.listing': ['title', 'publicData', 'price', 'state'],
      include: ['author'],
    });
    const data = resp.data.data || [];
    const inc = resp.data.included || [];
    const userById = new Map(
      inc.filter(i => i.type === 'user').map(u => [u.id.uuid, u])
    );

    for (const l of data) {
      if (l.attributes?.title !== PISADO_TITLE) continue;
      const authorId = l.relationships?.author?.data?.id?.uuid;
      const author = userById.get(authorId);
      if (author?.attributes?.email !== TARGET_EMAIL) continue;
      pisados.push(l);
    }
    const totalPages = resp.data.meta?.totalPages || 1;
    if (page >= totalPages) break;
  }

  console.log(`\nMode: ${APPLY ? 'APPLY (write)' : 'DRY-RUN (read-only)'}`);
  console.log(`Target email: ${TARGET_EMAIL}`);
  console.log(`Found ${pisados.length} pisados listings.\n`);

  if (pisados.length === 0) {
    console.log('Nada que hacer.');
    return;
  }

  // Guard: nunca más de 10. El bug afectó 8, si de pronto hay 20 algo anda mal.
  if (pisados.length > 10) {
    console.error(`SAFETY ABORT: ${pisados.length} listings matched. Expected ≤10.`);
    process.exit(2);
  }

  for (const l of pisados) {
    const newTitle = buildPlaceholder(l);
    const state = l.attributes?.state;
    console.log(`  [${l.id.uuid.slice(0, 8)}…]`);
    console.log(`    state actual: ${state}`);
    console.log(`    title viejo:  "${l.attributes?.title}"`);
    console.log(`    title nuevo:  "${newTitle}"`);
    console.log(`    acción:       title update + close (unpublish)`);

    if (APPLY) {
      try {
        await isdk.listings.update(
          { id: l.id, title: newTitle },
          { expand: false }
        );
        if (state === 'published') {
          await isdk.listings.close({ id: l.id }, { expand: false });
        }
        console.log(`    ✅ done`);
      } catch (e) {
        console.log(`    ❌ error: ${e.message}`);
      }
    }
    console.log('');
  }

  if (!APPLY) {
    console.log('Dry-run finished. Re-run with --apply to execute.');
  } else {
    console.log('Changes applied.');
  }
})().catch(e => {
  console.error(e.message);
  process.exit(1);
});
