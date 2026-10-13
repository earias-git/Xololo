// XOLOLO feature #28 · F2b. Crea un Stripe Payment Intent para la
// compra de una guía de paquetería pública (no asociada a un listing
// de Sharetribe). Guarda TODO el payload de la guía en la metadata
// del PI — así F2c (post-pago) puede extraer esos datos y llamar a
// Skydropx createShipment sin depender del estado del cliente.
//
// Contrato:
//   POST /api/public-shipping-create-payment
//   Body: {
//     quotationId,          // string, de /api/public-shipping-quote
//     rateId,               // string, el rate elegido por el buyer
//     publicTotal,          // number (MXN) — defensa client-side, el
//                           //   server lo re-valida en F2c re-cotizando
//     parcel: {weight, length, width, height},
//     from: {name, phone, email, street, exterior, interior?, colonia,
//            city, state, postalCode, references?},
//     to:   { ... mismos campos; email opcional },
//     pickupMode: 'dropoff' | 'pickup',
//     contentDescription: string,
//     includeInsurance: bool,
//     declaredValue: number | 0,
//   }
//   200 → { clientSecret, paymentIntentId, amount, currency }
//   400 → { error: 'invalid_request', details }
//   500 → { error: 'stripe_missing' | 'internal' }
//
// Auth: no requiere. La compra es pública. El user se crea DESPUÉS
// del pago exitoso (F2c), no antes — así evitamos crear cuentas
// huérfanas de buyers que inician checkout pero no completan.

const { getStripeBilling } = require('../api-util/stripeBilling');

const toInt = v => Number.parseInt(v, 10);
const isCP = s => /^\d{5}$/.test(String(s || ''));
const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
const nonEmpty = s => typeof s === 'string' && s.trim().length > 0;

const validatePayload = body => {
  if (!body) return 'body requerido.';
  if (!nonEmpty(body.quotationId)) return 'quotationId requerido.';
  if (!nonEmpty(body.rateId)) return 'rateId requerido.';
  if (!(Number(body.publicTotal) > 0)) return 'publicTotal inválido.';
  if (!nonEmpty(body.contentDescription)) return 'contentDescription requerido.';
  const p = body.parcel;
  for (const k of ['weight', 'length', 'width', 'height']) {
    if (!(Number(p?.[k]) > 0)) return `parcel.${k} inválido.`;
  }
  for (const side of ['from', 'to']) {
    const party = body[side];
    if (!party) return `${side} requerido.`;
    if (!nonEmpty(party.name)) return `${side}.name requerido.`;
    if (!nonEmpty(party.phone)) return `${side}.phone requerido.`;
    if (!nonEmpty(party.street)) return `${side}.street requerido.`;
    if (!nonEmpty(party.exterior)) return `${side}.exterior requerido.`;
    if (!nonEmpty(party.colonia)) return `${side}.colonia requerido.`;
    if (!nonEmpty(party.city)) return `${side}.city requerido.`;
    if (!nonEmpty(party.state)) return `${side}.state requerido.`;
    if (!isCP(party.postalCode)) return `${side}.postalCode inválido.`;
    if (side === 'from' && !isEmail(party.email)) return 'from.email inválido.';
  }
  if (!['dropoff', 'pickup'].includes(body.pickupMode)) return 'pickupMode inválido.';
  return null;
};

module.exports = async (req, res) => {
  try {
    const body = req.body || {};
    const err = validatePayload(body);
    if (err) return res.status(400).json({ error: 'invalid_request', details: err });

    const stripe = getStripeBilling();
    if (!stripe) {
      // eslint-disable-next-line no-console
      console.error(
        '[public-shipping-create-payment] STRIPE_SECRET_KEY ausente'
      );
      return res.status(500).json({ error: 'stripe_missing' });
    }

    // Amount en centavos MXN. publicTotal viene ya con margen 12.5%
    // aplicado y seguro opcional incluido (public-shipping-quote).
    // F2c re-cotizará contra Skydropx para defender contra manipulación
    // client-side — hoy confiamos para que el flujo funcione E2E.
    const amount = Math.round(Number(body.publicTotal) * 100);
    const currency = 'mxn';

    // Serializamos todo el payload de la guía como JSON string en una
    // única key `xololo_shipment` del metadata (Stripe limita 500 chars
    // por key individual, pero acepta hasta 50 keys × 500 chars = 25KB
    // en total; usamos una sola key truncada a 450 chars para pequeñas
    // guías y guardamos las partes grandes aparte por key).
    // Para F2b aplicamos un approach pragmático: cada clave corta por
    // separado y las direcciones completas en JSON corto. Si rebasa el
    // límite F2c leerá lo esencial de aquí y re-pedirá el resto al
    // cliente al confirmar.
    const compactParty = p => ({
      n: p.name,
      p: p.phone,
      e: p.email || '',
      s: p.street,
      x: p.exterior,
      i: p.interior || '',
      c: p.colonia,
      ct: p.city,
      st: p.state,
      z: p.postalCode,
      r: p.references || '',
    });
    const compactPayload = {
      q: body.quotationId,
      r: body.rateId,
      pr: body.parcel,
      f: compactParty(body.from),
      t: compactParty(body.to),
      pm: body.pickupMode,
      cd: body.contentDescription,
      i: !!body.includeInsurance,
      dv: Number(body.declaredValue) || 0,
      pt: Number(body.publicTotal),
    };
    const payloadJson = JSON.stringify(compactPayload);

    const metadata = {
      xololoType: 'public_shipping_guide',
      xololoPublicTotalMXN: String(body.publicTotal),
      xololoBuyerEmail: body.from.email,
      xololoBuyerName: body.from.name,
      xololoCarrierRateId: body.rateId,
      xololoQuotationId: body.quotationId,
      xololoFromPostal: body.from.postalCode,
      xololoToPostal: body.to.postalCode,
    };
    // Si el payload cabe (<450 chars) lo guardamos en una sola key.
    // Si no, lo partimos en xololoPayload1..N para rearmar en F2c.
    if (payloadJson.length <= 450) {
      metadata.xololoPayload = payloadJson;
    } else {
      const chunkSize = 450;
      const chunks = Math.ceil(payloadJson.length / chunkSize);
      for (let i = 0; i < chunks; i++) {
        metadata[`xololoPayload${i + 1}`] = payloadJson.slice(
          i * chunkSize,
          (i + 1) * chunkSize
        );
      }
      metadata.xololoPayloadChunks = String(chunks);
    }

    const pi = await stripe.paymentIntents.create({
      amount,
      currency,
      automatic_payment_methods: { enabled: true },
      description: `Guía Xololo · ${body.from.postalCode} → ${body.to.postalCode}`,
      receipt_email: body.from.email,
      metadata,
    });

    return res.json({
      clientSecret: pi.client_secret,
      paymentIntentId: pi.id,
      amount: pi.amount,
      currency: pi.currency,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('public-shipping-create-payment unexpected:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};
