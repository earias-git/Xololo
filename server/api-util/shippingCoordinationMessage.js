// XOLOLO · Mensaje automático de coordinación al confirmar la orden.
//
// Para los métodos de envío que requieren contacto directo buyer↔seller
// (pickup, localDelivery, freight), enviamos UN mensaje al chat de la
// transacción justo después de que el pago se confirma. Así los dos
// lados tienen un recordatorio en el buzón para coordinar horarios y
// detalles sin tener que acordarse ellos mismos.
//
// Para skydropxCarrier NO se manda — ese flujo es automático (guía
// generada por Xololo, tracking, no requiere coordinación directa).
//
// IMPORTANTE: el mensaje viaja con el trustedSdk del BUYER (es quien
// está haciendo la confirmación de pago). Por eso aparece "de parte"
// del buyer en el chat. Lo prefijamos con "📬 Mensaje automático de
// Xololo" para que la intención sea clara. Si en el futuro queremos un
// user-system real, hay que crear un bot y usar Integration SDK + su
// token para enviar — por ahora, workaround pragmático.
//
// Fire-and-forget: cualquier error solo se loguea. El send NO bloquea
// la respuesta de la transacción, porque la orden ya se concretó.

const buildContent = mode => {
  const base =
    '📬 Mensaje automático de Xololo:\n\n' +
    'Este pedido ya está confirmado. Usen este chat para coordinar los ' +
    'detalles de ';
  if (mode === 'pickup') {
    return (
      base +
      'la RECOLECCIÓN en el domicilio del vendedor: fecha, horario y ' +
      'cualquier instrucción adicional. El vendedor ya puede ver tu pedido ' +
      'en su panel.'
    );
  }
  if (mode === 'localDelivery') {
    return (
      base +
      'la ENTREGA LOCAL: fecha, horario, dirección exacta y referencias. ' +
      'El vendedor entregará el pedido en la zona acordada.'
    );
  }
  if (mode === 'freight') {
    return (
      base +
      'el ENVÍO POR FLETE: el vendedor cotizará el costo del flete y lo ' +
      'compartirá por aquí para que lo autorices antes del envío.'
    );
  }
  return null;
};

const MODES_REQUIRING_COORDINATION = ['pickup', 'localDelivery', 'freight'];

/**
 * Envía un mensaje automático al chat de la transacción si el método
 * de envío requiere coordinación directa buyer↔seller.
 *
 * @param {Object} trustedSdk - Trusted SDK ya instanciado para el user actual
 * @param {string} transactionId - UUID string de la transacción
 * @param {string} mode - 'pickup' | 'localDelivery' | 'skydropxCarrier' | 'freight'
 * @returns {Promise<void>} Fire-and-forget. Nunca throw.
 */
const sendShippingCoordinationMessage = async (trustedSdk, transactionId, mode) => {
  if (!trustedSdk || !transactionId) return;
  if (!MODES_REQUIRING_COORDINATION.includes(mode)) return;
  const content = buildContent(mode);
  if (!content) return;
  try {
    await trustedSdk.messages.send({ transactionId, content });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[shipping-coordination-msg] failed to send', err?.status, err?.message || err);
  }
};

module.exports = { sendShippingCoordinationMessage, MODES_REQUIRING_COORDINATION };
