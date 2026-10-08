// XOLOLO Fase 1C.3 — Endpoints de autenticación para el módulo /admin.
//
// Rutas montadas en apiRouter.js:
//   POST /api/admin/auth/bootstrap   (una sola vez, con token secreto)
//   POST /api/admin/auth/login
//   POST /api/admin/auth/logout
//   GET  /api/admin/auth/me          (protegido con requireOperator)
//
// Flow de alta inicial (bootstrap):
//   1. Setear env var XOLOLO_ADMIN_BOOTSTRAP_TOKEN con un string random
//   2. POST /api/admin/auth/bootstrap con body
//      { token, email, name, password }
//   3. Si no hay operators en el directory y el token matchea, crea
//      el primer super_admin con esa password.
//   4. Después del bootstrap exitoso, el super admin crea los demás
//      operators via UI (próximas fases).
//   5. El token se usa UNA SOLA VEZ (si ya hay operators, bootstrap
//      devuelve 409 aunque el token sea válido).

const {
  listOperators,
  createOperator,
  getOperatorByEmail,
} = require('../api-util/operatorDirectory');
const {
  hashPassword,
  performLogin,
  performLogout,
  requireOperator,
  signSession,
  setSessionCookie,
} = require('../api-util/operatorAuth');
const { ROLES } = require('../api-util/operatorRoles');
const { updateOperator } = require('../api-util/operatorDirectory');
const {
  generateEnrollment,
  verifyToken,
  generateRecoveryCodes,
  consumeRecoveryCode,
} = require('../api-util/operatorMfa');

const PASSWORD_MIN_LEN = 12;

const bootstrap = async (req, res) => {
  try {
    const { token, email, name, password } = req.body || {};

    const expectedToken = process.env.XOLOLO_ADMIN_BOOTSTRAP_TOKEN;
    if (!expectedToken || expectedToken.length < 20) {
      return res.status(500).json({ error: 'bootstrap_token_not_configured' });
    }
    if (!token || token !== expectedToken) {
      return res.status(401).json({ error: 'invalid_bootstrap_token' });
    }

    // El bootstrap SOLO funciona si no hay operators ya creados —
    // evita que un operador legítimo con acceso al token lo use para
    // crear otro super_admin después del alta inicial.
    const existing = await listOperators();
    if (existing.length > 0) {
      return res.status(409).json({ error: 'operators_already_exist' });
    }

    if (!email || !name || !password) {
      return res.status(400).json({ error: 'missing_fields' });
    }
    if (typeof password !== 'string' || password.length < PASSWORD_MIN_LEN) {
      return res
        .status(400)
        .json({ error: 'password_too_short', requiredMinLength: PASSWORD_MIN_LEN });
    }

    const operator = await createOperator({
      email,
      name,
      role: ROLES.SUPER_ADMIN,
      createdBy: 'bootstrap',
    });

    // Setea password hash en el operator recién creado.
    const passwordHash = await hashPassword(password);
    await updateOperator(operator.id, { passwordHash });

    return res.status(201).json({
      ok: true,
      operator: {
        id: operator.id,
        email: operator.email,
        name: operator.name,
        role: operator.role,
      },
      note: 'Super admin creado. Loguéate ahora en POST /api/admin/auth/login.',
    });
  } catch (e) {
    if (e.message === 'email_already_exists') {
      return res.status(409).json({ error: 'email_already_exists' });
    }
    if (e.message === 'validation_failed') {
      return res.status(400).json({ error: 'validation_failed', details: e.details });
    }
    // eslint-disable-next-line no-console
    console.error('[admin-auth.bootstrap]', e?.message, e);
    return res.status(500).json({ error: 'internal' });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'missing_fields' });
    }
    const result = await performLogin(res, { email, password });
    if (!result.ok) {
      // Un solo mensaje genérico para no filtrar si email existe o no.
      const status = result.error === 'operator_suspended' ? 403 : 401;
      return res.status(status).json({ error: result.error });
    }
    return res.json({ ok: true, operator: result.operator });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[admin-auth.login]', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

const logout = async (req, res) => {
  performLogout(res);
  return res.json({ ok: true });
};

// GET /me — devuelve el operator autenticado. Protegido con el
// middleware. Para el frontend saber qué roles tiene y qué mostrar.
const me = async (req, res) => {
  const op = req.operator;
  // mfaVerified viene del JWT (sesión), no del directory. El frontend
  // lo necesita para decidir si redirigir al gate /ops/mfa-verify.
  const mfaVerified = !!req.sessionPayload?.mfaVerified;
  return res.json({
    operator: {
      id: op.id,
      email: op.email,
      name: op.name,
      role: op.role,
      mfaEnabled: op.mfaEnabled,
      mfaVerified,
      permissionsOverrides: op.permissionsOverrides || [],
      lastLoginAt: op.lastLoginAt,
    },
  });
};

// ============================================================
// MFA endpoints (Fase 1C.4)
// ============================================================

/**
 * POST /api/admin/auth/mfa/enroll (requiere sesión activa, MFA no
 * requerida porque es justo la que se está enrollando).
 *
 * Devuelve secret + QR data URL + recovery codes PLANO (una sola
 * vez — el frontend los muestra y el operator los imprime/guarda).
 * NO activa mfaEnabled todavía — eso pasa en verify-enroll.
 */
const mfaEnroll = async (req, res) => {
  try {
    const op = req.operator;
    const { secret, otpauthUrl, qrDataUrl } = await generateEnrollment(op);
    const { plain, hashes } = await generateRecoveryCodes();

    // Guardamos el secret y los hashes de recovery codes, PERO
    // mfaEnabled sigue false. Hasta que el operator verifique el
    // primer código en /mfa/verify-enroll no se activa.
    await updateOperator(op.id, {
      mfaSecret: secret,
      mfaRecoveryCodes: hashes,
      mfaEnabled: false,
    });

    return res.json({
      secret,
      otpauthUrl,
      qrDataUrl,
      recoveryCodes: plain,
      note:
        'Escanea el QR con tu app Authenticator y confirma el primer código en /mfa/verify-enroll. Guarda los recovery codes en un lugar seguro — no se mostrarán de nuevo.',
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[admin-auth.mfaEnroll]', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

/**
 * POST /api/admin/auth/mfa/verify-enroll (requiere sesión activa).
 * Body: { token: "123456" }
 *
 * Confirma el primer código TOTP y activa mfaEnabled=true. También
 * re-emite el JWT con mfaVerified=true (el operator ya autenticó
 * el 2do factor en este momento).
 */
const mfaVerifyEnroll = async (req, res) => {
  try {
    const op = req.operator;
    const { token } = req.body || {};
    if (!op.mfaSecret) {
      return res.status(409).json({ error: 'mfa_not_enrolled_yet' });
    }
    if (op.mfaEnabled) {
      return res.status(409).json({ error: 'mfa_already_enabled' });
    }
    if (!verifyToken(token, op.mfaSecret)) {
      return res.status(401).json({ error: 'invalid_token' });
    }
    const updated = await updateOperator(op.id, { mfaEnabled: true });
    // Re-firmar JWT con mfaVerified=true. signSession ata mfaVerified a
    // !mfaEnabled, y acabamos de poner mfaEnabled=true → sin este override
    // la sesión quedaría con mfaVerified=false y los endpoints protegidos
    // responderían mfa_required inmediatamente después del enroll.
    // (El endpoint mfaVerify hace el mismo workaround.)
    const baseToken = signSession(updated);
    const jwt = require('jsonwebtoken');
    const payload = jwt.verify(baseToken, process.env.XOLOLO_ADMIN_JWT_SECRET);
    const finalToken = jwt.sign(
      { ...payload, mfaVerified: true },
      process.env.XOLOLO_ADMIN_JWT_SECRET,
      { expiresIn: payload.exp - Math.floor(Date.now() / 1000) }
    );
    setSessionCookie(res, finalToken);
    return res.json({ ok: true, mfaEnabled: true });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[admin-auth.mfaVerifyEnroll]', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

/**
 * POST /api/admin/auth/mfa/verify (requiere sesión activa SIN MFA
 * verificada todavía — post-login si el operator tiene mfaEnabled).
 * Body: { token: "123456" } o { recoveryCode: "XXXX-XXXX" }
 *
 * Si válido, re-emite JWT con mfaVerified=true.
 */
const mfaVerify = async (req, res) => {
  try {
    const op = req.operator;
    const { token, recoveryCode } = req.body || {};
    if (!op.mfaEnabled || !op.mfaSecret) {
      return res.status(409).json({ error: 'mfa_not_enabled' });
    }

    let ok = false;
    let updateFields = {};

    if (recoveryCode) {
      const result = await consumeRecoveryCode(recoveryCode, op.mfaRecoveryCodes || []);
      if (result.ok) {
        ok = true;
        updateFields.mfaRecoveryCodes = result.updatedCodes;
      }
    } else if (token) {
      ok = verifyToken(token, op.mfaSecret);
    }

    if (!ok) {
      return res.status(401).json({ error: 'invalid_token' });
    }

    if (Object.keys(updateFields).length > 0) {
      await updateOperator(op.id, updateFields);
    }

    // Re-firmar JWT con mfaVerified=true.
    const refreshedOp = { ...op, ...updateFields };
    const newToken = signSession({ ...refreshedOp, mfaEnabled: true });
    // Fuerza mfaVerified=true aunque el helper lo ate a !mfaEnabled.
    // Lo hacemos manual para este endpoint.
    const jwt = require('jsonwebtoken');
    const payload = jwt.verify(newToken, process.env.XOLOLO_ADMIN_JWT_SECRET);
    const finalToken = jwt.sign(
      { ...payload, mfaVerified: true },
      process.env.XOLOLO_ADMIN_JWT_SECRET,
      { expiresIn: payload.exp - Math.floor(Date.now() / 1000) }
    );
    setSessionCookie(res, finalToken);

    return res.json({ ok: true, usedRecoveryCode: !!recoveryCode });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[admin-auth.mfaVerify]', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

/**
 * POST /api/admin/auth/mfa/disable (requiere sesión MFA verificada).
 * Permite al operator desactivar MFA (solo si no es super_admin —
 * el super admin NO puede desactivar MFA, es forzado).
 */
const mfaDisable = async (req, res) => {
  try {
    const op = req.operator;
    if (op.role === ROLES.SUPER_ADMIN) {
      return res.status(403).json({ error: 'super_admin_cannot_disable_mfa' });
    }
    await updateOperator(op.id, {
      mfaEnabled: false,
      mfaSecret: null,
      mfaRecoveryCodes: null,
    });
    return res.json({ ok: true });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[admin-auth.mfaDisable]', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

module.exports = {
  bootstrap,
  login,
  logout,
  me,
  mfaEnroll,
  mfaVerifyEnroll,
  mfaVerify,
  mfaDisable,
  // Export el middleware que admin-auth usa para proteger /me
  requireOperator,
};
