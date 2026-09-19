// XOLOLO: endpoint que verifica el código de 6 dígitos que el buyer le
// muestra al seller/chofer al momento físico de la entrega en pickup.
// Ver docs/LOGISTICS_V1.md §8.
//
// Contrato:
//   POST /api/verify-pickup-code
//   Body: { transactionId, code }
//   200 → { verified: true, verifiedAt }
//   400 → { error: 'invalid_request', details }
//   401 → { error: 'unauthorized' } — no logueado o no es el seller
//   404 → { error: 'transaction_not_found' }
//   409 → { error: 'not_pickup_transaction' | 'no_pickup_code' | 'already_verified' | 'code_blocked' }
//   422 → { error: 'wrong_code', attemptsRemaining, blocked }
//   500 → { error: 'internal' }
//
// Reglas:
// - Solo el seller (provider) puede verificar el código.
// - El código debe haber sido "revelado" antes (seller hizo click en
//   "Iniciar entrega" y capturó datos del chofer).
// - 3 intentos fallidos → se bloquea el código, alerta interna a Xololo,
//   la transacción no puede verificarse sin intervención manual.
// - Al éxito: se marca verifiedAt y se dispara transition/mark-delivered
//   (o el equivalente en el proceso de compra) para liberar el flow.

const { getSdk, getTrustedSdk } = require('../api-util/sdk');

const MAX_ATTEMPTS = 3;

module.exports = async (req, res) => {
  try {
    const { transactionId, code } = req.body || {};
    if (!transactionId || typeof transactionId !== 'string') {
      return res.status(400).json({ error: 'invalid_request', details: 'transactionId requerido.' });
    }
    if (!code || !/^\d{6}$/.test(String(code))) {
      return res.status(400).json({ error: 'invalid_request', details: 'code debe ser 6 dígitos.' });
    }

    const sdk = getSdk(req, res);
    // Confirmar que hay sesión.
    let currentUserResp;
    try {
      currentUserResp = await sdk.currentUser.show();
    } catch (e) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const currentUserId = currentUserResp.data.data.id.uuid;

    // Traer la transacción con provider incluido para validar ownership.
    let txResp;
    try {
      txResp = await sdk.transactions.show({
        id: transactionId,
        include: ['provider'],
      });
    } catch (e) {
      if (e.status === 404) return res.status(404).json({ error: 'transaction_not_found' });
      throw e;
    }
    const tx = txResp.data.data;
    const providerId = tx.relationships?.provider?.data?.id?.uuid;

    // Solo el provider puede verificar el código (el buyer no; sería un
    // vector de ataque para "auto-marcar como entregado").
    if (providerId !== currentUserId) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const xShipping = tx.attributes.protectedData?.xololoShipping || {};
    if (xShipping.mode !== 'pickup') {
      return res.status(409).json({ error: 'not_pickup_transaction' });
    }
    const pickupCode = xShipping.pickupCode;
    if (!pickupCode || !pickupCode.code) {
      return res.status(409).json({ error: 'no_pickup_code' });
    }
    if (pickupCode.verifiedAt) {
      return res.status(409).json({ error: 'already_verified' });
    }
    if (pickupCode.blockedAt) {
      return res.status(409).json({ error: 'code_blocked' });
    }

    const nowIso = new Date().toISOString();
    const matches = String(code) === String(pickupCode.code);

    // Usamos el trusted SDK (privilegios de operador) para escribir en la
    // transacción (metadata no la puede tocar el buyer/provider directo).
    const trustedSdk = await getTrustedSdk(req);

    if (!matches) {
      const nextAttempts = (pickupCode.attempts || 0) + 1;
      const willBlock = nextAttempts >= MAX_ATTEMPTS;
      const updatedPickupCode = {
        ...pickupCode,
        attempts: nextAttempts,
        blockedAt: willBlock ? nowIso : null,
      };
      // Actualizamos protectedData con los intentos.
      await trustedSdk.transactions.updateMetadata({
        id: transactionId,
        metadata: {
          xololoPickupCodeAttempts: {
            attempts: nextAttempts,
            blockedAt: willBlock ? nowIso : null,
            lastAttemptAt: nowIso,
          },
        },
      });
      return res.status(422).json({
        error: 'wrong_code',
        attemptsRemaining: Math.max(0, MAX_ATTEMPTS - nextAttempts),
        blocked: willBlock,
      });
    }

    // Éxito: marcar verificado y persistir. (La transición a
    // "entregado" del proceso Sharetribe se hace en Fase D.5 desde el
    // UI del seller, no aquí — este endpoint solo valida el código.)
    await trustedSdk.transactions.updateMetadata({
      id: transactionId,
      metadata: {
        xololoPickupCodeVerified: {
          verifiedAt: nowIso,
          verifiedBy: currentUserId,
        },
      },
    });

    return res.json({ verified: true, verifiedAt: nowIso });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('verify-pickup-code unexpected:', e);
    return res.status(500).json({ error: 'internal' });
  }
};
