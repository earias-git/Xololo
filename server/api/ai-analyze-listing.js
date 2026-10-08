// XOLOLO Fase 2 — endpoint para disparar análisis IA de un listing.
//
// Contract:
//   POST /api/ai/analyze-listing
//   Body: { listingId: string, force?: boolean, async?: boolean }
//
//   async=true (default): dispara en background con setImmediate, devuelve
//     202 inmediato. El frontend lo usa fire-and-forget después del publish
//     para no bloquear la UX.
//   async=false: espera a terminar y devuelve el resultado completo. Útil
//     para debugging y para el script de backfill.
//
// Security: requiere que el request venga autenticado (user actual = seller
// del listing, o super_admin). En futuro podríamos permitir webhooks de
// Sharetribe directamente, pero por ahora solo UI/scripts internos.

const { getTrustedSdk, handleError, serialize } = require('../api-util/sdk');
const { analyzeListing } = require('../api-util/listingAiAnalysis');

module.exports = async (req, res) => {
  try {
    const { listingId, force = false, async: runAsync = true } = req.body || {};
    if (!listingId || typeof listingId !== 'string') {
      return res.status(400).json({ error: 'listing_id_required' });
    }

    // Autenticación mínima: para evitar que cualquier anon dispare costo IA
    // en nombre de otros listings. getTrustedSdk valida la sesión del user
    // actual (JWT de Sharetribe), lanza si no hay sesión.
    try {
      await getTrustedSdk(req);
    } catch (authErr) {
      return res.status(401).json({ error: 'unauthenticated' });
    }

    if (runAsync) {
      // Fire-and-forget. Logs quedan en Render.
      setImmediate(() => {
        analyzeListing({ listingId, force }).catch(err => {
          // eslint-disable-next-line no-console
          console.error(
            `[ai-analyze-listing] async failed for ${listingId}:`,
            err?.message
          );
        });
      });
      return res.status(202).json({ ok: true, mode: 'async', listingId });
    }

    // Modo sync — espera resultado.
    const result = await analyzeListing({ listingId, force });
    return res.status(200).json({ ok: true, mode: 'sync', ...result });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ai-analyze-listing] error:', err?.message);
    const code = err?.message || 'internal';
    const status =
      code === 'listing_not_found' ? 404 :
      code === 'ai_not_configured' || code === 'integration_sdk_missing' ? 503 :
      500;
    return res.status(status).json({ error: code });
  }
};
