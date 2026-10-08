// XOLOLO Fase 1C.3 — Autenticación de operadores Xololo.
// Password hashing (bcryptjs) + JWT de sesión (jsonwebtoken) +
// middleware para proteger endpoints de /admin.
//
// Secretos de env requeridos:
//   XOLOLO_ADMIN_JWT_SECRET  — HMAC secret para firmar JWTs (32+ chars)
//   XOLOLO_ADMIN_BOOTSTRAP_TOKEN — token usado SOLO una vez para crear
//     el primer super_admin cuando el directory está vacío.
//
// La cookie que se envía al browser:
//   nombre: xolo_admin_session
//   httpOnly, secure (en prod), sameSite='lax'
//   expira: 8 horas (sesión de operador)

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { getOperatorById, updateOperator } = require('./operatorDirectory');
const { hasPermission } = require('./operatorRoles');

const BCRYPT_ROUNDS = 12;
const SESSION_COOKIE = 'xolo_admin_session';
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8h

const getJwtSecret = () => {
  const s = process.env.XOLOLO_ADMIN_JWT_SECRET;
  if (!s || s.length < 32) {
    // eslint-disable-next-line no-console
    console.error('[operatorAuth] XOLOLO_ADMIN_JWT_SECRET faltante o <32 chars');
    return null;
  }
  return s;
};

// ============================================================
// Password hashing
// ============================================================

const hashPassword = async plain => {
  if (!plain || typeof plain !== 'string' || plain.length < 10) {
    throw new Error('password_too_short');
  }
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
};

const verifyPassword = async (plain, hash) => {
  if (!plain || !hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch (e) {
    return false;
  }
};

// ============================================================
// JWT de sesión
// ============================================================

/**
 * Firma un JWT para un operator ya autenticado. Claims:
 *   sub: operator id
 *   email, name, role
 *   mfaVerified: boolean (Fase 1C.4 lo pone true tras TOTP)
 *   iat, exp (8h)
 */
const signSession = operator => {
  const secret = getJwtSecret();
  if (!secret) throw new Error('jwt_secret_missing');
  return jwt.sign(
    {
      sub: operator.id,
      email: operator.email,
      name: operator.name,
      role: operator.role,
      mfaVerified: !operator.mfaEnabled, // si no tiene MFA, considerar ya "verificado"
    },
    secret,
    { expiresIn: Math.floor(SESSION_MAX_AGE_MS / 1000) }
  );
};

const verifySession = token => {
  const secret = getJwtSecret();
  if (!secret) return null;
  try {
    return jwt.verify(token, secret);
  } catch (e) {
    return null;
  }
};

/**
 * Setea cookie de sesión en la respuesta.
 */
const setSessionCookie = (res, token) => {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_MS,
    path: '/',
  });
};

const clearSessionCookie = res => {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
};

// ============================================================
// Middleware: requireOperator
// ============================================================

/**
 * Middleware que valida la cookie de sesión y adjunta el operator
 * actualizado a req.operator. Opciones:
 *   roles: Array<string> — si se pasa, exige que operator.role esté
 *     en la lista. Default: cualquier rol válido.
 *   requireMfa: boolean — si true, exige mfaVerified. Default true
 *     (todos los endpoints sensibles requieren MFA).
 *   permission: {module, action} — valida permiso específico.
 *
 * Devuelve 401 si no hay cookie / cookie inválida / operator suspendido.
 * Devuelve 403 si el rol/permiso no autoriza.
 */
const requireOperator = (opts = {}) => async (req, res, next) => {
  const { roles, requireMfa = true, permission } = opts;

  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) {
    return res.status(401).json({ error: 'unauthenticated' });
  }
  const payload = verifySession(token);
  if (!payload || !payload.sub) {
    return res.status(401).json({ error: 'invalid_session' });
  }
  if (requireMfa && !payload.mfaVerified) {
    return res.status(401).json({ error: 'mfa_required' });
  }

  // Re-fetch del operator — por si lo suspendieron o le cambiaron rol
  // después de que la cookie se emitió. Fuente de verdad = directory.
  const operator = await getOperatorById(payload.sub);
  if (!operator) {
    return res.status(401).json({ error: 'operator_not_found' });
  }
  if (operator.suspendedAt) {
    return res.status(401).json({ error: 'operator_suspended' });
  }

  if (roles && !roles.includes(operator.role)) {
    return res.status(403).json({ error: 'role_not_allowed' });
  }
  if (permission) {
    const ok = hasPermission(
      operator.role,
      permission.module,
      permission.action,
      operator.permissionsOverrides || []
    );
    if (!ok) {
      return res.status(403).json({ error: 'permission_denied' });
    }
  }

  req.operator = operator;
  // Expone el payload JWT a los handlers (en especial mfaVerified, que
  // no vive en el directory R2 — es un claim de la sesión actual).
  req.sessionPayload = payload;
  next();
};

// ============================================================
// Login flow (sin MFA aún — Fase 1C.4 agrega el 2do factor)
// ============================================================

/**
 * Login: verifica email+password, actualiza lastLoginAt, firma JWT,
 * setea cookie. Devuelve objeto operator sin campos sensibles.
 * Si el operator tiene MFA habilitada, el JWT se emite con
 * mfaVerified=false y el frontend debe redirigir a /admin/mfa-verify
 * para completar el segundo factor antes de poder navegar.
 */
const performLogin = async (res, { email, password }) => {
  const { getOperatorByEmail } = require('./operatorDirectory');
  const operator = await getOperatorByEmail(email);
  if (!operator) return { ok: false, error: 'invalid_credentials' };
  if (operator.suspendedAt) return { ok: false, error: 'operator_suspended' };
  if (!operator.passwordHash) return { ok: false, error: 'password_not_set' };
  const passOk = await verifyPassword(password, operator.passwordHash);
  if (!passOk) return { ok: false, error: 'invalid_credentials' };

  await updateOperator(operator.id, { lastLoginAt: new Date().toISOString() });

  const token = signSession(operator);
  setSessionCookie(res, token);

  return {
    ok: true,
    operator: {
      id: operator.id,
      email: operator.email,
      name: operator.name,
      role: operator.role,
      mfaEnabled: operator.mfaEnabled,
      mfaVerified: !operator.mfaEnabled,
    },
  };
};

const performLogout = res => {
  clearSessionCookie(res);
};

module.exports = {
  // Password
  hashPassword,
  verifyPassword,
  BCRYPT_ROUNDS,

  // Session
  signSession,
  verifySession,
  setSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE,
  SESSION_MAX_AGE_MS,

  // Middleware
  requireOperator,

  // Flows
  performLogin,
  performLogout,

  // Config check
  getJwtSecret,
};
