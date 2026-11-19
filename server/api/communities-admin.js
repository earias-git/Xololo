// XOLOLO 2026-11-18 — ADR-006 PR-4: endpoints admin de comunidades.
//
// Scope V1 (realista con filesystem efímero de Render):
//   - GET  /admin/communities         → lista RAW (todas + overlay)
//   - POST /admin/communities/:id/publish   → overlay isPublished=true
//   - POST /admin/communities/:id/unpublish → overlay isPublished=false
//   - POST /admin/communities/:id/recount-sellers → recuenta sellers
//
// Edición de branding, descripción, etc. queda como edit-al-seed +
// deploy en V1. La UI del operador (PR-9) lo explica.
//
// Gated por adminAuth.requireOperator() (MFA), rate limit ops.

const service = require('../api-util/communitiesService');
const adminOverlay = require('../api-util/communitiesAdminOverlay');
const { getIntegrationSdk } = require('../api-util/integrationSdk');

const list = (req, res) => {
  const communities = service.getAllRaw().map(c => ({
    ...c,
    overlay: adminOverlay.get(c.id),
  }));
  res.status(200).json({ communities });
};

const publish = (req, res) => {
  const { id } = req.params;
  const community = service.getAllRaw().find(c => c.id === id);
  if (!community) return res.status(404).json({ error: 'community_not_found' });

  adminOverlay.setPublished({
    id,
    isPublished: true,
    operatorEmail: req.operator?.email,
  });
  service.invalidateCache();
  // eslint-disable-next-line no-console
  console.log(
    `[communities-admin:publish] ${id} by ${req.operator?.email || 'unknown'}`
  );
  return res.status(200).json({
    status: 'published',
    id,
    note:
      'Cambio in-memory. Para que persista entre deploys, commit isPublished=true al seed (src/config/communities.js).',
  });
};

const unpublish = (req, res) => {
  const { id } = req.params;
  const community = service.getAllRaw().find(c => c.id === id);
  if (!community) return res.status(404).json({ error: 'community_not_found' });

  adminOverlay.setPublished({
    id,
    isPublished: false,
    operatorEmail: req.operator?.email,
  });
  service.invalidateCache();
  // eslint-disable-next-line no-console
  console.log(
    `[communities-admin:unpublish] ${id} by ${req.operator?.email || 'unknown'}`
  );
  return res.status(200).json({
    status: 'unpublished',
    id,
    note:
      'Cambio in-memory. Para que persista entre deploys, commit isPublished=false al seed.',
  });
};

// Recalcula sellerCount contando users con publicData.communities que
// incluya el id. In-memory (no persiste al seed; es solo "verlo ahora").
const recountSellers = async (req, res) => {
  const { id } = req.params;
  const community = service.getAllRaw().find(c => c.id === id);
  if (!community) return res.status(404).json({ error: 'community_not_found' });

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  let count = 0;
  const type = community.type; // 'sectorial' | 'modelo' | 'geografica'
  try {
    for (let page = 1; page <= 10; page++) {
      const resp = await isdk.users.query({ perPage: 100, page });
      const data = resp.data?.data || [];
      for (const u of data) {
        const arr =
          u.attributes?.profile?.publicData?.communities?.[type] || [];
        if (Array.isArray(arr) && arr.includes(id)) count += 1;
      }
      if (data.length < 100) break;
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[communities-admin:recount]', e?.message);
    return res.status(500).json({ error: e?.message || 'recount_failed' });
  }

  return res.status(200).json({
    id,
    sellerCount: count,
    note:
      'Conteo calculado en vivo. Para que aparezca en la landing pública persistente, commit sellerCount al seed.',
  });
};

module.exports = { list, publish, unpublish, recountSellers };
