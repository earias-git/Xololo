// XOLOLO: webhook receiver para eventos de tracking de Skydropx.
// Se registra en el dashboard de Skydropx: Conexiones > Webhooks apuntando
// a POST https://xololo.mx/api/webhooks/skydropx con un Bearer token
// compartido (v1) o HMAC-SHA512 (v2). Los eventos que llegan aquí:
//
//   - packages (status: in_transit, out_for_delivery, delivered, in_return, ...)
//   - shipments (creación / cancelación)
//   - orders (para tiendas conectadas — no aplica a Xololo v1)
//   - quotations (completed — no aplica, ya hacemos poll)
//
// Contrato:
//   POST /api/webhooks/skydropx
//   Headers: Authorization: Bearer <SKYDROPX_WEBHOOK_TOKEN>
//   Body: { data: { id, type, attributes, relationships } }
//   200 → { ok: true, processed: bool, reason?: string }
//   401 → { error: 'unauthorized' } — token faltante o inválido
//   422 → { error: 'unhandled_event_type' } — evento que no procesamos (200 en su lugar)
//   200 con reason='no_matching_transaction' — no encontramos tx para ese shipment
//
// Estrategia de persistencia:
// - Al recibir un evento de "packages", buscamos la tx cuya
//   metadata.xololoShippingGuide.shipmentId matchee el shipment del evento
// - Anexamos el evento a metadata.xololoShippingTrackingEvents[] con timestamp
// - Actualizamos metadata.xololoShippingGuide.currentStatus con el status más reciente
// - El timeline (D.7) lee estos eventos para dibujar los 8 estados

const crypto = require('crypto');
const sharetribeSdkIntegration = require('sharetribe-flex-integration-sdk');
const { sendEventNotifications } = require('../../api-util/notifications');

const AUTH_TOKEN = process.env.SKYDROPX_WEBHOOK_TOKEN;

// XOLOLO: mapa Skydropx status → evento de notificación Xololo.
// Cada webhook con un cambio de status dispara la notificación
// correspondiente. Los intermedios (ready_to_pickup, last_mile) se
// silencian para no saturar al buyer.
const STATUS_TO_EVENT = {
  picked_up: 'order.picked_up',
  in_transit: 'order.in_transit',
  out_for_delivery: 'order.out_for_delivery',
  delivered: 'order.delivered',
};

let integrationSdk = null;
const getIntegrationSdk = () => {
  if (integrationSdk) return integrationSdk;
  const clientId = process.env.SHARETRIBE_INTEGRATION_CLIENT_ID;
  const clientSecret = process.env.SHARETRIBE_INTEGRATION_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  integrationSdk = sharetribeSdkIntegration.createInstance({ clientId, clientSecret });
  return integrationSdk;
};

// Validación del token del webhook. Soporta 2 modos:
// 1. Bearer: Authorization: Bearer <SKYDROPX_WEBHOOK_TOKEN>  (default v1)
// 2. HMAC:   Authorization: HMAC <sha512(body, secret) hex>  (v2 futuro)
// timingSafeEqual para evitar timing attacks.
const isAuthenticated = (req, rawBody) => {
  if (!AUTH_TOKEN) {
    // Sin token configurado no rechazamos — permite pruebas iniciales.
    // En prod DEBE estar seteado.
    return true;
  }
  const authHeader = req.headers['authorization'] || '';
  const [scheme, value] = authHeader.split(' ');
  if (!scheme || !value) return false;

  if (scheme === 'Bearer') {
    const a = Buffer.from(value);
    const b = Buffer.from(AUTH_TOKEN);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }
  if (scheme === 'HMAC') {
    const expected = crypto
      .createHmac('sha512', AUTH_TOKEN)
      .update(rawBody)
      .digest('hex');
    const a = Buffer.from(value.toLowerCase());
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }
  return false;
};

// Busca la transacción en Sharetribe cuya xololoShippingGuide.shipmentId
// coincida con el shipment del webhook. Integration API soporta filtrar
// por meta_ (metadata) pero los valores anidados requieren path completo.
// Como fallback listamos las últimas transacciones y filtramos in-memory
// (cabe holgado para v1 con volumen bajo).
const findTransactionByShipmentId = async (sdk, shipmentId) => {
  // Intento 1: query directa por metadata (Sharetribe soporta pub_ y meta_).
  try {
    const resp = await sdk.transactions.query({
      [`meta_xololoShippingGuide`]: shipmentId,
      perPage: 5,
    });
    const found = resp.data.data.find(
      tx => tx.attributes?.metadata?.xololoShippingGuide?.shipmentId === shipmentId
    );
    if (found) return found;
  } catch (e) {
    // Ignora — algunas queries no funcionan si el shape es distinto.
  }

  // Intento 2: paginación con filtro in-memory. Iteramos hasta 500 tx
  // (5 páginas * 100). Aceptable en v1 dado el bajo volumen; si se
  // vuelve un cuello de botella agregamos un índice R2/DB propio.
  for (let page = 1; page <= 5; page++) {
    const resp = await sdk.transactions.query({ page, perPage: 100 });
    const found = resp.data.data.find(
      tx => tx.attributes?.metadata?.xololoShippingGuide?.shipmentId === shipmentId
    );
    if (found) return found;
    if (resp.data.meta?.totalPages <= page) break;
  }
  return null;
};

module.exports = async (req, res) => {
  // El body llega como Buffer (bodyParser.raw). Necesitamos ambos:
  // - Buffer para validar HMAC (bytes exactos)
  // - JSON parseado para procesar
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));

  if (!isAuthenticated(req, rawBody)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch (e) {
    return res.status(400).json({ error: 'invalid_json' });
  }

  const type = payload?.data?.type;
  const attrs = payload?.data?.attributes || {};
  const rels = payload?.data?.relationships || {};

  // Solo procesamos eventos de packages (el resto no aplica a nuestro flow).
  if (type !== 'packages') {
    return res.status(200).json({ ok: true, processed: false, reason: 'ignored_event_type', type });
  }

  const shipmentId = rels?.shipment?.data?.id;
  if (!shipmentId) {
    return res.status(200).json({ ok: true, processed: false, reason: 'no_shipment_id' });
  }

  const sdk = getIntegrationSdk();
  if (!sdk) {
    // eslint-disable-next-line no-console
    console.error('[webhook skydropx] Integration API sin configurar');
    return res.status(500).json({ error: 'integration_api_not_configured' });
  }

  const tx = await findTransactionByShipmentId(sdk, shipmentId);
  if (!tx) {
    // Skydropx puede mandar eventos de shipments creados fuera de Xololo
    // (si compartimos cuenta con otros marketplaces) — devolvemos 200
    // para que Skydropx no reintente indefinidamente.
    return res
      .status(200)
      .json({ ok: true, processed: false, reason: 'no_matching_transaction', shipmentId });
  }

  const currentMeta = tx.attributes.metadata || {};
  const guide = currentMeta.xololoShippingGuide || {};
  const events = Array.isArray(currentMeta.xololoShippingTrackingEvents)
    ? currentMeta.xololoShippingTrackingEvents
    : [];

  const newEvent = {
    receivedAt: new Date().toISOString(),
    status: attrs.status || null,
    packageId: payload?.data?.id,
    trackingNumber: attrs.tracking_number || guide.trackingNumber || null,
    eventDescription: attrs.event_description || null,
    returnedStatus: attrs.returned_status || null,
    returned: !!attrs.returned,
  };

  // Dedupe simple: si el último evento tiene el mismo status y misma
  // descripción, no lo agregamos (evita ruido si Skydropx reintenta).
  const last = events[events.length - 1];
  const isDuplicate =
    last &&
    last.status === newEvent.status &&
    last.eventDescription === newEvent.eventDescription &&
    last.returnedStatus === newEvent.returnedStatus;

  const updatedEvents = isDuplicate ? events : [...events, newEvent];
  const updatedGuide = {
    ...guide,
    currentStatus: newEvent.status || guide.currentStatus,
    lastEventAt: newEvent.receivedAt,
    returned: newEvent.returned || guide.returned || false,
  };

  try {
    await sdk.transactions.updateMetadata({
      id: tx.id.uuid,
      metadata: {
        xololoShippingGuide: updatedGuide,
        xololoShippingTrackingEvents: updatedEvents,
      },
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[webhook skydropx] updateMetadata falló:', e.message);
    // 500 hace que Skydropx reintente — comportamiento deseado.
    return res.status(500).json({ error: 'update_failed' });
  }

  // XOLOLO: dispara notificaciones si el status corresponde a un evento
  // de nuestra matriz (D.9). Fire-and-forget: no bloqueamos el 200.
  const notificationEvent = !isDuplicate && STATUS_TO_EVENT[newEvent.status];
  if (notificationEvent) {
    try {
      // Traer buyer + seller + listing para el context. Fallamos silente
      // si algo no está — las notificaciones no rompen el webhook.
      const [buyerResp, sellerResp, listingResp] = await Promise.all([
        sdk.users.show({ id: tx.relationships?.customer?.data?.id?.uuid }),
        sdk.users.show({ id: tx.relationships?.provider?.data?.id?.uuid }),
        sdk.listings.show({ id: tx.relationships?.listing?.data?.id?.uuid }),
      ]);
      const sellerPd = sellerResp.data.data.attributes?.profile?.publicData || {};
      const context = {
        buyer: {
          name: buyerResp.data.data.attributes?.profile?.displayName,
          email: buyerResp.data.data.attributes?.email,
          whatsapp: buyerResp.data.data.attributes?.profile?.publicData?.whatsapp,
        },
        seller: {
          name: sellerResp.data.data.attributes?.profile?.displayName,
          email: sellerResp.data.data.attributes?.email,
          whatsapp: sellerPd.whatsapp,
          // XOLOLO email branding: pasamos logo + colores del seller para
          // que los emails al BUYER usen dual-brand (seller header +
          // Xololo footer). Ver server/api-util/notifications/emailTemplates.js.
          logoUrl: sellerPd.logoUrl,
          primaryColor: sellerPd.brandPrimaryColor,
          secondaryColor: sellerPd.brandSecondaryColor,
          slug: sellerPd.slug,
        },
        listing: {
          title: listingResp.data.data.attributes?.title,
        },
        order: {
          url: `https://xololo.mx/sale/${tx.id.uuid}/details`,
        },
        carrier: {
          name: updatedGuide.carrierName?.toUpperCase(),
        },
        tracking: {
          url: updatedGuide.trackingUrl,
        },
      };
      // No await al await del dispatcher — fire and forget.
      sendEventNotifications(notificationEvent, context).catch(() => {});
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[webhook skydropx] notifications context failed:', e.message);
    }
  }

  return res.status(200).json({
    ok: true,
    processed: true,
    duplicate: isDuplicate,
    txId: tx.id.uuid,
    status: newEvent.status,
    notificationEvent,
  });
};
