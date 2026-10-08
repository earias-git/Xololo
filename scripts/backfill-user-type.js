#!/usr/bin/env node
/* eslint-disable no-console */
//
// XOLOLO — scripts/backfill-user-type.js
//
// Normaliza el campo publicData.userType de todos los users de Sharetribe
// al valor canónico ('provider' | 'customer'). Resuelve registros legacy
// que quedaron con labels en español (p.ej. "Proveedor", "Comprador") y
// que por eso no matcheaban filtros estrictos como el de /api/featured-stores.
//
// Uso (desde la raíz del repo):
//
//   # DRY RUN — lista cuántos cambiaría sin tocar nada
//   node scripts/backfill-user-type.js
//
//   # APLICAR — ejecuta las updates vía Integration SDK
//   node scripts/backfill-user-type.js --apply
//
//   # VERBOSE — imprime cada user individual (recomendado la primera vez)
//   node scripts/backfill-user-type.js --verbose
//
// Requisitos:
//   SHARETRIBE_INTEGRATION_CLIENT_ID y SHARETRIBE_INTEGRATION_CLIENT_SECRET
//   en el entorno (mismas creds que ya usa el server).
//
// Seguridad:
//   - Sólo re-escribe users cuyo userType reconoce como variante LEGACY.
//     Users ya canónicos ('provider' / 'customer') se saltan.
//   - Users con userType completamente desconocido (null, "", "admin",
//     cualquier string no mapeado) se reportan como "unmapped" y NO se
//     tocan — revisar manualmente antes de decidir.
//   - Preserva todo el resto de publicData intacto.

// Carga env vars del .env si existe (misma convención que el server).
try {
  require('dotenv').config();
} catch (_) {
  // dotenv es opcional; en Render las vars vienen del entorno directo.
}

const { getIntegrationSdk } = require('../server/api-util/integrationSdk');
const { canonicalizeUserType } = require('../server/api-util/userTypes');

const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes('--apply');
const VERBOSE = ARGS.includes('--verbose');

const log = (...a) => console.log(...a);
const vlog = (...a) => {
  if (VERBOSE) console.log(...a);
};

const main = async () => {
  const sdk = getIntegrationSdk();
  if (!sdk) {
    console.error(
      'ERROR: Integration SDK no configurado. Verifica SHARETRIBE_INTEGRATION_CLIENT_ID y SHARETRIBE_INTEGRATION_CLIENT_SECRET.'
    );
    process.exit(1);
  }

  log(`\n=== Backfill userType ${APPLY ? '(APLICANDO cambios)' : '(DRY RUN)'} ===\n`);

  const summary = {
    total: 0,
    alreadyCanonical: 0,
    canonicalizable: 0,
    unmapped: 0,
    updated: 0,
    failed: 0,
  };

  const unmappedUsers = [];
  const toUpdate = [];

  // Pagina sobre TODOS los users. perPage máximo del Integration API es 100.
  let page = 1;
  let totalPages = 1;
  do {
    const resp = await sdk.users.query({ perPage: 100, page });
    const users = resp.data.data || [];
    totalPages = resp.data.meta?.totalPages || 1;

    for (const u of users) {
      summary.total += 1;
      const pd = u.attributes.profile.publicData || {};
      const raw = pd.userType;
      const canonical = canonicalizeUserType(raw);

      if (canonical === null) {
        summary.unmapped += 1;
        unmappedUsers.push({
          id: u.id.uuid,
          email: u.attributes.email,
          raw,
          displayName: u.attributes.profile.displayName,
        });
        vlog(
          `  [unmapped] ${u.attributes.email} userType=${JSON.stringify(raw)} — se omite`
        );
        continue;
      }

      if (raw === canonical) {
        summary.alreadyCanonical += 1;
        vlog(`  [ok]       ${u.attributes.email} userType=${raw}`);
        continue;
      }

      summary.canonicalizable += 1;
      toUpdate.push({ user: u, from: raw, to: canonical });
      vlog(
        `  [fix]      ${u.attributes.email}  "${raw}" → "${canonical}"`
      );
    }

    log(`Página ${page}/${totalPages} procesada (${users.length} users).`);
    page += 1;
  } while (page <= totalPages);

  log(`\n--- Resumen antes de aplicar ---`);
  log(`  Total users:          ${summary.total}`);
  log(`  Ya canónicos:         ${summary.alreadyCanonical}`);
  log(`  A canonicalizar:      ${summary.canonicalizable}`);
  log(`  Unmapped (revisar):   ${summary.unmapped}`);

  if (summary.unmapped > 0) {
    log(`\n--- Users unmapped (se omitirán, requieren revisión manual) ---`);
    unmappedUsers.forEach(u => {
      log(`  ${u.email}  (id=${u.id})  userType=${JSON.stringify(u.raw)}  displayName="${u.displayName}"`);
    });
  }

  if (!APPLY) {
    log(`\nDRY RUN: no se aplicaron cambios. Vuelve a correr con --apply para ejecutar.`);
    return;
  }

  if (toUpdate.length === 0) {
    log(`\nNada que actualizar. Fin.`);
    return;
  }

  log(`\n--- Aplicando ${toUpdate.length} updates ---`);
  for (const { user, from, to } of toUpdate) {
    try {
      // IMPORTANT: pasamos SOLO el campo userType en publicData. El SDK
      // de Sharetribe hace merge shallow (no reemplazo), así que el resto
      // de publicData se preserva intacto.
      await sdk.users.updateProfile({
        id: user.id,
        publicData: { userType: to },
      });
      summary.updated += 1;
      log(`  ✓ ${user.attributes.email}  "${from}" → "${to}"`);
    } catch (err) {
      summary.failed += 1;
      const msg = err?.data?.errors?.[0]?.title || err?.message || 'unknown';
      console.error(`  ✗ ${user.attributes.email}  FAILED: ${msg}`);
    }
  }

  log(`\n--- Resultado final ---`);
  log(`  Actualizados: ${summary.updated}`);
  log(`  Fallidos:     ${summary.failed}`);
  log(`\nNota: el cache in-memory de /api/featured-stores dura 5 minutos.`);
  log(`Para forzar refresh inmediato, reinicia el service en Render.`);
};

main().catch(err => {
  console.error('ERROR fatal:', err);
  process.exit(1);
});
