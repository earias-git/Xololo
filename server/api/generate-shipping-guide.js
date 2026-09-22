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

const { getSdk } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const {
  createShipment,
  getShipment,
  SkydropxQuoteError,
  SkydropxTimeoutError,
} = require('../api-util/skydropx');
const { aggregateParcel } = require('../api-util/cartShipping');
const { sendEventNotifications } = require('../api-util/notifications');
const { buildTxContext } = require('../api-util/notifications/context');

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
    // protectedData para que el buyer no las pueda modificar).
    //
    // IMPORTANTE: metadata sólo es visible al operator (Integration API).
    // El sdk normal del provider devolvería `metadata: undefined` — hay
    // que re-leer la tx via Integration SDK. Si no está configurado,
    // rechazamos con error específico para que se logueen las env vars.
    const isdk = getIntegrationSdk();
    if (!isdk) {
      // eslint-disable-next-line no-console
      console.error(
        '[generate-shipping-guide] Integration SDK no configurado; no se puede validar SOS photos'
      );
      return res.status(500).json({
        error: 'internal',
        details: 'Integration SDK sin configurar en el servidor.',
      });
    }
    let sosPhotos = {};
    try {
      const opTxResp = await isdk.transactions.show({ id: transactionId });
      sosPhotos = opTxResp.data.data.attributes.metadata?.xololoShippingSosPhotos || {};
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[generate-shipping-guide] integration tx.show falló', e?.message);
      return res.status(500).json({ error: 'internal' });
    }
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

    // La dirección del buyer viene del form ShippingDetails del checkout.
    // Sharetribe la persiste en tx.protectedData.shippingDetails con este
    // shape anidado (no keys planos):
    //   protectedData.shippingDetails = {
    //     name, phoneNumber,
    //     address: { line1, line2, city, state, postalCode, country }
    //   }
    // Ver src/containers/CheckoutPage/CheckoutPageTransactionHelpers.js
    // (getShippingDetailsMaybe).
    const shippingDetails = tx.attributes.protectedData?.shippingDetails || {};
    const buyerAddress = shippingDetails.address || {};
    // XOLOLO: colonia y referencias las capturamos como campos extra
    // fuera del address estándar de Sharetribe (que no los soporta) —
    // el form ShippingDetails los guarda en protectedData al nivel raíz.
    const buyerColonia = tx.attributes.protectedData?.recipientNeighborhood || '';
    const buyerReferences = tx.attributes.protectedData?.recipientReferences || '';

    const pickupAddr = providerPd.pickupAddress || providerPd.legalAddress || {};
    const pickupRefs = providerPd.pickupReferences || '';

    if (!pickupAddr.street || !pickupAddr.postalCode) {
      return res.status(409).json({
        error: 'seller_address_incomplete',
        details: 'El vendedor no tiene domicilio de recolección configurado.',
      });
    }

    // Validación de la dirección del buyer. name+phone son obligatorios
    // para que la paquetería pueda contactar; line1+city+postalCode+state
    // son obligatorios para poder entregar. Colonia y referencias las
    // pedimos también (LOGISTICS_V1 §5) pero si faltan tiramos default
    // razonable para no bloquear al buyer que ya pagó.
    const missing = [];
    if (!shippingDetails.name) missing.push('nombre');
    if (!shippingDetails.phoneNumber) missing.push('teléfono');
    if (!buyerAddress.line1) missing.push('calle y número');
    if (!buyerAddress.city) missing.push('ciudad');
    if (!buyerAddress.postalCode) missing.push('código postal');
    if (!buyerAddress.state) missing.push('estado');
    if (missing.length > 0) {
      return res.status(409).json({
        error: 'buyer_address_incomplete',
        details: `Faltan campos en la dirección del comprador: ${missing.join(', ')}.`,
        missing,
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

    // XOLOLO: Skydropx impone límites cortos en varios campos del label:
    //   reference: 30 chars max (validado con rechazo real)
    //   further_information: acepta texto largo — sirve como escape
    //     valve para las indicaciones completas del buyer.
    // Truncamos defensivamente para no bloquear la generación de la
    // guía. Guardamos el texto original en la tx sin tocar, así el
    // seller lo sigue viendo completo en su UI.
    const truncate = (s, n) => String(s || '').slice(0, n);

    // Crear el envío en Skydropx.
    const created = await createShipment({
      rateId: xShipping.rate.id,
      quotationId: xShipping.quotationId,
      addressFrom: {
        name: truncate(provider?.attributes?.profile?.displayName || 'Vendedor', 30),
        company: truncate(
          providerPd.legalName || provider?.attributes?.profile?.displayName || 'Vendedor',
          30
        ),
        street1: truncate(`${pickupAddr.street}, ${pickupAddr.colonia}`.trim(), 60),
        reference: truncate(pickupRefs || 'N/D', 30),
        further_information: pickupRefs || undefined,
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
        name: truncate(shippingDetails.name || 'Comprador', 30),
        company: truncate(shippingDetails.name || 'Comprador', 30),
        street1: truncate([buyerAddress.line1, buyerAddress.line2].filter(Boolean).join(', '), 60),
        reference: truncate(buyerReferences || 'N/D', 30),
        further_information: buyerReferences || undefined,
        postal_code: buyerAddress.postalCode,
        area_level1: buyerAddress.state || 'México',
        area_level2: buyerAddress.city,
        // Colonia va como area_level3 si el buyer la capturó; sino
        // fallback a la ciudad (Skydropx exige el campo).
        area_level3: buyerColonia || buyerAddress.city,
        phone: shippingDetails.phoneNumber || '5555555555',
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

    // Persistir en tx.metadata vía Integration SDK. updateMetadata NO
    // existe en el SDK marketplace (sólo en integration) — el
    // trustedSdk devolvería TypeError. Re-usamos la instancia isdk que
    // ya obtuvimos arriba para validar las SOS photos.
    await isdk.transactions.updateMetadata({
      id: transactionId,
      metadata: {
        xololoShippingGuide: guideData,
      },
    });

    // XOLOLO D.9: notificar al buyer con el tracking. Fire-and-forget
    // — el response al seller no debe bloquearse por email/push. Los
    // errores se loguean en el dispatcher, no se propagan.
    //
    // Le pasamos la tx recién actualizada (con el guide ya persistido)
    // para que buildTxContext saque carrier + tracking de metadata.
    // Como acabamos de escribir, hacemos un tx.show fresco.
    (async () => {
      try {
        const fresh = await isdk.transactions.show({ id: transactionId });
        const context = await buildTxContext(isdk, fresh.data.data, {
          buyer: {
            // El shippingDetails.name es lo que el buyer capturó para
            // envío; puede ser más específico que displayName del user.
            name: shippingDetails.name,
          },
        });
        await sendEventNotifications('order.label_generated', context);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[generate-shipping-guide] notify error:', err?.message);
      }
    })();

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
