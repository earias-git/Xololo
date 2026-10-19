// XOLOLO: data cleanup del campo publicData.condition en listings.
//
// Contexto: cuando introdujimos el campo `condition` ('new' | 'used') en
// el form de Pricing, el default del seller casual era 'used'. Esto
// derivó en que sellers 'store' (con tienda) que editaron listings
// mientras probaban el flujo quedaron con productos marcados 'used'
// aunque fueran nuevos. Como "Segunda mano destacada" del landing
// filtra por pub_condition=used, estos productos aparecían ahí Y por
// efecto del fix también se excluían de "Productos destacados" por el
// commit ff1d0d81f.
//
// Reglas de limpieza (acordadas con el usuario):
//
//   seller.sellerMode === 'casual_reseller'
//     → NUNCA se toca. Por definición todo lo que publica es usado.
//
//   seller.sellerMode !== 'casual_reseller' (store) con condition='used'
//     → Si el título contiene palabra clave de usado (segunda mano,
//       usado, vintage, pre-owned, de segunda, usada), MANTENER used.
//       El seller declaró conscientemente que es usado — es un store
//       seller que ofrece también usados, que es un caso válido.
//     → Si NO contiene ninguna, asumir contaminación y marcar 'new'.
//       Esto cubre los Diadema/Libreta/Jarrón/etc. que son productos
//       nuevos cuyo flag quedó corrupto.
//
// Modo dry-run (default): sólo imprime qué se tocaría.
// Modo apply: node cleanup-condition-flag.js --apply
//
// Uso:
//   node server/scripts/cleanup-condition-flag.js
//   node server/scripts/cleanup-condition-flag.js --apply

// Soporta ser corrido desde server/ (en producción tras build) o desde
// raíz (en dev). Resuelve el require del helper en ambos casos.
const path = require('path');
const integrationSdkPath = (() => {
  try {
    return require.resolve('../api-util/integrationSdk');
  } catch (_) {
    return path.join(__dirname, '..', 'api-util', 'integrationSdk');
  }
})();
const { getIntegrationSdk } = require(integrationSdkPath);

// Carga variables de ambiente (SHARETRIBE_INTEGRATION_*).
require('dotenv').config();

const APPLY = process.argv.includes('--apply');

// Palabras clave en el título que indican que el producto SÍ es usado y
// debemos preservar su flag. Normalizamos a lower sin acentos.
const USED_KEYWORDS = [
  'segunda mano',
  'usado',
  'usada',
  'de segunda',
  'vintage',
  'pre-owned',
  'preowned',
  'reacondicionado',
  'reacondicionada',
  'seminuevo',
  'seminueva',
];

const stripAccents = s =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const titleLooksUsed = title => {
  const n = stripAccents(title);
  return USED_KEYWORDS.some(k => n.includes(k));
};

const MAX_PAGES = 20;
const PER_PAGE = 100;

const fetchAllListings = async isdk => {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const resp = await isdk.listings.query({
      page,
      perPage: PER_PAGE,
      include: ['author'],
      'fields.listing': ['title', 'publicData', 'state'],
      'fields.user': ['profile.publicData'],
    });
    const data = resp.data.data || [];
    const included = resp.data.included || [];
    const authorsById = new Map();
    for (const inc of included) {
      if (inc.type === 'user') authorsById.set(inc.id.uuid, inc);
    }
    for (const l of data) {
      const authorId = l.relationships?.author?.data?.id?.uuid;
      const author = authorId ? authorsById.get(authorId) : null;
      all.push({ listing: l, author });
    }
    const totalPages = resp.data.meta?.totalPages || 1;
    if (page >= totalPages) break;
  }
  return all;
};

const classify = ({ listing, author }) => {
  const condition = listing.attributes?.publicData?.condition;
  if (condition !== 'used') return null; // nada que limpiar

  const sellerMode = author?.attributes?.profile?.publicData?.sellerMode;
  if (sellerMode === 'casual_reseller') {
    return { action: 'keep', reason: 'seller casual: todo su contenido es usado' };
  }

  const title = listing.attributes?.title || '';
  if (titleLooksUsed(title)) {
    return { action: 'keep', reason: 'título indica usado (store seller con usado real)' };
  }

  return { action: 'clean', reason: 'contaminación: store seller con título neutro' };
};

(async () => {
  const isdk = getIntegrationSdk();
  if (!isdk) {
    console.error('Falta SHARETRIBE_INTEGRATION_CLIENT_ID / SECRET en el env.');
    process.exit(1);
  }

  console.log(`[cleanup-condition-flag] modo: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  const all = await fetchAllListings(isdk);
  console.log(`[cleanup-condition-flag] total listings barridos: ${all.length}`);

  const toClean = [];
  const toKeep = [];
  const untouched = [];

  for (const row of all) {
    const result = classify(row);
    if (!result) {
      untouched.push(row);
    } else if (result.action === 'keep') {
      toKeep.push({ row, result });
    } else {
      toClean.push({ row, result });
    }
  }

  console.log(`\n== Resumen ==`);
  console.log(`  sin condition='used' (nada que hacer): ${untouched.length}`);
  console.log(`  usados confirmados (se MANTIENEN): ${toKeep.length}`);
  console.log(`  contaminados (se limpian a 'new'): ${toClean.length}`);

  console.log(`\n== Se MANTIENEN como usados ==`);
  toKeep.forEach(({ row, result }) => {
    console.log(
      `  [KEEP] ${row.listing.id.uuid.slice(0, 8)} · "${row.listing.attributes.title}" — ${result.reason}`
    );
  });

  console.log(`\n== Se van a limpiar a 'new' ==`);
  toClean.forEach(({ row }) => {
    const authorName = row.author?.attributes?.profile?.displayName || '(sin autor)';
    console.log(
      `  [CLEAN] ${row.listing.id.uuid.slice(0, 8)} · "${row.listing.attributes.title}" · seller: ${authorName}`
    );
  });

  if (!APPLY) {
    console.log(`\n(dry-run) para aplicar, re-ejecutar con --apply`);
    return;
  }

  console.log(`\n== Aplicando cambios ==`);
  let ok = 0;
  let fail = 0;
  for (const { row } of toClean) {
    try {
      await isdk.listings.update({
        id: row.listing.id.uuid,
        publicData: { condition: 'new' },
      });
      ok += 1;
      process.stdout.write('.');
    } catch (e) {
      fail += 1;
      console.error(
        `\n  [FAIL] ${row.listing.id.uuid.slice(0, 8)}: ${e?.message || 'unknown'}`
      );
    }
  }

  console.log(`\n\n[cleanup-condition-flag] done. updated=${ok} failed=${fail}`);
})().catch(e => {
  console.error('[cleanup-condition-flag] uncaught:', e);
  process.exit(1);
});
