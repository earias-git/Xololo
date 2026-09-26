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

const {
  getQuotationRates,
  SkydropxAuthError,
  SkydropxQuoteError,
  SkydropxTimeoutError,
} = require('../api-util/skydropx');
const { aggregateParcel, parcelDataFromListing } = require('../api-util/cartShipping');
const { getIntegrationSdk } = require('../api-util/integrationSdk');

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

// XOLOLO Cart.6: sanitiza additionalCartItems del body de shipping-quote.
// Espera [{listingId, quantity}]; filtra inválidos y evita duplicar el primary.
const sanitizeAdditionalCartItems = (raw, primaryListingId) => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set([primaryListingId]);
  const cleaned = [];
  for (const it of raw) {
    const id = it?.listingId;
    const qty = Number(it?.quantity);
    if (!id || !Number.isInteger(qty) || qty <= 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    cleaned.push({ listingId: id, quantity: qty });
  }
  return cleaned;
};

module.exports = async (req, res) => {
  try {
    const { listingId, destination, additionalCartItems: rawAdditional } = req.body || {};

    if (!listingId || typeof listingId !== 'string') {
      return res.status(400).json({ error: 'invalid_request', details: 'listingId requerido.' });
    }
    const destErr = validateDestination(destination);
    if (destErr) {
      return res.status(400).json({ error: 'invalid_request', details: destErr });
    }

    const additionalCartRaw = sanitizeAdditionalCartItems(rawAdditional, listingId);
    const primaryQty = Math.max(1, Number(req.body?.quantity) || 1);

    const sdk = getIntegrationSdk();
    if (!sdk) {
      return res.status(500).json({ error: 'internal', details: 'Integration API sin configurar.' });
    }

    // 1) Cargar listing primario con su author, y los adicionales en paralelo.
    let listingResp;
    let additionalResps = [];
    try {
      const promises = [
        sdk.listings.show({ id: listingId, include: ['author'] }),
        // XOLOLO: include=author es necesario para que
        // relationships.author.data.id venga poblado; sin él la
        // validación same-seller de la línea 118 falla siempre porque
        // authorId === undefined !== primaryAuthorId (mismo bug que
        // ya arreglamos en initiate-privileged.js).
        ...additionalCartRaw.map(x =>
          sdk.listings.show({ id: x.listingId, include: ['author'] })
        ),
      ];
      const results = await Promise.all(promises);
      listingResp = results[0];
      additionalResps = results.slice(1);
    } catch (e) {
      if (e.status === 404) return res.status(404).json({ error: 'listing_not_found' });
      throw e;
    }
    const listing = listingResp.data.data;
    const listingPd = listing.attributes.publicData || {};
    const additionalListings = additionalResps.map(r => r.data.data);

    // 2) Validar que el listing primario es cotizable por carrier.
    if (!listingPd.shippingEnabled || listingPd.shippingPricingMode !== 'carrier') {
      return res.status(409).json({
        error: 'listing_not_shippable',
        details: 'El listing no está configurado para cotización por paquetería.',
      });
    }

    // 3) Validar mismo seller para todos los items adicionales — no
    // cotizamos multi-seller (política v1). Si el cliente envía items
    // cross-seller los rechazamos con 400 (el CartPage no debería
    // enviarlos, pero validamos por defensa en profundidad).
    const primaryAuthorId = listing.relationships?.author?.data?.id?.uuid;
    for (const l of additionalListings) {
      const authorId = l.relationships?.author?.data?.id?.uuid;
      if (!primaryAuthorId || authorId !== primaryAuthorId) {
        return res.status(400).json({
          error: 'cart_cross_seller',
          details: 'Los items del carrito deben ser del mismo vendedor.',
          offendingListingId: l.id?.uuid,
        });
      }
    }

    // 4) Sacar el CP de origen del seller.
    const authorResp = await sdk.users.show({ id: primaryAuthorId });
    const authorPd = authorResp.data.data.attributes.profile.publicData || {};
    const originPostalCode = authorPd.originPostalCode;
    if (!originPostalCode || !/^\d{5}$/.test(String(originPostalCode))) {
      return res.status(409).json({
        error: 'origin_not_configured',
        details: 'El seller no configuró un código postal de origen válido en /account/store.',
      });
    }

    // 5) Armar el parcel agregado. Si sólo hay primary → un item; si hay
    // carrito → aggregateParcel apila alturas + suma pesos + max largo/ancho.
    const parcelItems = [
      parcelDataFromListing(listing, primaryQty),
      ...additionalListings.map((l, i) =>
        parcelDataFromListing(l, additionalCartRaw[i].quantity)
      ),
    ];
    let parcel;
    try {
      parcel = aggregateParcel(parcelItems);
    } catch (e) {
      return res.status(409).json({
        error: 'listing_incomplete',
        details: e.message,
      });
    }

    // 6) Cotizar en Skydropx.
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
      parcel,
    });

    return res.json({ quotationId, rates, parcel });
  } catch (e) {
    if (e instanceof SkydropxAuthError) {
      // eslint-disable-next-line no-console
      console.error('shipping-quote SkydropxAuthError:', e.message);
      return res.status(500).json({ error: 'internal' });
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
