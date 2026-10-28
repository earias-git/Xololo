// XOLOLO Tier Empresarial · E2 — firma/verifica tokens de invitación.
//
// El token lo manda el admin en el link del email, el colaborador lo
// trae de vuelta al endpoint `/api/team/accept-invite`. Lo firmamos
// con un secret dedicado (TEAM_INVITE_SECRET) con fallback a
// JWT_SECRET existente para que funcione en dev sin env extra.
//
// Claims:
//   sub: collaboratorEmail (lowercase)
//   adminId: uuid del seller al que se le invita a entrar
//   roleName: preset de rol
//   permissions: string[] (los que el admin eligió)
//   iat, exp (7 días)
//
// Nota: adminEmail y collaboratorEmail quedan en el token para que
// la pantalla de accept pueda renderizar "Fulanita te invitó" sin
// un roundtrip adicional. permissions quedan en el token también
// para que teamStore.addInvite tenga TODO lo que necesita sin
// re-consultar — pero el server valida contra el taxonomy antes de
// escribir.

const jwt = require('jsonwebtoken');

const TTL_SECONDS = 7 * 24 * 60 * 60; // 7 días

const getSecret = () =>
  process.env.TEAM_INVITE_SECRET ||
  process.env.JWT_SECRET ||
  process.env.OPERATOR_SESSION_SECRET ||
  'xololo-dev-only-team-invite';

// Rotación: durante la ventana de rotación, aceptar también el secret
// previo (TEAM_INVITE_SECRET_PREV).
const getVerifySecrets = () => {
  const current = getSecret();
  const prev = process.env.TEAM_INVITE_SECRET_PREV;
  const out = [current];
  if (prev && prev !== current) out.push(prev);
  return out;
};

/**
 * Firma un token de invitación. collaboratorEmail se normaliza a
 * lowercase para que la comparación en accept sea case-insensitive.
 */
const signInviteToken = ({ adminId, adminEmail, collaboratorEmail, roleName, permissions }) => {
  if (!adminId) throw new Error('adminId_required');
  if (!collaboratorEmail) throw new Error('collaboratorEmail_required');
  if (!roleName) throw new Error('roleName_required');
  const payload = {
    sub: String(collaboratorEmail).trim().toLowerCase(),
    adminId,
    adminEmail: adminEmail || null,
    roleName,
    permissions: Array.isArray(permissions) ? [...permissions] : [],
    kind: 'team_invite',
  };
  return jwt.sign(payload, getSecret(), { expiresIn: TTL_SECONDS });
};

/**
 * Verifica un token. Devuelve el payload si válido, o
 * { error: 'expired'|'invalid_signature'|'invalid_shape' }.
 */
const verifyInviteToken = token => {
  if (!token || typeof token !== 'string') {
    return { error: 'invalid_shape' };
  }
  for (const secret of getVerifySecrets()) {
    try {
      const payload = jwt.verify(token, secret);
      if (payload?.kind !== 'team_invite') return { error: 'invalid_shape' };
      if (!payload?.sub || !payload?.adminId || !payload?.roleName) {
        return { error: 'invalid_shape' };
      }
      return { ok: true, payload };
    } catch (e) {
      // Try next secret only if signature error; expired is terminal.
      if (e?.name === 'TokenExpiredError') return { error: 'expired' };
      // continue to next secret
    }
  }
  return { error: 'invalid_signature' };
};

module.exports = {
  signInviteToken,
  verifyInviteToken,
  TTL_SECONDS,
};
