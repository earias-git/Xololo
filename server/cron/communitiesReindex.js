// XOLOLO 2026-11-23 — intenta forzar re-index de Sharetribe sobre el
// campo publicData.sellerCommunities cuando el índice interno quedó
// stale. Importante: en nuestras pruebas con el nuke pattern
// (null → []), Sharetribe NO reindexa de inmediato — el filtro
// `has:<id>` sigue devolviendo los mismos listings aunque el mirror en
// el documento ya sea []. Es un lag (o bug) del índice de Sharetribe
// que el script no puede resolver por sí solo. Por eso la landing
// usa overfetch + post-filter defensivo (ver communitiesService.js).
//
// Problema: el filtro `pub_sellerCommunities:has:<id>` de Sharetribe
// devuelve listings cuyo mirror actual NO incluye <id> — el valor
// cambió a [] (opt-out) o nunca se asignó (undefined), pero el índice
// de Sharetribe no refleja el update. La landing /comunidad/<slug>
// mete un post-filter defensivo (inCommunity) para no mostrar basura,
// pero además pide muchas pages por un fraction real (overfetch).
//
// Uso recomendado: correr este script periódicamente (cron diario o
// manual), medir `falsePositives` → si bajan con el tiempo, el índice
// de Sharetribe sí responde al nuke pattern con lag. Si no bajan en
// varios días, abrir ticket con Sharetribe para forzar reindex global
// de `pub_sellerCommunities` o configurar el campo como filterable
// en Console (puede ser el root cause).
//
// Qué hace este cron:
//   1. Por cada community publicada en el seed, consulta
//      `pub_sellerCommunities:has:<communityId>` (hasta MAX_PAGES de
//      PER_PAGE items, descartando siblings).
//   2. Filtra los que son falsos positivos: `sellerCommunities` actual
//      NO incluye `communityId` (sea [], undefined, o un array sin ese id).
//   3. Para cada falso positivo, dispara `isdk.listings.update` con
//      el valor normalizado (actual o [] si estaba undefined). El write
//      fuerza a Sharetribe a re-indexar y a sacarlo del `has:<id>`.
//   4. Para listings que SÍ tienen el id en el mirror pero el seller
//      ya no está en la comunidad (drift del otro lado), la limpieza
//      cae en el mirror repair existente; este cron no los toca.
//   5. Reporta {communityId, raw, falsePositives, reindexed, errors}.
//
// Idempotente: una vez que Sharetribe re-indexa el listing, el
// `has:<id>` ya no lo devuelve; la siguiente corrida verá menos raw.

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const communitiesService = require('../api-util/communitiesService');

const PER_PAGE = 100;
const MAX_PAGES = 10; // hasta 1000 candidates por comunidad

const isSibling = l => {
  const pd = l.attributes?.publicData || {};
  return !!pd.variantGroupId && pd.isVariantMaster !== true;
};

const hasInMirror = (listing, communityId) => {
  const sc = listing.attributes?.publicData?.sellerCommunities;
  return Array.isArray(sc) && sc.includes(communityId);
};

const reindexCommunity = async ({ sdk, communityId, dryRun }) => {
  const stats = {
    communityId,
    raw: 0,
    realMembers: 0,
    siblingsSkipped: 0,
    falsePositives: 0,
    reindexed: 0,
    errors: 0,
    sampleFalsePositives: [],
  };

  for (let page = 1; page <= MAX_PAGES; page++) {
    let resp;
    try {
      // eslint-disable-next-line no-await-in-loop
      resp = await sdk.listings.query({
        pub_sellerCommunities: `has:${communityId}`,
        perPage: PER_PAGE,
        page,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`[reindex:${communityId}] listings.query p${page} failed:`, e?.message);
      break;
    }
    const data = resp.data?.data || [];
    if (!data.length) break;
    stats.raw += data.length;

    for (const l of data) {
      if (isSibling(l)) {
        stats.siblingsSkipped += 1;
        continue;
      }
      if (hasInMirror(l, communityId)) {
        stats.realMembers += 1;
        continue;
      }

      // Falso positivo: Sharetribe dice que has:<id> pero el mirror no.
      stats.falsePositives += 1;
      const currentSc = l.attributes?.publicData?.sellerCommunities;
      const nextSc = Array.isArray(currentSc) ? currentSc : [];
      if (stats.sampleFalsePositives.length < 5) {
        stats.sampleFalsePositives.push({
          listingId: l.id?.uuid,
          title: l.attributes?.title?.slice(0, 50),
          currentSc: currentSc,
          nextSc,
        });
      }
      if (dryRun) continue;
      try {
        // XOLOLO 2026-11-23 — nuke pattern para forzar re-index.
        // Sharetribe NO re-indexa cuando el nuevo valor coincide con el
        // actual (p.ej. [] → [] es no-op). Necesitamos escribir algo
        // distinto y luego el valor final. `null` borra el campo;
        // seguido de [] lo re-escribe. Sharetribe entonces reindexa.
        // eslint-disable-next-line no-await-in-loop
        await sdk.listings.update({
          id: l.id,
          publicData: { sellerCommunities: null },
        });
        // eslint-disable-next-line no-await-in-loop
        await sdk.listings.update({
          id: l.id,
          publicData: { sellerCommunities: nextSc },
        });
        stats.reindexed += 1;
      } catch (e) {
        stats.errors += 1;
        // eslint-disable-next-line no-console
        console.error(`[reindex:${communityId}] update ${l.id?.uuid} failed:`, e?.message);
      }
    }

    const totalPages = resp.data?.meta?.totalPages || 1;
    if (page >= totalPages) break;
  }

  return stats;
};

/**
 * Corre el re-index sobre todas las comunidades publicadas (o una
 * específica si pasas `communityIds`).
 *
 * @param {object} opts
 * @param {boolean} opts.dryRun — si true no hace writes
 * @param {string[]} [opts.communityIds] — subset (default: todas publicadas)
 * @param {object} [opts.isdk]
 */
const reindexCommunities = async ({ dryRun = true, communityIds, isdk = null } = {}) => {
  const sdk = isdk || getIntegrationSdk();
  if (!sdk) throw new Error('integration_api_missing');

  const published = communitiesService.listPublic();
  const targets = communityIds
    ? published.filter(c => communityIds.includes(c.id))
    : published;

  const results = {
    startedAt: new Date().toISOString(),
    dryRun,
    perCommunity: [],
    totals: { raw: 0, realMembers: 0, falsePositives: 0, reindexed: 0, errors: 0 },
  };

  for (const c of targets) {
    // eslint-disable-next-line no-await-in-loop
    const s = await reindexCommunity({ sdk, communityId: c.id, dryRun });
    results.perCommunity.push(s);
    results.totals.raw += s.raw;
    results.totals.realMembers += s.realMembers;
    results.totals.falsePositives += s.falsePositives;
    results.totals.reindexed += s.reindexed;
    results.totals.errors += s.errors;
  }

  results.finishedAt = new Date().toISOString();
  results.durationMs =
    new Date(results.finishedAt).getTime() - new Date(results.startedAt).getTime();
  return results;
};

module.exports = { reindexCommunities, reindexCommunity };
