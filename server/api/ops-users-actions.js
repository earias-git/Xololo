// XOLOLO OPS Users 360 · Fase C — acciones destructivas (verify-manual,
// suspend, unsuspend, resync-badge) + impersonate con MFA step-up.
//
// Todas las acciones:
//   - requireOperator (ya montado en apiRouter con MFA)
//   - impersonate exige MFA step-up adicional (re-ingresar TOTP) + motivo
//   - Audit log entry por cada acción con payload del body
//
// POST /api/admin/ops/users/:userId/impersonate
//   Body: { reason: string, totpCode: string }
//   200 → { redirectUrl: '/api/initiate-login-as?user_id=...' }
//
// POST /api/admin/ops/users/:userId/suspend
//   Body: { reason: string }
//   200 → { suspended: true, suspendedAt }
//
// POST /api/admin/ops/users/:userId/unsuspend
//   Body: { reason: string }
//   200 → { suspended: false, unsuspendedAt }
//
// POST /api/admin/ops/users/:userId/resync-badge
//   Body: {} — opcional, no toma args.
//   200 → { changed, verified }

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { recordAudit } = require('../api-util/opsAudit');
const { verifyToken } = require('../api-util/operatorMfa');
const { getOperatorById } = require('../api-util/operatorDirectory');
const { syncVerifiedBadge } = require('../api-util/sellerVerified');
const { invalidateSnapshot } = require('../api-util/opsUsersRoster');
const { markSuspended, markUnsuspended } = require('../api-util/userSuspension');

const MAX_REASON = 500;
const MIN_REASON = 10;

const trimReason = raw => String(raw || '').trim();

const impersonate = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const userId = req.params?.userId;
  if (!userId) return res.status(400).json({ error: 'invalid_request' });

  const reason = trimReason(req.body?.reason);
  if (reason.length < MIN_REASON) return res.status(400).json({ error: 'reason_required' });
  if (reason.length > MAX_REASON) return res.status(400).json({ error: 'reason_too_long' });

  const totpCode = String(req.body?.totpCode || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(totpCode)) return res.status(400).json({ error: 'invalid_totp_format' });

  // Re-fetch del operator para traer mfaSecret (requireOperator no lo
  // adjunta a req.operator por seguridad).
  const fullOperator = await getOperatorById(req.operator.id);
  if (!fullOperator?.mfaSecret) {
    return res.status(403).json({ error: 'operator_mfa_not_enrolled' });
  }
  if (!verifyToken(totpCode, fullOperator.mfaSecret)) {
    return res.status(401).json({ error: 'invalid_totp' });
  }

  const isdk = getIntegrationSdk();
  recordAudit({
    isdk,
    userId,
    operator: req.operator,
    action: 'impersonate_initiated',
    payload: { reason },
  });

  // Devolvemos la URL que el cliente debe navegar — el flow existente
  // de initiate-login-as se encarga del resto (OAuth con Console).
  return res.json({
    redirectUrl: `/api/initiate-login-as?user_id=${encodeURIComponent(userId)}`,
  });
};

const suspend = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const userId = req.params?.userId;
  if (!userId) return res.status(400).json({ error: 'invalid_request' });
  const reason = trimReason(req.body?.reason);
  if (reason.length < MIN_REASON) return res.status(400).json({ error: 'reason_required' });

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    const { suspendedAt } = await markSuspended({
      isdk,
      userId,
      reason,
      operator: req.operator,
    });
    recordAudit({
      isdk,
      userId,
      operator: req.operator,
      action: 'user_suspended',
      payload: { reason },
    });
    invalidateSnapshot();
    return res.json({ suspended: true, suspendedAt });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[ops-users-actions.suspend] error:', e?.message || e);
    return res.status(500).json({ error: 'internal' });
  }
};

const unsuspend = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const userId = req.params?.userId;
  if (!userId) return res.status(400).json({ error: 'invalid_request' });
  const reason = trimReason(req.body?.reason);
  if (reason.length < MIN_REASON) return res.status(400).json({ error: 'reason_required' });

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    const { unsuspendedAt } = await markUnsuspended({
      isdk,
      userId,
      reason,
      operator: req.operator,
    });
    recordAudit({
      isdk,
      userId,
      operator: req.operator,
      action: 'user_unsuspended',
      payload: { reason },
    });
    invalidateSnapshot();
    return res.json({ suspended: false, unsuspendedAt });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[ops-users-actions.unsuspend] error:', e?.message || e);
    return res.status(500).json({ error: 'internal' });
  }
};

const resyncBadge = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const userId = req.params?.userId;
  if (!userId) return res.status(400).json({ error: 'invalid_request' });

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    const result = await syncVerifiedBadge({ isdk, sellerId: userId });
    recordAudit({
      isdk,
      userId,
      operator: req.operator,
      action: 'badge_resync',
      payload: {},
      result: result.changed
        ? `changed → verified=${result.verified}`
        : 'no_change',
    });
    if (result.changed) invalidateSnapshot();
    return res.json(result);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[ops-users-actions.resyncBadge] error:', e?.message || e);
    return res.status(500).json({ error: 'internal' });
  }
};

module.exports = { impersonate, suspend, unsuspend, resyncBadge };
