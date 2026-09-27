// XOLOLO Envíos v2 — Sub-commit C: loop de cotización del método "flete".
//
// Cuando el buyer elige el método "freight" en checkout, la orden se
// procesa con $0 de envío y queda con protectedData.xololoShipping.mode
// === 'freight' + quotePending:true. Este endpoint expone 2 acciones
// que completan el ciclo:
//
//   POST /api/xololo-shipping-quote/submit    (rol: SELLER)
//     Body: { transactionId, amountSubunits, currency?, notes? }
//     Guarda la cotización en metadata.xololoShippingQuote.
//     Notifica al buyer para autorizar.
//
//   POST /api/xololo-shipping-quote/authorize (rol: BUYER)
//     Body: { transactionId }
//     Marca authorizedAt. Notifica al seller para coordinar envío.
//
// Persistencia: metadata (no protectedData). Metadata es editable
// libremente vía Integration SDK sin necesidad de transiciones custom
// del process. Ambas partes de la tx ven la metadata en el GET.
//
// Cobro del envío: v1 = OFFLINE. Seller y buyer coordinan pago por
// WhatsApp/transferencia/etc. La "autorización" del buyer es la
// confirmación de que acepta el monto. v2 puede integrar Stripe
// PaymentIntent para auto-charge — no es alcance de este commit.

const { getSdk } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { sendEventNotifications } = require('../api-util/notifications');

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

const nowIso = () => new Date().toISOString();

// Verifica que el user logueado sea el actor esperado sobre la tx.
// Devuelve { tx, currentUserId, error } — error es un objeto con
// { status, body } para responder directo.
const verifyActor = async (req, expectedRole /* 'provider' | 'customer' */) => {
  const sdk = getSdk(req);
  let currentUserId;
  try {
    const resp = await sdk.currentUser.show();
    currentUserId = resp.data.data.id.uuid;
  } catch (e) {
    return { error: { status: 401, body: { error: 'unauthorized' } } };
  }
  const { transactionId } = req.body || {};
  if (!transactionId || typeof transactionId !== 'string') {
    return { error: { status: 400, body: { error: 'invalid_request', details: 'transactionId requerido.' } } };
  }
  let txResp;
  try {
    txResp = await sdk.transactions.show({
      id: transactionId,
      include: ['provider', 'customer', 'listing'],
    });
  } catch (e) {
    if (e.status === 404) {
      return { error: { status: 404, body: { error: 'transaction_not_found' } } };
    }
    throw e;
  }
  const tx = txResp.data.data;
  const roleUserId = tx.relationships?.[expectedRole]?.data?.id?.uuid;
  if (roleUserId !== currentUserId) {
    return { error: { status: 401, body: { error: 'unauthorized' } } };
  }
  // Precondition: tx debe ser modo freight.
  const xShipping = tx.attributes?.protectedData?.xololoShipping || {};
  if (xShipping.mode !== 'freight') {
    return { error: { status: 409, body: { error: 'not_freight_transaction' } } };
  }
  return { tx, currentUserId, txResp };
};

// Reconstruye el context para sendEventNotifications a partir de la tx.
// Incluye buyer, seller, listing, order (con URL al detalle).
const buildNotifContextFromTx = async (isdk, tx, extras = {}) => {
  const providerId = tx.relationships?.provider?.data?.id?.uuid;
  const customerId = tx.relationships?.customer?.data?.id?.uuid;
  const listingId = tx.relationships?.listing?.data?.id?.uuid;
  const [providerResp, customerResp, listingResp] = await Promise.all([
    providerId ? isdk.users.show({ id: providerId }) : Promise.resolve(null),
    customerId ? isdk.users.show({ id: customerId }) : Promise.resolve(null),
    listingId ? isdk.listings.show({ id: listingId }) : Promise.resolve(null),
  ]);
  const providerAttrs = providerResp?.data?.data?.attributes || {};
  const customerAttrs = customerResp?.data?.data?.attributes || {};
  const listingAttrs = listingResp?.data?.data?.attributes || {};
  const rootUrl = (process.env.REACT_APP_MARKETPLACE_ROOT_URL || 'https://xololo.mx').replace(/\/$/, '');
  return {
    seller: {
      name: providerAttrs.profile?.displayName || 'Vendedor',
      email: providerAttrs.email,
      logoUrl:
        providerAttrs.profile?.publicData?.logoUrl ||
        providerAttrs.profile?.publicData?.brandLogoUrl ||
        null,
      primaryColor: providerAttrs.profile?.publicData?.brandPrimaryColor || null,
      slug: providerAttrs.profile?.publicData?.slug || null,
    },
    buyer: {
      name: customerAttrs.profile?.displayName || 'Comprador',
      email: customerAttrs.email,
    },
    listing: {
      title: listingAttrs.title || 'Producto',
    },
    order: {
      id: tx.id?.uuid,
      url: `${rootUrl}/order/${tx.id?.uuid}`,
    },
    ...extras,
  };
};

const formatMxn = subunits => {
  const n = Number(subunits) || 0;
  return (n / 100).toLocaleString('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

// -------------------------------------------------------------------
// POST /api/xololo-shipping-quote/submit
// -------------------------------------------------------------------
const submit = async (req, res) => {
  try {
    const check = await verifyActor(req, 'provider');
    if (check.error) return res.status(check.error.status).json(check.error.body);
    const { tx } = check;

    const { amountSubunits, currency = 'MXN', notes = '' } = req.body || {};
    const amt = Number(amountSubunits);
    if (!Number.isInteger(amt) || amt <= 0) {
      return res.status(400).json({
        error: 'invalid_request',
        details: 'amountSubunits debe ser un entero > 0 (en centavos).',
      });
    }
    // Rechazamos re-cotizar si ya está autorizado — evita cambiar el monto
    // después de que el buyer aceptó. Sí permite re-cotizar antes de la
    // autorización (el seller puede ajustar si se equivocó).
    const existing = tx.attributes?.metadata?.xololoShippingQuote || {};
    if (existing.authorizedAt) {
      return res.status(409).json({ error: 'already_authorized' });
    }

    const isdk = getIntegrationSdk();
    if (!isdk) return res.status(500).json({ error: 'internal', details: 'Integration SDK ausente.' });

    const merged = {
      ...existing,
      amountSubunits: amt,
      currency,
      notes: String(notes || '').slice(0, 500),
      submittedAt: nowIso(),
      // Preservamos authorizedAt/rejectedAt si existían por alguna razón;
      // en este flow no deberían existir aquí (guardamos arriba con
      // already_authorized) pero es defensivo.
      authorizedAt: existing.authorizedAt || null,
    };
    await isdk.transactions.updateMetadata({
      id: tx.id.uuid,
      metadata: { xololoShippingQuote: merged },
    });

    // Notificación al buyer (email + push cuando estén configurados).
    try {
      const ctx = await buildNotifContextFromTx(isdk, tx, {
        quote: {
          amountLabel: formatMxn(amt),
          notes: merged.notes || null,
        },
      });
      await sendEventNotifications('shipping.quote_ready', ctx);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[shipping-quote.submit] notif falló:', e?.message);
    }

    return res.json({ ok: true, quote: merged });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[shipping-quote.submit] unexpected:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

// -------------------------------------------------------------------
// POST /api/xololo-shipping-quote/authorize
// -------------------------------------------------------------------
const authorize = async (req, res) => {
  try {
    const check = await verifyActor(req, 'customer');
    if (check.error) return res.status(check.error.status).json(check.error.body);
    const { tx } = check;

    const existing = tx.attributes?.metadata?.xololoShippingQuote || {};
    if (!existing.amountSubunits || !existing.submittedAt) {
      return res.status(409).json({ error: 'no_quote_to_authorize' });
    }
    if (existing.authorizedAt) {
      // Idempotencia: si ya autorizó, devolvemos ok para no romper la UI
      // si el buyer da doble-click.
      return res.json({ ok: true, quote: existing, alreadyAuthorized: true });
    }

    const isdk = getIntegrationSdk();
    if (!isdk) return res.status(500).json({ error: 'internal', details: 'Integration SDK ausente.' });

    const merged = {
      ...existing,
      authorizedAt: nowIso(),
    };
    await isdk.transactions.updateMetadata({
      id: tx.id.uuid,
      metadata: { xololoShippingQuote: merged },
    });

    // Notificación al seller.
    try {
      const ctx = await buildNotifContextFromTx(isdk, tx, {
        quote: {
          amountLabel: formatMxn(existing.amountSubunits),
        },
      });
      await sendEventNotifications('shipping.quote_authorized', ctx);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[shipping-quote.authorize] notif falló:', e?.message);
    }

    return res.json({ ok: true, quote: merged });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[shipping-quote.authorize] unexpected:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

module.exports = { submit, authorize };
