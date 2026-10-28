// XOLOLO OPS Users 360 · Fase C — viewer global del audit log.
//
// GET /api/admin/ops/audit-log?actorEmail=&action=&userId=&days=7&page=1&pageSize=50
//   Agrega todos los metadata.xololoOps.audit entries del snapshot
//   cacheado (users ya enriquecido con metadata) y los lista con
//   filtros. Para v1 funciona para volumen ~decenas de K entries
//   totales (snapshot cacheado 10 min).

const { getSnapshot } = require('../api-util/opsUsersRoster');
const { getIntegrationSdk } = require('../api-util/integrationSdk');

const MAX_PAGE_SIZE = 200;
const DEFAULT_DAYS = 7;

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    // Para armar el audit log global, necesitamos re-fetch de users con
    // metadata detallada. El snapshot del roster solo guarda derivados.
    // Pero como los users ya se traen con metadata completa, podemos
    // re-fetch acá o hacer una segunda query. Pragma v1: hacer una query
    // dedicada para no mezclar.
    const isdk = getIntegrationSdk();
    if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

    const PER_PAGE = 100;
    const MAX_PAGES = 30;
    const allEntries = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const resp = await isdk.users.query({
        page,
        perPage: PER_PAGE,
        'fields.user': ['email', 'profile.displayName', 'profile.metadata'],
      });
      for (const u of resp.data.data || []) {
        const audit = u.attributes?.profile?.metadata?.xololoOps?.audit || [];
        for (const a of audit) {
          allEntries.push({
            ...a,
            userId: u.id?.uuid,
            userEmail: u.attributes?.email || null,
            userDisplayName: u.attributes?.profile?.displayName || null,
          });
        }
      }
      const totalPages = resp.data.meta?.totalPages || 1;
      if (page >= totalPages) break;
    }

    // Filtros
    const actorEmail = String(req.query.actorEmail || '').toLowerCase().trim();
    const action = String(req.query.action || '').trim();
    const userId = String(req.query.userId || '').trim();
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || DEFAULT_DAYS));
    const since = Date.now() - days * 24 * 60 * 60 * 1000;

    let filtered = allEntries;
    if (actorEmail) {
      filtered = filtered.filter(a => (a.by?.email || '').toLowerCase() === actorEmail);
    }
    if (action) {
      filtered = filtered.filter(a => a.action === action);
    }
    if (userId) {
      filtered = filtered.filter(a => a.userId === userId);
    }
    filtered = filtered.filter(a => {
      if (!a.at) return false;
      return new Date(a.at).getTime() >= since;
    });

    // Sort desc por timestamp.
    filtered.sort((a, b) => new Date(b.at) - new Date(a.at));

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, parseInt(req.query.pageSize, 10) || 50)
    );
    const start = (page - 1) * pageSize;
    const pageEntries = filtered.slice(start, start + pageSize);

    // Facets simples (counts por action + por actor).
    const byAction = {};
    const byActor = {};
    for (const a of filtered) {
      byAction[a.action] = (byAction[a.action] || 0) + 1;
      const k = a.by?.email || '(unknown)';
      byActor[k] = (byActor[k] || 0) + 1;
    }

    return res.json({
      total: allEntries.length,
      filteredTotal: filtered.length,
      page,
      pageSize,
      days,
      facets: { byAction, byActor },
      entries: pageEntries,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[ops-audit-log] error:', e?.message || e);
    return res.status(500).json({ error: 'internal' });
  }
};
