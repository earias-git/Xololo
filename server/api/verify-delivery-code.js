// XOLOLO: endpoint que verifica el código de 6 dígitos que el buyer le
// muestra al seller/chofer al momento físico de la entrega, aplica a
// modos: pickup, localDelivery y freight (después de autorizar pago).
//
// Contrato:
//   POST /api/verify-delivery-code
//   Body: { transactionId, code }
//   200 → { verified: true, verifiedAt }
//   400 → { error: 'invalid_request', details }
//   401 → { error: 'unauthorized' } — no logueado o no es el seller
//   404 → { error: 'transaction_not_found' }
//   409 → { error: 'not_code_transaction' | 'no_delivery_code' | 'already_verified' | 'code_blocked' }
//   422 → { error: 'wrong_code', attemptsRemaining, blocked }
//   500 → { error: 'internal' }
//
// Reglas:
// - Solo el seller (provider) puede verificar el código.
// - 3 intentos fallidos → se bloquea, alerta interna a Xololo, la tx
//   no puede verificarse sin intervención manual.
// - Al éxito: se marca verifiedAt en metadata. La transición a
//   MARK_DELIVERED se dispara en el Commit 2 desde este mismo endpoint.
//
// Compat: `POST /api/verify-pickup-code` sigue apuntando aquí. Y tx
// viejas que guardaron el shape como `pickupCode` se leen igual (ver
// readDeliveryCode).

const { getSdk } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');

const MAX_ATTEMPTS = 3;
const CODE_MODES = ['pickup', 'localDelivery', 'freight'];

// Lee el shape del código aceptando ambos nombres (deliveryCode nuevo,
// pickupCode legacy) para no romper tx creadas antes del rename.
const readDeliveryCode = xShipping =>
  xShipping?.deliveryCode || xShipping?.pickupCode || null;

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
    let currentUserResp;
    try {
      currentUserResp = await sdk.currentUser.show();
    } catch (e) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const currentUserId = currentUserResp.data.data.id.uuid;

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
    if (!CODE_MODES.includes(xShipping.mode)) {
      return res.status(409).json({ error: 'not_code_transaction' });
    }
    const deliveryCode = readDeliveryCode(xShipping);
    if (!deliveryCode || !deliveryCode.code) {
      return res.status(409).json({ error: 'no_delivery_code' });
    }
    if (deliveryCode.verifiedAt) {
      return res.status(409).json({ error: 'already_verified' });
    }
    if (deliveryCode.blockedAt) {
      return res.status(409).json({ error: 'code_blocked' });
    }

    const nowIso = new Date().toISOString();
    const matches = String(code) === String(deliveryCode.code);

    // Escribir metadata requiere Integration SDK — el marketplace SDK
    // no tiene updateMetadata. Sin Integration credentials no podemos
    // rastrear intentos ni marcar verified, así que rechazamos temprano.
    const isdk = getIntegrationSdk();
    if (!isdk) {
      // eslint-disable-next-line no-console
      console.error('[verify-delivery-code] Integration SDK no configurado');
      return res.status(500).json({ error: 'internal' });
    }

    if (!matches) {
      const nextAttempts = (deliveryCode.attempts || 0) + 1;
      const willBlock = nextAttempts >= MAX_ATTEMPTS;
      await isdk.transactions.updateMetadata({
        id: transactionId,
        metadata: {
          // Nombre nuevo: xololoDeliveryCodeAttempts. Aún guardamos
          // xololoPickupCodeAttempts para compat de dashboards viejos.
          xololoDeliveryCodeAttempts: {
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

    // Éxito: marcar verificado. La transición MARK_DELIVERED se dispara
    // en el Commit 2 desde aquí mismo.
    await isdk.transactions.updateMetadata({
      id: transactionId,
      metadata: {
        xololoDeliveryCodeVerified: {
          verifiedAt: nowIso,
          verifiedBy: currentUserId,
        },
      },
    });

    return res.json({ verified: true, verifiedAt: nowIso });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('verify-delivery-code unexpected:', e);
    return res.status(500).json({ error: 'internal' });
  }
};
