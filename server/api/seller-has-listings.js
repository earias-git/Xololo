// XOLOLO Track A (docs/SUBSCRIPTIONS_V1.md §1.2): "¿este seller ya
// tiene al menos una listing publicada?" — usado por
// RequireSellerOnboarding (src/components/) para decidir si es un
// seller "establecido" (nunca se le gatea, aunque le falte un paso
// nuevo del checklist) o "nuevo" (sí se le dirige a terminar
// onboarding antes de dejarlo publicar/gestionar productos).
//
// Deliberadamente NO usa el flag `currentUserHasListings` de Redux
// (state.user, poblado por sdk.ownListings.query() client-side) —
// resultó no confiable en este ambiente (el fetch nunca se dispara o
// falla con 401 según el estado del token del SDK en el browser).
// Se resuelve igual que suscripción/documentos legales: vía
// Integration API server-side, mismo patrón ya usado en
// publicationGate.js.
//
// Contrato:
//   GET /api/seller-has-listings
//   Auth: user logueado.
//   200 → { hasPublishedListings: boolean }
//   401 → { error: 'unauthorized' }

const { getSdk } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');

module.exports = async (req, res) => {
  let sellerId;
  try {
    const sdk = getSdk(req, res);
    const uResp = await sdk.currentUser.show();
    sellerId = uResp.data.data.id.uuid;
  } catch (e) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    const resp = await isdk.listings.query({
      authorId: sellerId,
      states: ['published'],
      page: 1,
      perPage: 1,
    });
    return res.json({ hasPublishedListings: (resp.data.data || []).length > 0 });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[seller-has-listings] error:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};
