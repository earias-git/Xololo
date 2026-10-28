// XOLOLO OPS Users 360 · Fase B — endpoint "online ahora" (banner live).
//
// GET /api/admin/ops/users/live?windowMinutes=60
//   Devuelve los users con lastSeenAt dentro de la ventana (default 60min).
//   Se arma a partir del snapshot cacheado del roster — no API extra.
//
//   200 → {
//     generatedAt, windowMinutes,
//     totalOnline, users: [{ id, displayName, email, type, lastSeenAt }]
//   }

const { getSnapshot } = require('../api-util/opsUsersRoster');

const DEFAULT_WINDOW_MIN = 60;
const MAX_WINDOW_MIN = 1440; // 24h
const MAX_USERS = 100;

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const windowMinutes = Math.min(
      MAX_WINDOW_MIN,
      Math.max(1, parseInt(req.query.windowMinutes, 10) || DEFAULT_WINDOW_MIN)
    );
    const since = Date.now() - windowMinutes * 60 * 1000;

    const { snapshot, cached } = await getSnapshot();
    const online = snapshot.entries
      .filter(e => e.lastSeenAt && new Date(e.lastSeenAt).getTime() >= since)
      .sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt))
      .slice(0, MAX_USERS)
      .map(e => ({
        id: e.id,
        displayName: e.displayName,
        email: e.email,
        type: e.type,
        lastSeenAt: e.lastSeenAt,
      }));

    return res.json({
      generatedAt: new Date(snapshot.at).toISOString(),
      cached,
      windowMinutes,
      totalOnline: online.length,
      users: online,
    });
  } catch (e) {
    if (e?.message === 'integration_api_missing') {
      return res.status(500).json({ error: 'integration_api_missing' });
    }
    // eslint-disable-next-line no-console
    console.error('[ops-users-live] error:', e?.message || e);
    return res.status(500).json({ error: 'internal' });
  }
};
