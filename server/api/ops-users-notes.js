// XOLOLO OPS Users 360 · Fase B — notas internas CRM.
//
// POST /api/admin/ops/users/:userId/notes
//   Body: { text: string }
//   Agrega una nota al user. Auto-registra audit entry 'note_added'.
//   201 → { note }
//
// DELETE /api/admin/ops/users/:userId/notes/:noteId
//   Elimina una nota (solo autor o super_admin).
//   200 → { deleted: noteId }

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { addNote, deleteNote, recordAudit } = require('../api-util/opsAudit');

const create = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const userId = req.params?.userId;
  if (!userId) return res.status(400).json({ error: 'invalid_request' });

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    const note = await addNote({
      isdk,
      userId,
      operator: req.operator,
      text: req.body?.text,
    });
    recordAudit({
      isdk,
      userId,
      operator: req.operator,
      action: 'note_added',
      payload: { noteId: note.id },
    });
    return res.status(201).json({ note });
  } catch (e) {
    if (e?.message === 'empty_note') return res.status(400).json({ error: 'empty_note' });
    if (e?.message === 'note_too_long') return res.status(400).json({ error: 'note_too_long' });
    // eslint-disable-next-line no-console
    console.error('[ops-users-notes.create] error:', e?.message || e);
    return res.status(500).json({ error: 'internal' });
  }
};

const remove = async (req, res) => {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'method_not_allowed' });
  const { userId, noteId } = req.params || {};
  if (!userId || !noteId) return res.status(400).json({ error: 'invalid_request' });

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    const result = await deleteNote({ isdk, userId, noteId, operator: req.operator });
    recordAudit({
      isdk,
      userId,
      operator: req.operator,
      action: 'note_deleted',
      payload: { noteId },
    });
    return res.json(result);
  } catch (e) {
    if (e?.message === 'note_not_found') return res.status(404).json({ error: 'note_not_found' });
    if (e?.message === 'forbidden') return res.status(403).json({ error: 'forbidden' });
    // eslint-disable-next-line no-console
    console.error('[ops-users-notes.remove] error:', e?.message || e);
    return res.status(500).json({ error: 'internal' });
  }
};

module.exports = { create, remove };
