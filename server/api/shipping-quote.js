// XOLOLO: endpoint que cotiza el envío por paquetería para un listing.
//
// Contrato:
//   POST /api/shipping-quote
//   Body: {
//     listingId,           // uuid del listing
//     destination: {
//       postal_code,        // 5 dígitos
//       area_level1,        // estado (ej. "Veracruz")
//       area_level2,        // municipio (ej. "Xalapa")
//       area_level3,        // colonia (ej. "Centro")
//     }
//   }
//   200 → { rates: [{ id, carrier, service, total, currency, days, ... }], quotationId }
//   400 → { error: 'invalid_request', details }
//   404 → { error: 'listing_not_found' } | { error: 'seller_not_found' }
//   409 → { error: 'origin_not_configured' } — el seller no puso su CP en /account/store
//   409 → { error: 'listing_not_shippable' } — el listing no está en modo carrier
//   422 → { error: 'quote_failed', details } — Skydropx rechazó la cotización
//   500 → { error: 'internal' }
//
// Auth: no requiere auth de buyer (puede cotizarse sin haberse logueado).
// Rate limit: Skydropx tiene 2 req/s por credencial — para v1 no lo
// respetamos aquí porque tráfico será bajo.

const sharetribeIntegrationSdk = require('sharetribe-flex-integration-sdk');
const {
  getQuotationRates,
  SkydropxAuthError,
  SkydropxQuoteError,
  SkydropxTimeoutError,
} = require('../api-util/skydropx');

let integrationSdk = null;
const getIntegrationSdk = () => {
  if (integrationSdk) return integrationSdk;
  const clientId = process.env.SHARETRIBE_INTEGRATION_CLIENT_ID;
  const clientSecret = process.env.SHARETRIBE_INTEGRATION_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  integrationSdk = sharetribeIntegrationSdk.createInstance({ clientId, clientSecret });
  return integrationSdk;
};

const validateDestination = dest => {
  if (!dest) return 'destination requerido.';
  const { postal_code, area_level1, area_level2, area_level3 } = dest;
  if (!postal_code || !/^\d{5}$/.test(String(postal_code))) {
    return 'destination.postal_code debe ser 5 dígitos.';
  }
  if (!area_level1 || !area_level2 || !area_level3) {
    return 'destination.area_level1/2/3 son requeridos (estado, municipio, colonia).';
  }
  return null;
};

module.exports = async (req, res) => {
  try {
    const { listingId, destination } = req.body || {};

    if (!listingId || typeof listingId !== 'string') {
      return res.status(400).json({ error: 'invalid_request', details: 'listingId requerido.' });
    }
    const destErr = validateDestination(destination);
    if (destErr) {
      return res.status(400).json({ error: 'invalid_request', details: destErr });
    }

    const sdk = getIntegrationSdk();
    if (!sdk) {
      return res.status(500).json({ error: 'internal', details: 'Integration API sin configurar.' });
    }

    // 1) Cargar listing con su author.
    let listingResp;
    try {
      listingResp = await sdk.listings.show({ id: listingId, include: ['author'] });
    } catch (e) {
      if (e.status === 404) return res.status(404).json({ error: 'listing_not_found' });
      throw e;
    }
    const listing = listingResp.data.data;
    const listingPd = listing.attributes.publicData || {};

    // 2) Validar que el listing es cotizable por carrier.
    if (!listingPd.shippingEnabled || listingPd.shippingPricingMode !== 'carrier') {
      return res.status(409).json({
        error: 'listing_not_shippable',
        details: 'El listing no está configurado para cotización por paquetería.',
      });
    }
    const { weightGrams, dimensionLengthCm, dimensionWidthCm, dimensionHeightCm } = listingPd;
    if (!weightGrams || !dimensionLengthCm || !dimensionWidthCm || !dimensionHeightCm) {
      return res.status(409).json({
        error: 'listing_incomplete',
        details: 'El listing no tiene peso o dimensiones definidos.',
      });
    }

    // 3) Sacar el CP de origen del seller.
    const authorId = listingResp.data.data.relationships.author.data.id.uuid;
    const authorResp = await sdk.users.show({ id: authorId });
    const authorPd = authorResp.data.data.attributes.profile.publicData || {};
    const originPostalCode = authorPd.originPostalCode;
    if (!originPostalCode || !/^\d{5}$/.test(String(originPostalCode))) {
      return res.status(409).json({
        error: 'origin_not_configured',
        details: 'El seller no configuró un código postal de origen válido en /account/store.',
      });
    }

    // 4) Cotizar en Skydropx.
    // Skydropx requiere area_level1/2/3 en el origen también; usamos placeholders
    // razonables por ahora (el nombre del seller / storefront). En una futura
    // iteración pedimos al seller estos datos en el form del store para más
    // precisión de cotización.
    const { rates, quotationId } = await getQuotationRates({
      from: {
        postal_code: String(originPostalCode),
        area_level1: authorPd.originArea1 || 'México',
        area_level2: authorPd.originArea2 || 'México',
        area_level3: authorPd.originArea3 || 'Centro',
      },
      to: {
        postal_code: String(destination.postal_code),
        area_level1: String(destination.area_level1),
        area_level2: String(destination.area_level2),
        area_level3: String(destination.area_level3),
      },
      parcel: {
        length: Number(dimensionLengthCm),
        width: Number(dimensionWidthCm),
        height: Number(dimensionHeightCm),
        weight: Number(weightGrams) / 1000, // gramos → kg
      },
    });

    return res.json({ quotationId, rates });
  } catch (e) {
    if (e instanceof SkydropxAuthError) {
      return res.status(500).json({ error: 'internal', details: 'Auth Skydropx falló.' });
    }
    if (e instanceof SkydropxQuoteError) {
      return res.status(422).json({ error: 'quote_failed', details: e.details || e.message });
    }
    if (e instanceof SkydropxTimeoutError) {
      return res.status(504).json({ error: 'quote_timeout', details: e.message });
    }
    // eslint-disable-next-line no-console
    console.error('shipping-quote unexpected error:', e);
    return res.status(500).json({ error: 'internal' });
  }
};
