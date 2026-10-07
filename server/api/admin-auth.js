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
} = require('../api-util/operatorAuth');
const { ROLES } = require('../api-util/operatorRoles');
const { updateOperator } = require('../api-util/operatorDirectory');

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
  return res.json({
    operator: {
      id: op.id,
      email: op.email,
      name: op.name,
      role: op.role,
      mfaEnabled: op.mfaEnabled,
      permissionsOverrides: op.permissionsOverrides || [],
      lastLoginAt: op.lastLoginAt,
    },
  });
};

module.exports = {
  bootstrap,
  login,
  logout,
  me,
  // Export el middleware que admin-auth usa para proteger /me
  requireOperator,
};
