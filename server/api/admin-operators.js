// XOLOLO Fase 1C.5b — CRUD de operators. Solo super_admin puede
// crear, actualizar y suspender. Los demás roles solo pueden ver
// (si tienen permiso 'view' en módulo 'operators').
//
// Rutas montadas en apiRouter.js:
//   GET  /api/admin/operators
//   POST /api/admin/operators
//   PATCH /api/admin/operators/:id
//   POST /api/admin/operators/:id/suspend
//   POST /api/admin/operators/:id/reinstate
//   POST /api/admin/operators/:id/set-password
//
// Todos requieren middleware requireOperator con rol super_admin.

const {
  listOperators,
  getOperatorById,
  createOperator,
  updateOperator,
  suspendOperator,
  reinstateOperator,
} = require('../api-util/operatorDirectory');
const { hashPassword } = require('../api-util/operatorAuth');
const { ROLES, isValidRole, ROLE_LABELS } = require('../api-util/operatorRoles');

// Sanitiza un operator para enviarlo al cliente — nunca enviar
// passwordHash, mfaSecret ni mfaRecoveryCodes.
const sanitize = op => {
  if (!op) return null;
  const { passwordHash, mfaSecret, mfaRecoveryCodes, ...safe } = op;
  return {
    ...safe,
    hasPassword: !!passwordHash,
    recoveryCodesRemaining: Array.isArray(mfaRecoveryCodes)
      ? mfaRecoveryCodes.filter(c => !c.consumedAt).length
      : 0,
  };
};

const list = async (req, res) => {
  try {
    const operators = await listOperators();
    return res.json({
      operators: operators.map(sanitize),
      roles: Object.values(ROLES).map(r => ({ key: r, label: ROLE_LABELS[r] })),
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[admin-operators.list]', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

const create = async (req, res) => {
  try {
    const { email, name, role } = req.body || {};
    if (!email || !name || !role) {
      return res.status(400).json({ error: 'missing_fields' });
    }
    if (!isValidRole(role)) {
      return res.status(400).json({ error: 'role_invalid' });
    }
    const operator = await createOperator({
      email,
      name,
      role,
      createdBy: req.operator.id,
    });
    return res.status(201).json({ operator: sanitize(operator) });
  } catch (e) {
    if (e.message === 'email_already_exists') {
      return res.status(409).json({ error: 'email_already_exists' });
    }
    if (e.message === 'validation_failed') {
      return res.status(400).json({ error: 'validation_failed', details: e.details });
    }
    // eslint-disable-next-line no-console
    console.error('[admin-operators.create]', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

const update = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, role, permissionsOverrides } = req.body || {};

    // No permitir que super_admin se cambie su propio rol (puede
    // generar lockout). Super admin edita otro operator; para
    // cambiar su propio rol debe hacerlo otro super_admin.
    if (id === req.operator.id && role && role !== req.operator.role) {
      return res.status(400).json({ error: 'cannot_change_own_role' });
    }

    const patch = {};
    if (name !== undefined) patch.name = String(name).trim();
    if (role !== undefined) {
      if (!isValidRole(role)) return res.status(400).json({ error: 'role_invalid' });
      patch.role = role;
    }
    if (permissionsOverrides !== undefined) {
      if (!Array.isArray(permissionsOverrides)) {
        return res.status(400).json({ error: 'permissions_overrides_invalid' });
      }
      patch.permissionsOverrides = permissionsOverrides;
    }

    const operator = await updateOperator(id, patch);
    return res.json({ operator: sanitize(operator) });
  } catch (e) {
    if (e.message === 'operator_not_found') {
      return res.status(404).json({ error: 'operator_not_found' });
    }
    // eslint-disable-next-line no-console
    console.error('[admin-operators.update]', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

const suspend = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    if (id === req.operator.id) {
      return res.status(400).json({ error: 'cannot_suspend_self' });
    }
    const target = await getOperatorById(id);
    if (!target) return res.status(404).json({ error: 'operator_not_found' });
    // No permitir suspender al único super admin activo.
    if (target.role === ROLES.SUPER_ADMIN) {
      const all = await listOperators();
      const activeSuperAdmins = all.filter(
        o => o.role === ROLES.SUPER_ADMIN && !o.suspendedAt && o.id !== id
      );
      if (activeSuperAdmins.length === 0) {
        return res.status(400).json({ error: 'cannot_suspend_last_super_admin' });
      }
    }
    const operator = await suspendOperator(id, {
      suspendedBy: req.operator.id,
      reason,
    });
    return res.json({ operator: sanitize(operator) });
  } catch (e) {
    if (e.message === 'operator_not_found') {
      return res.status(404).json({ error: 'operator_not_found' });
    }
    // eslint-disable-next-line no-console
    console.error('[admin-operators.suspend]', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

const reinstate = async (req, res) => {
  try {
    const { id } = req.params;
    const operator = await reinstateOperator(id);
    return res.json({ operator: sanitize(operator) });
  } catch (e) {
    if (e.message === 'operator_not_found') {
      return res.status(404).json({ error: 'operator_not_found' });
    }
    // eslint-disable-next-line no-console
    console.error('[admin-operators.reinstate]', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

/**
 * Setea password al operator. Usado por super_admin para asignar la
 * contraseña inicial a un operator recién creado (hoy no les llega
 * email; en el futuro mandar email con link reset).
 *
 * Validaciones: mínimo 12 chars. El operator target puede ser
 * cualquiera, incluyendo el super_admin que está invocando.
 */
const setPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body || {};
    if (!password || typeof password !== 'string' || password.length < 12) {
      return res.status(400).json({ error: 'password_too_short', requiredMinLength: 12 });
    }
    const hash = await hashPassword(password);
    const operator = await updateOperator(id, { passwordHash: hash });
    return res.json({ operator: sanitize(operator) });
  } catch (e) {
    if (e.message === 'operator_not_found') {
      return res.status(404).json({ error: 'operator_not_found' });
    }
    // eslint-disable-next-line no-console
    console.error('[admin-operators.setPassword]', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

module.exports = {
  list,
  create,
  update,
  suspend,
  reinstate,
  setPassword,
};
