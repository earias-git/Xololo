// XOLOLO feature #28 · F2c. Endpoint de polling para que la pantalla
// de "¡Pago recibido!" sepa cuándo la guía Skydropx ya se generó y
// pueda mostrar el link de descarga del PDF.
//
// Contrato:
//   GET /api/public-shipping-status?pi=pi_xxx
//   200 → {
//     status: 'pending' | 'ready' | 'failed',
//     paymentStatus: 'succeeded' | 'processing' | 'requires_payment_method' | ...,
//     shipmentId?: string,
//     trackingNumber?: string,
//     labelUrl?: string,     // URL firmada de Skydropx para el PDF
//     fulfilledAt?: string,  // ISO
//     carrier?: string,
//     publicTotal?: number,
//   }
//   400 → { error: 'invalid_request' }
//   404 → { error: 'not_found' }   (PI no existe o no es nuestro tipo)
//   500 → { error: 'internal' | 'stripe_missing' }
//
// Idempotente, público (no requiere auth) — el PI id es el "token" de
// consulta. Para seguridad adicional (que sólo el comprador pueda
// consultar) se podría exigir el email como query param y validar
// contra PI.metadata.xololoBuyerEmail. En F2c lo dejamos abierto para
// simplicidad; si abusan, agregamos rate limit o email check.

const { getStripeBilling } = require('../api-util/stripeBilling');
const { fulfillPublicShippingGuide } = require('../api-util/publicShippingFulfill');

module.exports = async (req, res) => {
  try {
    const pi = String(req.query.pi || '').trim();
    if (!/^pi_[A-Za-z0-9]+$/.test(pi)) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    const stripe = getStripeBilling();
    if (!stripe) return res.status(500).json({ error: 'stripe_missing' });

    let paymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.retrieve(pi);
    } catch (e) {
      return res.status(404).json({ error: 'not_found' });
    }
    if (paymentIntent?.metadata?.xololoType !== 'public_shipping_guide') {
      return res.status(404).json({ error: 'not_found' });
    }

    const meta = paymentIntent.metadata || {};
    const paymentStatus = paymentIntent.status;

    // Si el pago está confirmado pero la guía NO se ha generado
    // (webhook aún no procesó / webhook falló), intentamos generarla
    // in-line aquí como fallback. Idempotente — si el webhook se
    // adelantó, es un no-op gracias al check de xololoShipmentId.
    const alreadyGenerated = !!meta.xololoShipmentId;
    if (paymentStatus === 'succeeded' && !alreadyGenerated) {
      const result = await fulfillPublicShippingGuide(paymentIntent);
      if (result.ok) {
        // Refresca el objeto para que la respuesta tenga la data nueva.
        try {
          paymentIntent = await stripe.paymentIntents.retrieve(pi);
        } catch (_e) {}
      }
    }

    const refreshed = paymentIntent.metadata || {};
    const shipmentId = refreshed.xololoShipmentId || null;
    const trackingNumber = refreshed.xololoTrackingNumber || null;
    const labelUrl = refreshed.xololoLabelUrl || null;
    const fulfilledAt = refreshed.xololoFulfilledAt || null;

    let status;
    if (shipmentId && labelUrl) status = 'ready';
    else if (paymentStatus === 'succeeded') status = 'pending';
    else status = 'awaiting_payment';

    return res.json({
      status,
      paymentStatus,
      shipmentId,
      trackingNumber,
      labelUrl,
      fulfilledAt,
      carrierName: refreshed.xololoCarrierName || null,
      carrierService: refreshed.xololoCarrierService || null,
      publicTotal: Number(refreshed.xololoPublicTotalMXN) || null,
      buyerEmail: refreshed.xololoBuyerEmail || null,
      fromPostal: refreshed.xololoFromPostal || null,
      toPostal: refreshed.xololoToPostal || null,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('public-shipping-status unexpected:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};
