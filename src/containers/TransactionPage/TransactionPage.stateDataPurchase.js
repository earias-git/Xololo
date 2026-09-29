import {
  TX_TRANSITION_ACTOR_CUSTOMER as CUSTOMER,
  TX_TRANSITION_ACTOR_PROVIDER as PROVIDER,
  CONDITIONAL_RESOLVER_WILDCARD,
  ConditionalResolver,
} from '../../transactions/transaction';

// XOLOLO Envíos v2 · sub-etapas por método. Se computan a partir del
// modo del envío + los flags de metadata (xoloFlow, xoloFreight,
// xololoShippingGuide) que van avanzando durante el fulfillment.
// La UI (TransactionPanel/CTAs) las lee para renderizar el CTA correcto:
//
//   preparing        → "Proveedor preparando" (sin acción todavía)
//   ready            → producto listo (localDelivery: seller aún no sale;
//                                       pickup: buyer puede ir a recoger)
//   dispatched       → seller en camino (localDelivery/freight/carrier)
//   quoting          → freight: seller debe cotizar
//   quoted           → freight: buyer debe autorizar y pagar
//   authorized       → freight: pagado, seller debe despachar
//   label_pending    → carrier: seller debe generar guía
//   label_ready      → carrier: guía generada, esperando pickup Skydropx
//   awaiting_code    → esperando código de 6 dígitos (final de pickup/
//                       localDelivery/freight antes de MARK_DELIVERED)
//   done             → código verificado o webhook delivered llegó
//   unknown          → modo no reconocido (defensivo)
const computeStage = (mode, flags, deliveryVerified) => {
  if (deliveryVerified) return 'done';
  switch (mode) {
    case 'pickup':
      if (!flags.readyAt) return 'preparing';
      return 'awaiting_code';
    case 'localDelivery':
      if (!flags.readyAt) return 'preparing';
      if (!flags.dispatchedAt) return 'ready';
      return 'awaiting_code';
    case 'carrier':
      if (!flags.trackingNumber) return 'label_pending';
      if (!flags.dispatchedAt) return 'label_ready';
      return 'dispatched';
    case 'freight':
      if (!flags.readyAt) return 'preparing';
      if (!flags.quotedAt) return 'quoting';
      if (!flags.buyerAuthorizedAt) return 'quoted';
      if (!flags.dispatchedAt) return 'authorized';
      return 'awaiting_code';
    default:
      return 'unknown';
  }
};

// Construye el objeto xoloShipping que el TransactionPanel consume.
// El code sólo se expone al customer (buyer) — el seller nunca lo ve,
// sólo lo teclea al momento físico de la entrega.
const buildXoloShippingStateData = (transaction, role) => {
  const attrs = transaction?.attributes || {};
  const pd = attrs.protectedData || {};
  const md = attrs.metadata || {};
  const shipping = pd.xololoShipping || {};
  const flow = md.xoloFlow || {};
  const freight = md.xoloFreight || {};
  const guide = md.xololoShippingGuide || {};
  const verified = md.xololoDeliveryCodeVerified || md.xololoPickupCodeVerified || null;

  const flags = {
    // sub-flags de flujo (server/api/tx-flow.js)
    readyAt: flow.readyAt || null,
    dispatchedAt: flow.dispatchedAt || null,
    // freight (server/api/freight.js + webhook stripe-billing)
    quotedAt: freight.quotedAt || null,
    quotedAmount: freight.quotedAmount || null,
    quotedCurrency: freight.quotedCurrency || null,
    quoteDescription: freight.quoteDescription || null,
    quoteCarrierName: freight.quoteCarrierName || null,
    buyerAuthorizedAt: freight.buyerAuthorizedAt || null,
    freightPaymentIntentId: freight.freightPaymentIntentId || null,
    // Skydropx (server/api/generate-shipping-guide.js + webhook skydropx)
    trackingNumber: guide.trackingNumber || null,
    trackingUrl: guide.trackingUrl || null,
    labelUrl: guide.labelUrl || null,
    currentStatus: guide.currentStatus || null,
    carrierName: guide.carrierName || null,
    serviceName: guide.serviceName || null,
    // verificación final del código
    codeVerifiedAt: verified?.verifiedAt || null,
  };

  const mode = shipping.mode || 'none';
  const stage = computeStage(mode, flags, !!flags.codeVerifiedAt);

  // El código de 6 dígitos SÓLO se expone al customer — el seller lo
  // teclea al momento, no lo ve por adelantado (sería un vector para
  // que confirmara solo). Aceptamos ambos nombres (deliveryCode nuevo
  // y pickupCode legacy) para tx creadas antes del rename del Commit 1.
  const codeShape = shipping.deliveryCode || shipping.pickupCode || null;
  const deliveryCodeForCustomer =
    role === 'customer' && codeShape?.code && !flags.codeVerifiedAt ? codeShape.code : null;

  return {
    mode,
    stage,
    flags,
    deliveryCode: deliveryCodeForCustomer,
    // Metadata útil para la UI del buyer/seller
    zoneDescription: shipping.zoneDescription || null,
    sellerCoversShipping: shipping.sellerCoversShipping || false,
    quotePending: !!shipping.quotePending && !flags.quotedAt,
  };
};

/**
 * Get state data against product process for TransactionPage's UI.
 * I.e. info about showing action buttons, current state etc.
 *
 * @param {*} txInfo detials about transaction
 * @param {*} processInfo  details about process
 */
export const getStateDataForPurchaseProcess = (txInfo, processInfo) => {
  const { transaction, transactionRole, nextTransitions } = txInfo;
  const isProviderBanned = transaction?.provider?.attributes?.banned;
  const _ = CONDITIONAL_RESOLVER_WILDCARD;

  const {
    processName,
    processState,
    states,
    transitions,
    leaveReviewProps,
  } = processInfo;

  return new ConditionalResolver([processState, transactionRole])
    .cond([states.INQUIRY, CUSTOMER], () => {
      const transitionNames = Array.isArray(nextTransitions)
        ? nextTransitions.map(t => t.attributes.name)
        : [];
      const requestAfterInquiry = transitions.REQUEST_PAYMENT_AFTER_INQUIRY;
      const hasCorrectNextTransition = transitionNames.includes(requestAfterInquiry);
      const showOrderPanel = !isProviderBanned && hasCorrectNextTransition;
      return { processName, processState, showOrderPanel };
    })
    .cond([states.INQUIRY, PROVIDER], () => {
      return { processName, processState, showDetailCardHeadings: true };
    })
    .cond([states.PURCHASED, CUSTOMER], () => {
      // XOLOLO: NO mostramos el botón "Recibí mi pedido" al buyer.
      // La entrega se confirma por 2 vías automáticas:
      //   1. Webhook Skydropx con status='delivered' (paquetería)
      //   2. Código de 6 dígitos que el buyer muestra al chofer/seller
      //      en pickup/localDelivery/freight (endpoint /api/verify-delivery-code)
      // Cuando cualquiera dispara, el cron tacit-acceptance transiciona
      // AUTO_MARK_RECEIVED tras 48h si el buyer no respondió encuesta.
      // xoloShipping expone el modo + sub-etapa + flags para que la UI
      // decida qué card mostrar (código, tracking, autorizar pago, etc).
      return {
        processName,
        processState,
        showDetailCardHeadings: true,
        showExtraInfo: true,
        xoloShipping: buildXoloShippingStateData(transaction, 'customer'),
      };
    })
    .cond([states.PURCHASED, PROVIDER], () => {
      // XOLOLO: eliminamos el botón manual "Marcar entregado" del
      // seller. La confirmación de entrega viene por vías automáticas
      // según el método (código o webhook Skydropx). Ver
      // stateDataPurchase.js note en el commit 4.
      // xoloShipping expone el modo + sub-etapa + flags para que la UI
      // decida qué CTA renderizar (mark-ready, quote form, mark-
      // dispatched, code input, etc).
      return {
        processName,
        processState,
        showDetailCardHeadings: true,
        xoloShipping: buildXoloShippingStateData(transaction, 'provider'),
      };
    })
    .cond([states.DELIVERED, CUSTOMER], () => {
      // XOLOLO: en estado DELIVERED, la acción del buyer es responder
      // la encuesta post-entrega (componente PostDeliverySurvey ya en
      // TransactionPage). Ese endpoint dispara MARK_RECEIVED cuando
      // outcome='good', o abre disputa cuando outcome='bad'. No hay
      // botón "Recibí" — la encuesta lo reemplaza.
      // Si el buyer no responde en 48h, cron tacit-acceptance dispara
      // AUTO_MARK_RECEIVED.
      return {
        processName,
        processState,
        showDetailCardHeadings: true,
        showDispute: true,
        // showActionButtons + primaryButtonProps omitidos a propósito
      };
    })
    .cond([states.COMPLETED, _], () => {
      return {
        processName,
        processState,
        showDetailCardHeadings: true,
        showReviewAsFirstLink: true,
        showActionButtons: true,
        primaryButtonProps: leaveReviewProps,
      };
    })
    .cond([states.REVIEWED_BY_PROVIDER, CUSTOMER], () => {
      return {
        processName,
        processState,
        showDetailCardHeadings: true,
        showReviewAsSecondLink: true,
        showActionButtons: true,
        primaryButtonProps: leaveReviewProps,
      };
    })
    .cond([states.REVIEWED_BY_CUSTOMER, PROVIDER], () => {
      return {
        processName,
        processState,
        showDetailCardHeadings: true,
        showReviewAsSecondLink: true,
        showActionButtons: true,
        primaryButtonProps: leaveReviewProps,
      };
    })
    .cond([states.REVIEWED, _], () => {
      return { processName, processState, showDetailCardHeadings: true, showReviews: true };
    })
    .default(() => {
      // Default values for other states
      return { processName, processState, showDetailCardHeadings: true };
    })
    .resolve();
};
