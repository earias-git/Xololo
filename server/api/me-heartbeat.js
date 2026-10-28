// XOLOLO OPS Users 360 · Fase A — heartbeat para medir última actividad.
//
// POST /api/me/heartbeat
//   - Verifica sesión del user con el SDK normal (currentUser.show).
//   - Si está autenticado, dispara recordUserActivity (fire-and-forget).
//   - Responde 200 { bumped: boolean } rápido.
//   - Si no hay sesión, responde 204 (no error, no bump).
//
// El cliente lo llama al cargar la app + cada 5min + al visibilitychange
// (ver src/util/useHeartbeat.js). Dedupe de 60s vive en userActivity.js.

const { getSdk } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { recordUserActivity } = require('../api-util/userActivity');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // 1) Verificar sesión. Si falla cualquier cosa, 204 silent — un
  // heartbeat no autenticado es trivialmente ignorable.
  const sdk = getSdk(req, res);
  let userId = null;
  try {
    const resp = await sdk.currentUser.show();
    userId = resp.data.data?.id?.uuid || null;
  } catch (_e) {
    return res.status(204).end();
  }
  if (!userId) return res.status(204).end();

  // 2) Bump (fire-and-forget). Dedupe de 60s por userId.
  const isdk = getIntegrationSdk();
  if (!isdk) {
    // Si Integration API no está configurada (dev / staging sin keys),
    // devolvemos 200 noop en vez de 500 — el heartbeat no debe tirar
    // avisos ruidosos al cliente.
    return res.json({ bumped: false, reason: 'integration_api_missing' });
  }
  const bumped = recordUserActivity({ isdk, userId });
  return res.json({ bumped });
};
