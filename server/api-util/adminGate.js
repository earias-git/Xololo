// XOLOLO F3 · Fase 3: gating de endpoints /api/admin/*.
//
// El acceso a data cruzada del marketplace (GMV, disputas, sellers,
// etc.) requiere que el email del user logueado esté en la lista
// XOLOLO_ADMIN_EMAILS (coma-separado, insensible a mayúsculas y
// espacios). Sin la env var configurada, TODOS los endpoints admin
// devuelven 403 — comportamiento fail-closed.
//
// Uso desde un endpoint:
//   const { requireAdmin } = require('../api-util/adminGate');
//   const admin = await requireAdmin(req, res);
//   if (!admin.ok) return; // requireAdmin ya respondió 401/403.
//   // ...
//
// Los endpoints internos NO exponen data del user cliente cuando el
// gate falla — nunca revelan si el email está o no en la lista.

const { getSdk } = require('./sdk');

// Parsea la env var y devuelve un Set en minúsculas. Se re-evalúa
// en cada llamada — permite rotar emails sin restart (los cambios
// requieren redeploy en Render igual, pero el patrón es correcto).
const getAdminEmails = () => {
  const raw = process.env.XOLOLO_ADMIN_EMAILS || '';
  const set = new Set();
  for (const part of raw.split(',')) {
    const email = part.trim().toLowerCase();
    if (email) set.add(email);
  }
  return set;
};

// Verifica que el user logueado (via cookie de Sharetribe) tenga un
// email en XOLOLO_ADMIN_EMAILS. Devuelve { ok, userId, email } al
// pasar, o responde el error apropiado y devuelve { ok: false }.
//
// El caller DEBE hacer early return cuando ok=false — este helper
// ya escribió el status.
const requireAdmin = async (req, res) => {
  const adminEmails = getAdminEmails();
  if (adminEmails.size === 0) {
    // Env sin configurar → fail-closed. Log para poder detectarlo.
    // eslint-disable-next-line no-console
    console.warn('[adminGate] XOLOLO_ADMIN_EMAILS sin configurar — bloqueando todo /api/admin');
    res.status(403).json({ error: 'admin_gate_disabled' });
    return { ok: false };
  }

  const sdk = getSdk(req, res);
  let user;
  try {
    const resp = await sdk.currentUser.show();
    user = resp.data.data;
  } catch (e) {
    res.status(401).json({ error: 'unauthorized' });
    return { ok: false };
  }
  const email = String(user.attributes?.email || '').toLowerCase();
  if (!email || !adminEmails.has(email)) {
    // Respuesta genérica — no confirmamos que existe el email en la lista.
    res.status(403).json({ error: 'not_admin' });
    return { ok: false };
  }
  return { ok: true, userId: user.id.uuid, email };
};

module.exports = { requireAdmin, getAdminEmails };
