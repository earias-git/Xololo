// XOLOLO Junta 2026-10-26 §13: evalúa si un listing es apto para
// envío por paquetería estándar.
//
// Contrato:
//   POST /api/listing-shipping-fit
//   Body: { listingId }      — lee title + description + aiAnalysis del listing
//   O:    { title, description, aiAnalysis }  — evalúa ad hoc (ej. desde el wizard)
//
//   200 → {
//     verdict: 'ok' | 'restricted' | 'prohibited',
//     matched: [{ key, label, severity, advice, matchedKeyword }],
//     allowedMethods: ['skydropxCarrier', 'freight', 'pickup', 'localDelivery'],
//     reason: string | null,
//   }
//
//   400 → { error: 'invalid_request' }
//   404 → { error: 'listing_not_found' }
//   500 → { error: 'internal' }

const { evaluateShippingFit } = require('../../src/util/carrierProhibitedCatalog');
const { getIntegrationSdk } = require('../api-util/integrationSdk');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const { listingId, title, description, aiAnalysis } = req.body || {};

  try {
    // Modo "ad hoc": si vienen title/description, no tocamos SDK.
    if (!listingId && (title || description)) {
      const fit = evaluateShippingFit({ title, description, aiAnalysis });
      return res.json(fit);
    }

    if (!listingId || typeof listingId !== 'string') {
      return res.status(400).json({
        error: 'invalid_request',
        details: 'listingId o {title, description} requerido.',
      });
    }

    const sdk = getIntegrationSdk();
    if (!sdk) {
      return res
        .status(500)
        .json({ error: 'internal', details: 'Integration SDK sin configurar.' });
    }

    const resp = await sdk.listings.show({ id: listingId });
    const listing = resp.data.data;
    if (!listing) return res.status(404).json({ error: 'listing_not_found' });

    const pd = listing.attributes?.publicData || {};
    const fit = evaluateShippingFit({
      title: listing.attributes?.title,
      description: listing.attributes?.description,
      aiAnalysis: pd.aiAnalysis?.aggregated || pd.aiAnalysis || null,
    });
    return res.json(fit);
  } catch (e) {
    if (e?.status === 404) return res.status(404).json({ error: 'listing_not_found' });
    // eslint-disable-next-line no-console
    console.error('[listing-shipping-fit] error:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};
