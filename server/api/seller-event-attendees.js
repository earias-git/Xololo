// XOLOLO: lista de asistentes confirmados para un listing tipo evento.
//
// Contrato:
//   GET /api/seller-event-attendees?listingId=X
//   Auth: user logueado DUEÑO del listing.
//   200 → {
//     listingId,
//     eventTitle,
//     eventDate: 'YYYY-MM-DD',
//     attendees: [{
//       buyerId, buyerName, buyerEmail,
//       quantity,       // # boletos de esa tx (lineItem/item quantity)
//       totalPaidMxn,   // monto total pagado en pesos
//       txId,           // transaction uuid
//       purchasedAt,    // ISO timestamp
//       state,          // 'completed' | 'delivered' | ...
//     }],
//     totalSeats,       // suma de quantity de todas las tx no canceladas
//   }
//   401 → unauthorized · 403 → not_owner · 400 → not_an_event

const { getSdk, getTrustedSdk } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { getAdminEmails } = require('../api-util/adminGate');

const CANCELED_STATES = new Set(['canceled', 'refunded', 'disputed']);
const PER_PAGE = 100;
const MAX_PAGES = 10;

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const listingId = String(req.query?.listingId || '').trim();
  if (!listingId) return res.status(400).json({ error: 'invalid_request' });

  // XOLOLO: usamos getTrustedSdk (JWT) — es más confiable que getSdk que
  // puede fallar silenciosamente si falta refresh del access token.
  let userId;
  let userEmail;
  try {
    const trustedSdk = await getTrustedSdk(req);
    const uResp = await trustedSdk.currentUser.show();
    userId = uResp.data.data?.id?.uuid;
    userEmail = String(uResp.data.data?.attributes?.email || '').toLowerCase();
  } catch (e) {
    // Fallback: intenta con getSdk clásico por si el browser no tiene JWT
    // (p.ej. caches viejos).
    try {
      const sdk = getSdk(req, res);
      const uResp = await sdk.currentUser.show();
      userId = uResp.data.data?.id?.uuid;
      userEmail = String(uResp.data.data?.attributes?.email || '').toLowerCase();
    } catch (_) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }
  if (!userId) return res.status(401).json({ error: 'unauthorized' });

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    // 1) Trae listing + include author para poder comparar email también.
    const lResp = await isdk.listings.show({ id: listingId, include: ['author'] });
    const listing = lResp.data.data;
    const authorId = listing.relationships?.author?.data?.id?.uuid;
    const authorInc = (lResp.data.included || []).find(
      i => i.type === 'user' && i.id?.uuid === authorId
    );
    const authorEmail = String(authorInc?.attributes?.email || '').toLowerCase();

    const adminEmails = getAdminEmails();
    const isAdmin = !!userEmail && adminEmails.has(userEmail);
    const uuidMatches = authorId === userId;
    // XOLOLO: fallback adicional por email. Si por alguna razón los UUIDs
    // no coinciden (ej. el user tiene 2 accounts Sharetribe con el mismo
    // email, o hay desincronización entre JWT y Integration SDK), igual
    // dejamos pasar si el email del user logueado coincide con el del author.
    const emailMatches = !!userEmail && !!authorEmail && userEmail === authorEmail;

    if (!uuidMatches && !emailMatches && !isAdmin) {
      // eslint-disable-next-line no-console
      console.warn('[seller-event-attendees] not_owner', {
        listingId,
        userId,
        userEmail,
        authorId,
        authorEmail,
      });
      return res.status(403).json({
        error: 'not_owner',
        hint:
          'Debes estar logueado con la cuenta del organizador del evento. ' +
          'Si eres el dueño, revisa que no estés en otra sesión.',
      });
    }
    if (!uuidMatches && emailMatches) {
      // eslint-disable-next-line no-console
      console.info('[seller-event-attendees] matched by email, not uuid', {
        listingId,
        userId,
        authorId,
      });
    }
    const pd = listing.attributes?.publicData || {};
    if (!pd.isEvent) {
      return res.status(400).json({ error: 'not_an_event' });
    }

    // 2) Trae todas las tx del listing (filtered server-side).
    //    Include customer para resolver nombre + email.
    const attendees = [];
    const customerIds = new Set();
    for (let page = 1; page <= MAX_PAGES; page++) {
      const resp = await isdk.transactions.query({
        listingId,
        page,
        perPage: PER_PAGE,
        include: ['customer'],
        'fields.transaction': [
          'createdAt',
          'lastTransitionedAt',
          'state',
          'lastTransition',
          'payinTotal',
          'lineItems',
        ],
      });
      const data = resp.data.data || [];
      const included = resp.data.included || [];
      const customersById = new Map();
      for (const inc of included) {
        if (inc.type === 'user') customersById.set(inc.id.uuid, inc);
      }
      for (const tx of data) {
        const state = tx.attributes?.state;
        if (CANCELED_STATES.has(state)) continue;
        const customerId = tx.relationships?.customer?.data?.id?.uuid;
        if (!customerId) continue;
        customerIds.add(customerId);
        const buyer = customersById.get(customerId);
        const items = tx.attributes?.lineItems || [];
        // Suma la cantidad total de boletos (puede ser > 1 si compró
        // varios en la misma tx).
        const itemLine = items.find(li => li.code === 'line-item/item');
        const quantity = Number(itemLine?.quantity?.toString() || '1');
        const payin = tx.attributes?.payinTotal;
        attendees.push({
          buyerId: customerId,
          buyerName:
            buyer?.attributes?.profile?.displayName ||
            buyer?.attributes?.profile?.firstName ||
            '(sin nombre)',
          buyerEmail: buyer?.attributes?.email || null,
          quantity,
          totalPaidMxn: payin ? Math.round(payin.amount / 100) : 0,
          currency: payin?.currency || 'MXN',
          txId: tx.id?.uuid || tx.id,
          purchasedAt: tx.attributes?.createdAt || null,
          state,
        });
      }
      const totalPages = resp.data.meta?.totalPages || 1;
      if (page >= totalPages) break;
    }

    // 3) Orden: compra más antigua primero (afluencia).
    attendees.sort((a, b) => (a.purchasedAt || '').localeCompare(b.purchasedAt || ''));

    const totalSeats = attendees.reduce((acc, a) => acc + (a.quantity || 1), 0);

    return res.json({
      listingId,
      eventTitle: listing.attributes?.title || '(sin título)',
      eventDate: pd.event?.date_start || null,
      eventTime: pd.event?.time_start || null,
      eventLocation: pd.event?.location || null,
      capacity: pd.event?.capacity || null,
      attendees,
      totalSeats,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[seller-event-attendees] error:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};
