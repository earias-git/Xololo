// XOLOLO feature #28 · F2c. Fulfillment de una compra pública de guía:
// después del pago exitoso de Stripe, rehidrata el payload desde la
// metadata del PI, llama a Skydropx.createShipment para generar la
// guía real, y guarda el resultado (shipmentId, trackingNumber,
// labelUrl, status) de vuelta en la metadata del PI para que el
// frontend lo lea vía /api/public-shipping-status.
//
// Idempotente: si el PI ya tiene xololoShipmentId, no vuelve a generar.
//
// Lo que NO hace (queda para F3):
//   - Crear el user Sharetribe + mandar email de activación.
//   - Mandar el email con la guía adjunta + email de tracking.
//
// Estos dos salen del scope de F2c para mantener el commit chico y
// porque el user y los emails requieren configurar templates aparte.

const { getStripeBilling } = require('./stripeBilling');
const { createShipment, SkydropxQuoteError } = require('./skydropx');

// Rehidrata el payload compacto que guardamos en PI metadata al crear
// el pago. Puede venir en `xololoPayload` (una sola key si ≤450 chars)
// o repartido en `xololoPayload1..N` si fue más largo.
const extractPayload = metadata => {
  if (!metadata) return null;
  if (metadata.xololoPayload) {
    try {
      return JSON.parse(metadata.xololoPayload);
    } catch (_e) {
      return null;
    }
  }
  const chunks = Number(metadata.xololoPayloadChunks) || 0;
  if (chunks > 0) {
    let joined = '';
    for (let i = 1; i <= chunks; i++) {
      const part = metadata[`xololoPayload${i}`];
      if (part == null) return null;
      joined += part;
    }
    try {
      return JSON.parse(joined);
    } catch (_e) {
      return null;
    }
  }
  return null;
};

// Convierte el shape compacto { n, p, e, s, x, i, c, ct, st, z, r }
// que guardamos en metadata a los campos legibles.
const expandParty = p => ({
  name: p.n,
  phone: p.p,
  email: p.e || '',
  street: p.s,
  exterior: p.x,
  interior: p.i || '',
  colonia: p.c,
  city: p.ct,
  state: p.st,
  postalCode: p.z,
  references: p.r || '',
});

const truncate = (s, n) => String(s || '').slice(0, n);

/**
 * Dado un Stripe PaymentIntent ya pagado y con metadata xololoType =
 * 'public_shipping_guide', genera la guía Skydropx y guarda shipmentId
 * + tracking + label en el PI metadata.
 *
 * Idempotente: no re-genera si ya se generó.
 *
 * @param {Stripe.PaymentIntent} pi
 * @returns {Promise<{ok:true, shipmentId, trackingNumber, labelUrl, skipped?:'already_fulfilled'|'invalid_payload'}>}
 */
const fulfillPublicShippingGuide = async pi => {
  const meta = pi?.metadata || {};
  // Idempotencia: si ya hay shipmentId en la metadata, no re-generar.
  if (meta.xololoShipmentId) {
    return {
      ok: true,
      skipped: 'already_fulfilled',
      shipmentId: meta.xololoShipmentId,
      trackingNumber: meta.xololoTrackingNumber || null,
      labelUrl: meta.xololoLabelUrl || null,
    };
  }

  const payload = extractPayload(meta);
  if (!payload) {
    // eslint-disable-next-line no-console
    console.error(
      '[public-shipping-fulfill] payload no se pudo rehidratar desde PI metadata',
      pi.id
    );
    return { ok: false, skipped: 'invalid_payload' };
  }

  const from = expandParty(payload.f);
  const to = expandParty(payload.t);
  const parcel = payload.pr;
  const declaredValue = Number(payload.dv) || 0;
  const insurance = !!payload.i;

  try {
    const created = await createShipment({
      rateId: payload.r,
      quotationId: payload.q,
      addressFrom: {
        name: truncate(from.name, 30),
        company: truncate(from.name, 30),
        street1: truncate(
          [from.street, from.exterior, from.interior, from.colonia].filter(Boolean).join(' '),
          60
        ),
        reference: truncate(from.references || 'N/D', 30),
        further_information: from.references || undefined,
        postal_code: from.postalCode,
        area_level1: from.state,
        area_level2: from.city,
        area_level3: from.colonia,
        phone: from.phone || '5555555555',
        email: from.email || 'remitente@xololo.mx',
      },
      addressTo: {
        name: truncate(to.name, 30),
        company: truncate(to.name, 30),
        street1: truncate(
          [to.street, to.exterior, to.interior, to.colonia].filter(Boolean).join(' '),
          60
        ),
        reference: truncate(to.references || 'N/D', 30),
        further_information: to.references || undefined,
        postal_code: to.postalCode,
        area_level1: to.state,
        area_level2: to.city,
        area_level3: to.colonia,
        phone: to.phone || '5555555555',
        email: to.email || 'destinatario@xololo.mx',
      },
      parcels: [
        {
          length: Number(parcel.length),
          width: Number(parcel.width),
          height: Number(parcel.height),
          weight: Number(parcel.weight),
        },
      ],
      declaredValue: insurance ? declaredValue : 0,
      insurance,
      consignmentNoteContent: truncate(payload.cd || 'Mercancía general', 60),
      // Pickup y auto_advance se dejan a los defaults (sandbox simula
      // tracking; en prod el carrier mueve el shipment real).
    });

    const shipment = created?.data || created;
    const shipmentId = shipment?.id || shipment?.data?.id;
    const trackingNumber =
      shipment?.attributes?.tracking_number ||
      shipment?.tracking_number ||
      null;
    const labelUrl =
      shipment?.attributes?.label_url ||
      shipment?.label_url ||
      shipment?.attributes?.label?.url ||
      null;

    if (!shipmentId) {
      // eslint-disable-next-line no-console
      console.error(
        '[public-shipping-fulfill] Skydropx respondió pero no devolvió shipment id',
        JSON.stringify(created).slice(0, 400)
      );
      return { ok: false, skipped: 'no_shipment_id' };
    }

    // Persistir en el PI metadata para que /api/public-shipping-status
    // lo pueda leer y para que /ops haga reporting.
    const stripe = getStripeBilling();
    if (stripe) {
      try {
        await stripe.paymentIntents.update(pi.id, {
          metadata: {
            ...meta,
            xololoShipmentId: String(shipmentId),
            xololoTrackingNumber: trackingNumber || '',
            xololoLabelUrl: labelUrl || '',
            xololoFulfilledAt: new Date().toISOString(),
          },
        });
      } catch (e) {
        // No bloqueante: la guía ya está creada, no haber podido
        // persistir en el PI metadata sólo afecta polling/UI; el
        // email (F3) y /ops igual pueden recuperarla desde Skydropx.
        // eslint-disable-next-line no-console
        console.error(
          '[public-shipping-fulfill] no se pudo actualizar PI metadata:',
          e?.message
        );
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      '[public-shipping-fulfill] guía generada',
      JSON.stringify({
        pi: pi.id,
        shipmentId,
        trackingNumber,
        labelPresent: !!labelUrl,
      })
    );
    return { ok: true, shipmentId, trackingNumber, labelUrl };
  } catch (e) {
    if (e instanceof SkydropxQuoteError) {
      // eslint-disable-next-line no-console
      console.error(
        '[public-shipping-fulfill] Skydropx rechazó shipment:',
        e.details || e.message
      );
      return { ok: false, skipped: 'skydropx_error', error: e.message };
    }
    // eslint-disable-next-line no-console
    console.error('[public-shipping-fulfill] excepción:', e?.message);
    return { ok: false, skipped: 'exception', error: e?.message };
  }
};

module.exports = {
  fulfillPublicShippingGuide,
  extractPayload,
  expandParty,
};
