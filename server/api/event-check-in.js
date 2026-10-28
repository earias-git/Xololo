// XOLOLO: verifica + marca el check-in de un asistente a un evento.
//
// Flow:
//   1. El seller en la puerta del evento escanea el QR del asistente
//      (con la cámara nativa del celular, que abre la URL del QR en el
//      browser). La URL es /event-check-in?token=JWT.
//   2. La página /event-check-in POSTea aquí con el token.
//   3. El server verifica la firma, carga la tx, chequea que el user
//      logueado sea el seller del listing, y marca
//      metadata.xololoEventCheckedIn = { at, scannedBy }.
//   4. Si ya estaba checked-in antes, responde alreadyCheckedIn=true con
//      el timestamp original (para que el seller lo vea en rojo).
//
// Contrato:
//   POST /api/event-check-in
//   Body: { token }
//   Auth: user logueado + seller del listing.
//   200 → {
//     ok: true,
//     buyerName,
//     listingTitle,
//     quantity,
//     checkedInAt,            // timestamp del check-in actual (o anterior)
//     alreadyCheckedIn,       // true si ya tenía marca previa
//     previousScannedBy,      // email del operador que escaneó antes
//   }
//   400 → invalid_token · 401 → unauthorized · 403 → not_owner
//   404 → tx_not_found · 410 → token_expired

const { getSdk } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { getAdminEmails } = require('../api-util/adminGate');
const { verifyTicketToken } = require('../api-util/eventTicket');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const token = String(req.body?.token || '').trim();
  if (!token) return res.status(400).json({ error: 'invalid_token' });

  const payload = verifyTicketToken(token);
  if (!payload) {
    return res.status(400).json({ error: 'invalid_token' });
  }

  let userId;
  let userEmail;
  try {
    const sdk = getSdk(req, res);
    const uResp = await sdk.currentUser.show();
    userId = uResp.data.data?.id?.uuid;
    userEmail = uResp.data.data?.attributes?.email || null;
  } catch (e) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!userId) return res.status(401).json({ error: 'unauthorized' });

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    const txResp = await isdk.transactions.show({
      id: payload.txId,
      include: ['customer', 'listing'],
    });
    const tx = txResp.data.data;
    if (!tx) return res.status(404).json({ error: 'tx_not_found' });

    const providerId = tx.relationships?.provider?.data?.id?.uuid;
    const adminEmails = getAdminEmails();
    const isAdmin = !!userEmail && adminEmails.has(String(userEmail).toLowerCase());
    if (providerId !== userId && !isAdmin) {
      // eslint-disable-next-line no-console
      console.warn(
        '[event-check-in] not_owner — user',
        userId?.slice(0, 8) + '…',
        'vs provider',
        providerId?.slice(0, 8) + '…'
      );
      return res.status(403).json({
        error: 'not_owner',
        hint:
          'El QR es de un evento de otro organizador. Debes estar logueado con la cuenta correcta para registrar check-ins.',
      });
    }

    const included = txResp.data.included || [];
    const customer = included.find(
      i => i.type === 'user' && i.id.uuid === tx.relationships?.customer?.data?.id?.uuid
    );
    const listing = included.find(i => i.type === 'listing');
    const buyerName =
      customer?.attributes?.profile?.displayName ||
      customer?.attributes?.profile?.firstName ||
      '(asistente)';
    const listingTitle = listing?.attributes?.title || '(evento)';
    const items = tx.attributes?.lineItems || [];
    const itemLine = items.find(li => li.code === 'line-item/item');
    const quantity = Number(itemLine?.quantity?.toString() || '1');

    const existing = tx.attributes?.metadata?.xololoEventCheckedIn;
    if (existing?.at) {
      return res.json({
        ok: true,
        buyerName,
        listingTitle,
        quantity,
        checkedInAt: existing.at,
        alreadyCheckedIn: true,
        previousScannedBy: existing.scannedBy || null,
      });
    }

    const nowIso = new Date().toISOString();
    try {
      await isdk.transactions.updateMetadata({
        id: payload.txId,
        metadata: {
          xololoEventCheckedIn: {
            at: nowIso,
            scannedBy: userEmail,
            scannedById: userId,
          },
        },
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[event-check-in] updateMetadata failed:', e?.message);
      // Continuamos — devolver que es válido es más útil que fallar
      // completamente. El seller ya vio el nombre y puede dejar pasar.
    }

    return res.json({
      ok: true,
      buyerName,
      listingTitle,
      quantity,
      checkedInAt: nowIso,
      alreadyCheckedIn: false,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[event-check-in] error:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};
