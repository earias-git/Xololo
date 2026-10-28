// XOLOLO: endpoint que envía (o reenvía) el boleto digital de un
// asistente de evento. Lo invoca el seller DUEÑO del listing desde
// SectionEventAttendeesMaybe con un click.
//
// Contrato:
//   POST /api/seller-event-ticket-send
//   Body: { txId }
//   Auth: seller logueado + dueño del listing de la tx.
//   200 → { ok: true, sentTo: 'email', verifyUrl? }
//   400 → invalid_request | tx_not_from_event | ticket_qr_disabled |
//         no_buyer_email | ticket_signing_unavailable
//   401 → unauthorized · 403 → not_owner · 404 → tx_not_found

const { getSdk } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { getAdminEmails } = require('../api-util/adminGate');
const { sendEventNotifications } = require('../api-util/notifications');
const {
  signTicketToken,
  generateQrPngDataUrl,
  buildTicketBodyHtml,
} = require('../api-util/eventTicket');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const txId = String(req.body?.txId || '').trim();
  if (!txId) return res.status(400).json({ error: 'invalid_request' });

  let userId;
  let userEmail;
  try {
    const sdk = getSdk(req, res);
    const uResp = await sdk.currentUser.show();
    userId = uResp.data.data?.id?.uuid;
    userEmail = String(uResp.data.data?.attributes?.email || '').toLowerCase();
  } catch (e) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!userId) return res.status(401).json({ error: 'unauthorized' });
  const adminEmails = getAdminEmails();
  const isAdmin = !!userEmail && adminEmails.has(userEmail);

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    // 1) Trae tx + listing + buyer (customer) + provider (seller).
    const txResp = await isdk.transactions.show({
      id: txId,
      include: ['listing', 'customer', 'provider'],
    });
    const tx = txResp.data.data;
    if (!tx) return res.status(404).json({ error: 'tx_not_found' });
    const providerId = tx.relationships?.provider?.data?.id?.uuid;
    if (providerId !== userId && !isAdmin) {
      // eslint-disable-next-line no-console
      console.warn(
        '[seller-event-ticket-send] not_owner — user',
        userId?.slice(0, 8) + '…',
        'vs provider',
        providerId?.slice(0, 8) + '…'
      );
      return res.status(403).json({
        error: 'not_owner',
        hint: 'Debes estar logueado como el organizador del evento.',
      });
    }
    const included = txResp.data.included || [];
    const listing = included.find(i => i.type === 'listing');
    const customer = included.find(
      i => i.type === 'user' && i.id.uuid === tx.relationships?.customer?.data?.id?.uuid
    );

    const pd = listing?.attributes?.publicData || {};
    if (!pd.isEvent) return res.status(400).json({ error: 'tx_not_from_event' });
    if (!pd.event?.ticket_qr) {
      return res.status(400).json({
        error: 'ticket_qr_disabled',
        details:
          'Este evento se configuró sin boleto digital con QR. Reeditar el listing en Atributos para activarlo.',
      });
    }

    const buyerEmail = customer?.attributes?.email;
    const buyerName =
      customer?.attributes?.profile?.displayName ||
      customer?.attributes?.profile?.firstName ||
      '(asistente)';
    if (!buyerEmail) return res.status(400).json({ error: 'no_buyer_email' });

    // 2) Firma el token + genera QR.
    const token = signTicketToken({
      txId,
      listingId: listing.id.uuid,
      buyerId: customer.id.uuid,
    });
    if (!token) return res.status(500).json({ error: 'ticket_signing_unavailable' });
    const { dataUrl, verifyUrl } = await generateQrPngDataUrl(token);

    // 3) Lee cantidad del lineItem.
    const items = tx.attributes?.lineItems || [];
    const itemLine = items.find(li => li.code === 'line-item/item');
    const quantity = Number(itemLine?.quantity?.toString() || '1');

    // 4) Dispatch del evento con bodyHtml listo (el template usa pass-through).
    const bodyHtml = buildTicketBodyHtml({
      buyer: { name: buyerName },
      listing: { title: listing.attributes?.title },
      event: pd.event,
      qrDataUrl: dataUrl,
      quantity,
    });

    // Build minimal seller context for dual-brand header.
    const providerUser = included.find(i => i.type === 'user' && i.id.uuid === providerId);
    const sellerContext = {
      id: providerId,
      name:
        providerUser?.attributes?.profile?.displayName ||
        providerUser?.attributes?.profile?.firstName ||
        '',
      email: providerUser?.attributes?.email || null,
      slug: providerUser?.attributes?.profile?.publicData?.slug || null,
      logoUrl: providerUser?.attributes?.profile?.publicData?.logoUrl || null,
      primaryColor: providerUser?.attributes?.profile?.publicData?.brandPrimaryColor || null,
      secondaryColor: providerUser?.attributes?.profile?.publicData?.brandSecondaryColor || null,
    };

    sendEventNotifications('event.ticket_issued', {
      buyer: { id: customer.id.uuid, email: buyerEmail, name: buyerName },
      seller: sellerContext,
      listing: {
        id: listing.id.uuid,
        title: listing.attributes?.title || '',
      },
      event: pd.event,
      ticketBodyHtml: bodyHtml,
    }).catch(e => {
      // eslint-disable-next-line no-console
      console.warn('[seller-event-ticket-send] notify failed:', e?.message);
    });

    return res.json({ ok: true, sentTo: buyerEmail, verifyUrl });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[seller-event-ticket-send] error:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};
