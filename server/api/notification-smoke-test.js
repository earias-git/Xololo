// XOLOLO: endpoint TEMPORAL para smoke-testear el dispatcher de
// notificaciones (D.9 + email branding). Envía un email real via el
// canal email a un destinatario específico simulando el evento
// order.delivered (dual-brand para buyer, Xololo puro para seller).
//
// Contrato:
//   POST /api/notification-smoke-test
//   Body: { token, actor, email, name, sellerName?, sellerLogoUrl?,
//           sellerPrimaryColor?, sellerSecondaryColor?, sellerSlug? }
//   200 → { ok: true, results }
//   401 → { error: 'unauthorized' } — token no coincide
//   400 → { error: 'invalid_request' }
//
// Requiere un shared secret NOTIFICATION_SMOKE_TOKEN configurado en
// Render (o localmente). Se llama con curl:
//
//   curl -sS -X POST 'https://xololo.mx/api/notification-smoke-test' \
//     -H 'Content-Type: application/json' \
//     -d '{"token":"<shared>","actor":"buyer","email":"you@gmail.com","name":"Test Buyer","sellerName":"Kike Pruebas","sellerPrimaryColor":"#0891b2","sellerLogoUrl":"https://media.xololo.mx/stores/6aa85e91-cf52-4550-b08d-47ba93d4e016/logo-1789700752990.png","sellerSlug":"kike-pruebas"}'
//
// TODO: borrar cuando el smoke test pase.

const { sendEventNotifications } = require('../api-util/notifications');

module.exports = async (req, res) => {
  const {
    token,
    actor = 'buyer',
    email,
    name = 'Test User',
    sellerName = 'Xololo Tienda',
    sellerLogoUrl,
    sellerPrimaryColor,
    sellerSecondaryColor,
    sellerSlug = 'test',
  } = req.body || {};

  const expected = process.env.NOTIFICATION_SMOKE_TOKEN;
  if (!expected) {
    return res.status(500).json({ error: 'NOTIFICATION_SMOKE_TOKEN not configured on server' });
  }
  if (!token || token !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'invalid_request', details: 'valid email required' });
  }
  if (actor !== 'buyer' && actor !== 'seller') {
    return res.status(400).json({ error: 'invalid_request', details: 'actor must be buyer or seller' });
  }

  // Armamos un context como el que el webhook Skydropx pasa al dispatcher.
  const context = {
    buyer: {
      name: actor === 'buyer' ? name : 'Comprador de prueba',
      email: actor === 'buyer' ? email : 'no-op@example.com',
    },
    seller: {
      name: actor === 'seller' ? name : sellerName,
      email: actor === 'seller' ? email : 'no-op@example.com',
      logoUrl: sellerLogoUrl,
      primaryColor: sellerPrimaryColor,
      secondaryColor: sellerSecondaryColor,
      slug: sellerSlug,
    },
    listing: { title: 'Jarrón de barro negro (smoke test)' },
    order: { url: 'https://xololo.mx/order/smoke-test-id' },
    carrier: { name: 'ESTAFETA' },
    tracking: { url: 'https://cs.estafeta.com/es/Tracking/searchByGet?wayBill=TEST' },
  };

  const results = await sendEventNotifications('order.delivered', context);
  return res.json({
    ok: true,
    actor,
    email,
    dispatcher: results,
  });
};
