// XOLOLO: dispatcher central de notificaciones cross-canal.
// Ver docs/LOGISTICS_V1.md §6 y la matriz canal × evento.
//
// Uso:
//   const { sendEventNotifications } = require('./api-util/notifications');
//   await sendEventNotifications('order.paid', {
//     transaction, buyer, seller, listing,
//   });
//
// Cada evento tiene:
//   - qué actores reciben (buyer, seller)
//   - por qué canales (email, push, whatsapp) según matriz
//   - templates específicos por canal
//
// v1 usa 3 canales, todos in-house (sin proveedores externos):
//   - email:    Sharetribe transactional email API (ya disponible)
//   - push:     web-push npm library (browser web push)
//   - whatsapp: Meta Cloud API directa
//
// Los canales que no están configurados (env vars ausentes) se
// skippean silenciosamente. El dispatcher NUNCA rompe el flow
// principal — errors se loguean pero no se propagan.

const email = require('./channels/email');
const push = require('./channels/push');
const whatsapp = require('./channels/whatsapp');
const templates = require('./templates');

// Matriz canal × evento (docs/LOGISTICS_V1.md §6):
// Cada evento define para cada actor {buyer, seller} qué canales dispara.
// Los canales son ['email', 'push', 'whatsapp']. Vacio = no notifica.
const MATRIX = {
  'order.paid': {
    buyer: ['email', 'push', 'whatsapp'],
    seller: ['email', 'push', 'whatsapp'],
  },
  'order.label_generated': {
    buyer: ['email', 'push'],
  },
  'order.label_pending': {
    seller: ['email', 'push'],
  },
  'order.picked_up': {
    buyer: ['email', 'push'],
    seller: ['email', 'push'],
  },
  'order.in_transit': {
    buyer: ['email'],
  },
  'order.out_for_delivery': {
    buyer: ['email', 'push', 'whatsapp'],
  },
  'order.delivered': {
    buyer: ['email', 'push', 'whatsapp'],
    seller: ['email', 'push', 'whatsapp'],
  },
  'order.review_open': {
    buyer: ['email', 'push'],
  },
  'order.tacit_acceptance': {
    seller: ['email', 'whatsapp'],
  },
  'order.dispute_opened': {
    buyer: ['email', 'push', 'whatsapp'],
    seller: ['email', 'push', 'whatsapp'],
  },
  'order.dispute_resolved': {
    buyer: ['email', 'push', 'whatsapp'],
    seller: ['email', 'push', 'whatsapp'],
  },
  'order.refund_issued': {
    buyer: ['email', 'push', 'whatsapp'],
  },
  'seller.first_sale': {
    seller: ['email', 'push', 'whatsapp'],
  },
  'seller.monthly_report': {
    seller: ['email'],
  },
  // XOLOLO Track C (docs/SUBSCRIPTIONS_V1.md §3.6): eventos de
  // suscripción, disparados desde server/api/webhooks/stripe-billing.js.
  // 'seller.subscription_suspended' se agrega cuando exista el gate
  // real de publicación (roadmap #6) — sin eso todavía no hay nada
  // concreto que avisar más allá de payment_failed_warning.
  'seller.subscription_started': {
    seller: ['email'],
  },
  'seller.payment_failed_warning': {
    seller: ['email', 'push'],
  },
  'seller.subscription_canceled': {
    seller: ['email'],
  },
};

const CHANNELS = { email, push, whatsapp };

const sendOne = async (channel, actor, event, context) => {
  const impl = CHANNELS[channel];
  if (!impl || typeof impl.send !== 'function') return { channel, skipped: 'no_impl' };
  const template = templates.get(event, channel, actor);
  if (!template) return { channel, skipped: 'no_template' };
  try {
    const result = await impl.send({ actor, event, template, context });
    return { channel, ok: true, ...result };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[notifications] ${channel}.send failed for ${event}:`, e.message);
    return { channel, ok: false, error: e.message };
  }
};

const sendEventNotifications = async (event, context) => {
  const config = MATRIX[event];
  if (!config) {
    // eslint-disable-next-line no-console
    console.warn(`[notifications] evento desconocido: ${event}`);
    return { event, skipped: 'unknown_event' };
  }
  const jobs = [];
  for (const actor of ['buyer', 'seller']) {
    const channels = config[actor] || [];
    for (const channel of channels) {
      jobs.push(sendOne(channel, actor, event, context));
    }
  }
  // Fire-and-forget desde el caller: no bloqueamos con await; devolvemos
  // la promesa por si el caller quiere loggearla.
  const results = await Promise.allSettled(jobs);
  return {
    event,
    results: results.map(r => (r.status === 'fulfilled' ? r.value : { error: r.reason?.message })),
  };
};

module.exports = { sendEventNotifications, MATRIX };
