// XOLOLO: endpoint de diagnóstico del gate admin. No requiere ser
// admin — SÓLO devuelve info del user logueado + resumen del gate,
// nunca lista de emails ni info de otros users.
//
// Útil cuando un operador recibe `not_admin` sin saber por qué:
// visita /api/admin-check y ve exactamente qué email le ve el server
// y cuántos admins hay configurados (sin exponer cuáles).
//
// Contrato:
//   GET /api/admin-check
//   200 → {
//     loggedInAs: 'email@ejemplo.mx',    // email EXACTO que ve el server
//     isAdmin: boolean,                   // true si pasa el gate
//     adminListSize: number,              // cuántos emails hay (0 = env sin configurar)
//   }
//   401 → { error: 'unauthorized' }       // no hay sesión activa

const { getSdk } = require('../api-util/sdk');
const { getAdminEmails } = require('../api-util/adminGate');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const sdk = getSdk(req, res);
  let email = null;
  try {
    const resp = await sdk.currentUser.show();
    email = String(resp.data.data?.attributes?.email || '').toLowerCase();
  } catch (e) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const adminEmails = getAdminEmails();
  return res.json({
    loggedInAs: email || null,
    isAdmin: !!email && adminEmails.has(email),
    adminListSize: adminEmails.size,
  });
};
