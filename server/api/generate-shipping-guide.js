// XOLOLO: endpoint que genera la guía Skydropx para una transacción
// existente. Solo el seller (provider) de la transacción puede
// llamarlo. Es la culminación del flujo de fulfillment: al click del
// seller en "Generar guía" en su TransactionPage.
//
// Contrato:
//   POST /api/generate-shipping-guide
//   Body: { transactionId }
//   200 → { shipmentId, trackingNumber, labelUrl, trackingUrl, carrierName, serviceName }
//   400 → { error: 'invalid_request' }
//   401 → { error: 'unauthorized' }
//   404 → { error: 'transaction_not_found' }
//   409 → { error: 'not_shippable' | 'no_rate_selected' | 'already_generated' | 'sos_photos_missing' }
//   422 → { error: 'skydropx_rejected', details }
//   500 → { error: 'internal' }
//
// Precondiciones:
// - La transacción debe estar en estado "paid" (buyer ya pagó).
// - xololoShipping.mode === 'carrier' con un rate.id seleccionado.
// - xololoShipping.sosPhotos debe tener 5 URLs (foto 1..5 con SOS
//   cargadas por el seller antes — D.5b lo carga). Sin esto se
//   rechaza para no invalidar el seguro.
// - Todavía no se ha generado guía (evita duplicados; Skydropx tiene
//   unique_shipment cache 96h, pero también validamos acá).
//
// Al éxito, actualiza tx.protectedData.xololoShipping.guide con:
//   {
//     shipmentId, trackingNumber, labelUrl, trackingUrl,
//     carrierName, serviceName, generatedAt,
//     packagesTracking: [...]  // multi-package si aplica
//   }

const { getSdk, getTrustedSdk } = require('../api-util/sdk');
const {
  createShipment,
  getShipment,
  SkydropxQuoteError,
  SkydropxTimeoutError,
} = require('../api-util/skydropx');
const { aggregateParcel } = require('../api-util/cartShipping');

module.exports = async (req, res) => {
  try {
    const { transactionId } = req.body || {};
    if (!transactionId || typeof transactionId !== 'string') {
      return res.status(400).json({ error: 'invalid_request', details: 'transactionId requerido.' });
    }

    const sdk = getSdk(req, res);

    // Verificar sesión.
    let currentUserResp;
    try {
      currentUserResp = await sdk.currentUser.show();
    } catch (e) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const currentUserId = currentUserResp.data.data.id.uuid;

    // Traer transacción con listing y provider.
    let txResp;
    try {
      txResp = await sdk.transactions.show({
        id: transactionId,
        include: ['listing', 'provider', 'customer'],
      });
    } catch (e) {
      if (e.status === 404) return res.status(404).json({ error: 'transaction_not_found' });
      throw e;
    }
    const tx = txResp.data.data;
    const providerId = tx.relationships?.provider?.data?.id?.uuid;
    const listingId = tx.relationships?.listing?.data?.id?.uuid;

    // Solo el provider (seller) puede generar guía.
    if (providerId !== currentUserId) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const xShipping = tx.attributes.protectedData?.xololoShipping || {};

    if (xShipping.mode !== 'carrier' || !xShipping.rate?.id) {
      return res.status(409).json({
        error: 'not_shippable',
        details: 'Esta transacción no tiene rate carrier para generar guía.',
      });
    }

    if (xShipping.guide?.shipmentId) {
      return res.status(409).json({
        error: 'already_generated',
        details: 'La guía ya fue generada previamente.',
        guide: xShipping.guide,
      });
    }

    // XOLOLO §5: verificar las 5 fotos SOS antes de generar guía.
    // Las fotos las persiste upload-sos-photo.js en
    // tx.metadata.xololoShippingSosPhotos (metadata en vez de
    // protectedData para que sólo trustedSdk pueda escribirlas y
    // el buyer no las pueda modificar).
    const sosPhotos = tx.attributes.metadata?.xololoShippingSosPhotos || {};
    const requiredSlots = [
      'producto', 'embalado', 'guia', 'medidas', 'peso',
    ];
    const missingPhotos = requiredSlots.filter(k => !sosPhotos[k]);
    if (missingPhotos.length > 0) {
      return res.status(409).json({
        error: 'sos_photos_missing',
        details: 'Debes subir las 5 fotos SOS antes de generar la guía.',
        missing: missingPhotos,
      });
    }

    // Traer datos de las 2 partes (provider y customer) para armar las
    // direcciones from/to.
    const included = txResp.data.included || [];
    const provider = included.find(i => i.type === 'user' && i.id.uuid === providerId);
    const customerId = tx.relationships?.customer?.data?.id?.uuid;
    const customer = included.find(i => i.type === 'user' && i.id.uuid === customerId);
    const listing = included.find(i => i.type === 'listing' && i.id.uuid === listingId);

    const providerPd = provider?.attributes?.profile?.publicData || {};
    const providerProtectedData = provider?.attributes?.profile?.privateData || {};
    const shippingDetails = tx.attributes.protectedData || {};

    const pickupAddr = providerPd.pickupAddress || providerPd.legalAddress || {};
    const pickupRefs = providerPd.pickupReferences || '';

    if (!pickupAddr.street || !pickupAddr.postalCode) {
      return res.status(409).json({
        error: 'seller_address_incomplete',
        details: 'El vendedor no tiene domicilio de recolección configurado.',
      });
    }

    // La dirección del buyer viene de ShippingDetails (form del checkout).
    // Sharetribe la persiste en tx.protectedData con estos keys estándar.
    if (
      !shippingDetails.recipientAddressLine1 ||
      !shippingDetails.recipientPostal ||
      !shippingDetails.recipientCity
    ) {
      return res.status(409).json({
        error: 'buyer_address_incomplete',
        details: 'La dirección de entrega del buyer está incompleta en la transacción.',
      });
    }

    const listingPrice = listing?.attributes?.price?.amount
      ? listing.attributes.price.amount / 100
      : 0;
    const listingTitle = listing?.attributes?.title || 'Producto';

    // XOLOLO Cart.6: agregar peso/dimensiones de TODOS los items del
    // carrito para construir el parcel real. El primary listing sale
    // del `included`; los items extra salen del snapshot xololoCart en
    // protectedData (grabado por initiate-privileged en Cart.5).
    //
    // Se usa el MISMO modelo que en shipping-quote (aggregateParcel:
    // max largo, max ancho, sum alto, sum peso) para que el rate ya
    // pagado por el buyer aplique al parcel real que se genera.
    const listingPd = listing?.attributes?.publicData || {};
    const xCart = tx.attributes.protectedData?.xololoCart || null;

    // Primary quantity: buscamos la primera línea 'line-item/item' de
    // customer+provider (no shipping/commission).
    const primaryLine = (tx.attributes.lineItems || []).find(
      li =>
        li.code === 'line-item/item' &&
        (li.includeFor || []).includes('customer') &&
        (li.includeFor || []).includes('provider')
    );
    const primaryQty = Math.max(1, Number(primaryLine?.quantity) || 1);

    const parcelItems = [
      {
        listingId: listingId,
        title: listingTitle,
        weightGrams: listingPd.weightGrams,
        dimensionLengthCm: listingPd.dimensionLengthCm,
        dimensionWidthCm: listingPd.dimensionWidthCm,
        dimensionHeightCm: listingPd.dimensionHeightCm,
        quantity: primaryQty,
      },
      ...(xCart?.items || []).map(i => ({
        listingId: i.listingId,
        title: i.title,
        weightGrams: i.weightGrams,
        dimensionLengthCm: i.dimensionLengthCm,
        dimensionWidthCm: i.dimensionWidthCm,
        dimensionHeightCm: i.dimensionHeightCm,
        quantity: i.quantity,
      })),
    ];

    let aggregatedParcel;
    try {
      aggregatedParcel = aggregateParcel(parcelItems);
    } catch (e) {
      return res.status(409).json({
        error: 'cart_parcel_incomplete',
        details: e.message,
      });
    }

    // Suma el valor declarado (declared_value) para SOS: primary + carrito.
    const cartExtraValueMXN = (xCart?.items || []).reduce(
      (sum, i) => sum + (Number(i.priceInSubunits) || 0) * (Number(i.quantity) || 1),
      0
    ) / 100;
    const declaredValueTotal = listingPrice * primaryQty + cartExtraValueMXN;

    // Content del carta porte: concatena títulos truncando a 100 chars.
    const cartTitles = (xCart?.items || []).map(i => i.title).filter(Boolean);
    const consignmentNoteContent = [listingTitle, ...cartTitles]
      .join(', ')
      .slice(0, 100);

    // Crear el envío en Skydropx.
    const created = await createShipment({
      rateId: xShipping.rate.id,
      quotationId: xShipping.quotationId,
      addressFrom: {
        name: provider?.attributes?.profile?.displayName || 'Vendedor',
        company: providerPd.legalName || provider?.attributes?.profile?.displayName || 'Vendedor',
        street1: `${pickupAddr.street}, ${pickupAddr.colonia}`.trim(),
        reference: pickupRefs || 'N/D',
        postal_code: pickupAddr.postalCode,
        area_level1: pickupAddr.state,
        area_level2: pickupAddr.city,
        area_level3: pickupAddr.colonia,
        phone: providerPd.whatsapp || '5555555555',
        email:
          providerProtectedData.email ||
          provider?.attributes?.email ||
          'vendedor@xololo.mx',
      },
      addressTo: {
        name: shippingDetails.recipientName || 'Comprador',
        company: shippingDetails.recipientName || 'Comprador',
        street1: [shippingDetails.recipientAddressLine1, shippingDetails.recipientAddressLine2]
          .filter(Boolean)
          .join(', '),
        reference: 'N/D',
        postal_code: shippingDetails.recipientPostal,
        area_level1: shippingDetails.recipientState || 'México',
        area_level2: shippingDetails.recipientCity,
        area_level3: shippingDetails.recipientCity, // fallback si no capturamos colonia
        phone: shippingDetails.recipientPhoneNumber || '5555555555',
        email: customer?.attributes?.email || 'comprador@xololo.mx',
      },
      parcels: [aggregatedParcel],
      declaredValue: declaredValueTotal,
      consignmentNoteContent,
    });

    const shipmentId = created?.data?.id;
    if (!shipmentId) {
      return res.status(500).json({
        error: 'internal',
        details: 'Skydropx no devolvió shipment id.',
      });
    }

    // Poll para obtener label_url (Skydropx la genera async ~2-5s).
    const withLabel = await getShipment(shipmentId, { poll: true, maxPollMs: 20000 });
    const shipAttrs = withLabel.data.attributes;
    const packages = (withLabel.included || []).filter(i => i.type === 'package');
    const firstPkg = packages[0]?.attributes || {};

    const guideData = {
      shipmentId,
      trackingNumber: shipAttrs.master_tracking_number || firstPkg.tracking_number,
      labelUrl: firstPkg.label_url,
      trackingUrl: firstPkg.tracking_url_provider,
      carrierName: shipAttrs.carrier_name,
      serviceName: shipAttrs.service_name,
      generatedAt: new Date().toISOString(),
      packagesTracking: packages.map(p => ({
        id: p.id,
        trackingNumber: p.attributes.tracking_number,
        labelUrl: p.attributes.label_url,
      })),
    };

    // Persistir en tx.protectedData vía trustedSdk (metadata pública
    // no la puede tocar el provider directo — trusted SDK sí).
    const trustedSdk = await getTrustedSdk(req);
    await trustedSdk.transactions.updateMetadata({
      id: transactionId,
      metadata: {
        xololoShippingGuide: guideData,
      },
    });

    return res.json(guideData);
  } catch (e) {
    if (e instanceof SkydropxQuoteError) {
      // eslint-disable-next-line no-console
      console.error('generate-shipping-guide Skydropx rechazó:', e.details);
      return res.status(422).json({ error: 'skydropx_rejected', details: e.details });
    }
    if (e instanceof SkydropxTimeoutError) {
      return res.status(504).json({ error: 'label_timeout', details: e.message });
    }
    // eslint-disable-next-line no-console
    console.error('generate-shipping-guide unexpected:', e);
    return res.status(500).json({ error: 'internal' });
  }
};
