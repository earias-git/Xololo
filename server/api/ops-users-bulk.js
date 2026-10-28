// XOLOLO OPS Users 360 · Fase C — bulk actions sobre múltiples users.
//
// POST /api/admin/ops/users/bulk-note
//   Body: { userIds: string[], text: string }
//   Agrega la misma nota a cada user. Audit por cada entry.
//   200 → { total, succeeded, failed, errors: [{userId, error}] }

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { addNote, recordAudit } = require('../api-util/opsAudit');

const MAX_USERS = 100;

const bulkNote = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const { userIds, text } = req.body || {};
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: 'userIds_required' });
  }
  if (userIds.length > MAX_USERS) {
    return res.status(400).json({ error: 'too_many_users', max: MAX_USERS });
  }
  const trimmed = String(text || '').trim();
  if (!trimmed) return res.status(400).json({ error: 'empty_note' });
  if (trimmed.length > 5000) return res.status(400).json({ error: 'note_too_long' });

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  let succeeded = 0;
  const errors = [];
  for (const userId of userIds) {
    try {
      const note = await addNote({
        isdk,
        userId,
        operator: req.operator,
        text: trimmed,
      });
      recordAudit({
        isdk,
        userId,
        operator: req.operator,
        action: 'bulk_note_added',
        payload: { noteId: note.id, bulkSize: userIds.length },
      });
      succeeded += 1;
    } catch (e) {
      errors.push({ userId, error: e?.message || 'unknown' });
    }
  }
  return res.json({
    total: userIds.length,
    succeeded,
    failed: errors.length,
    errors: errors.slice(0, 20),
  });
};

module.exports = { bulkNote };
