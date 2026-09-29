// XOLOLO Envíos v2: status label específico para el InboxPage
// (buzón del seller/buyer) según modo + sub-etapa + rol. El default
// del template (InboxPage.default-purchase.purchased.status =
// "Esperando la entrega") no distingue entre etapas del fulfillment,
// así que un freight que necesita cotización aparecía igual que un
// pickup que ya está listo — confusión reportada en pruebas.
//
// Retorna un string listo para renderizar, o null cuando aplica usar
// el label del template.

const codeVerified = tx =>
  !!(
    tx?.attributes?.metadata?.xololoDeliveryCodeVerified?.verifiedAt ||
    tx?.attributes?.metadata?.xololoPickupCodeVerified?.verifiedAt
  );

export const getXoloInboxStatusLabel = (tx, transactionRole) => {
  const attrs = tx?.attributes || {};
  // Sólo aplicamos overrides en el state 'purchased' (donde el default
  // "Esperando la entrega" es demasiado genérico).
  const lastTransition = attrs.lastTransition;
  const isPurchased =
    lastTransition === 'transition/confirm-payment' ||
    // Fallback via processName+state cuando la tx viene con más info
    (attrs.processName === 'default-purchase' && attrs.state === 'purchased');
  if (!isPurchased) return null;

  const shipping = attrs.protectedData?.xololoShipping || {};
  const flow = attrs.metadata?.xoloFlow || {};
  const freight = attrs.metadata?.xoloFreight || {};
  const guide = attrs.metadata?.xololoShippingGuide || {};
  const mode = shipping.mode || 'none';
  const isProvider = transactionRole === 'provider';
  const isCustomer = transactionRole === 'customer';

  if (codeVerified(tx)) return 'Entregado — esperando reseña';

  if (mode === 'freight') {
    if (!freight.quotedAt) {
      return isProvider
        ? 'Pendiente enviar cotización de flete'
        : 'Vendedor cotizando envío';
    }
    if (!freight.buyerAuthorizedAt) {
      return isProvider
        ? 'Esperando autorización del comprador'
        : 'Envío cotizado · autoriza el pago';
    }
    if (!flow.readyAt) {
      return isProvider ? 'Prepara el pedido' : 'Vendedor preparando';
    }
    if (!flow.dispatchedAt) {
      return isProvider ? 'Marcar como despachado' : 'Pedido listo';
    }
    return isProvider ? 'Esperando código de entrega' : 'Pedido en camino';
  }

  if (mode === 'pickup') {
    if (!flow.readyAt) {
      return isProvider ? 'Prepara el pedido' : 'Vendedor preparando';
    }
    return isProvider ? 'Esperando código de entrega' : 'Listo para recolectar';
  }

  if (mode === 'localDelivery') {
    if (!flow.readyAt) {
      return isProvider ? 'Prepara el pedido' : 'Vendedor preparando';
    }
    if (!flow.dispatchedAt) {
      return isProvider ? 'Salir a entregar' : 'Pedido listo';
    }
    return isProvider ? 'Esperando código de entrega' : 'Pedido en camino';
  }

  if (mode === 'carrier') {
    if (!guide.trackingNumber) {
      return isProvider ? 'Generar guía de envío' : 'Vendedor preparando la guía';
    }
    if (guide.currentStatus === 'delivered') {
      return 'Entregado — esperando reseña';
    }
    return isProvider ? 'Guía generada' : `Envío en curso · ${guide.currentStatus || 'en tránsito'}`;
  }

  return null;
};
