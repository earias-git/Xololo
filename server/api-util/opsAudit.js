// XOLOLO OPS Users 360 · Fase B — audit log + notas internas por user.
//
// Shape que vive en metadata.xololoOps:
//   {
//     notes: [{ id, by: {operatorId, email, name}, at: ISO, text: string }],
//     audit: [{ id, by, at, action, payload?, result? }],
//   }
//
// Ambos son append-prepend (nuevos entries al inicio). Truncamos a los
// últimos MAX_ENTRIES para no inflar el perfil. Si un operator necesita
// ver historia más larga, en Fase C migramos a un store propio en R2.

const { randomUUID } = require('crypto');

const MAX_NOTES = 100;
const MAX_AUDIT = 200;

const readOpsBlock = user => {
  const md = user?.attributes?.profile?.metadata || {};
  return md.xololoOps || { notes: [], audit: [] };
};

/**
 * Agrega una nota a un user. Devuelve la nota creada.
 */
const addNote = async ({ isdk, userId, operator, text }) => {
  if (!isdk) throw new Error('integration_api_missing');
  if (!userId) throw new Error('invalid_user');
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('empty_note');
  if (trimmed.length > 5000) throw new Error('note_too_long');

  const resp = await isdk.users.show({ id: userId });
  const current = readOpsBlock(resp.data.data);
  const entry = {
    id: randomUUID(),
    by: {
      operatorId: operator?.id || null,
      email: operator?.email || null,
      name: operator?.name || null,
    },
    at: new Date().toISOString(),
    text: trimmed,
  };
  const nextNotes = [entry, ...(current.notes || [])].slice(0, MAX_NOTES);
  await isdk.users.updateProfile({
    id: userId,
    metadata: {
      xololoOps: { ...current, notes: nextNotes },
    },
  });
  return entry;
};

/**
 * Elimina una nota por id (solo quien la escribió o un super_admin).
 */
const deleteNote = async ({ isdk, userId, noteId, operator }) => {
  if (!isdk) throw new Error('integration_api_missing');
  const resp = await isdk.users.show({ id: userId });
  const current = readOpsBlock(resp.data.data);
  const notes = current.notes || [];
  const target = notes.find(n => n.id === noteId);
  if (!target) throw new Error('note_not_found');
  const isAuthor = target.by?.operatorId === operator?.id;
  const isSuperAdmin = operator?.role === 'super_admin';
  if (!isAuthor && !isSuperAdmin) throw new Error('forbidden');

  const nextNotes = notes.filter(n => n.id !== noteId);
  await isdk.users.updateProfile({
    id: userId,
    metadata: { xololoOps: { ...current, notes: nextNotes } },
  });
  return { deleted: noteId };
};

/**
 * Agrega un entry al audit log. No lanza en caso de error (audit nunca
 * debe tumbar la acción real que se está auditando) — devuelve bool.
 */
const recordAudit = async ({ isdk, userId, operator, action, payload, result }) => {
  if (!isdk || !userId) return false;
  try {
    const resp = await isdk.users.show({ id: userId });
    const current = readOpsBlock(resp.data.data);
    const entry = {
      id: randomUUID(),
      by: {
        operatorId: operator?.id || null,
        email: operator?.email || null,
        name: operator?.name || null,
      },
      at: new Date().toISOString(),
      action,
      payload: payload || null,
      result: result || null,
    };
    const nextAudit = [entry, ...(current.audit || [])].slice(0, MAX_AUDIT);
    await isdk.users.updateProfile({
      id: userId,
      metadata: { xololoOps: { ...current, audit: nextAudit } },
    });
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[opsAudit] recordAudit falló para ${userId}:`, e?.message);
    return false;
  }
};

module.exports = {
  readOpsBlock,
  addNote,
  deleteNote,
  recordAudit,
  MAX_NOTES,
  MAX_AUDIT,
};
