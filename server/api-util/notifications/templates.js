// XOLOLO: templates centralizados de notificaciones (Fase D.9).
// Cada template devuelve un objeto con la data que el canal necesita
// para enviar el mensaje. Estructura:
//
//   templates.get('order.paid', 'email', 'buyer') → {
//     subject: '¡Tu pedido está confirmado!',
//     bodyText: 'Hola {name}, ...',
//     bodyHtml: '<p>...</p>',
//     cta: { url, label },
//   }
//
//   templates.get('order.paid', 'push', 'buyer') → {
//     title: 'Pedido confirmado',
//     body: '{seller} ya está preparando tu pedido',
//     url: '...',
//   }
//
//   templates.get('order.paid', 'whatsapp', 'buyer') → {
//     text: 'Xololo: tu pedido con {seller} está confirmado. Ver estado: {url}',
//   }
//
// Los placeholders {name}, {seller}, {url} son sustituidos por el
// canal usando `context` que le pase el dispatcher.
//
// v1 tiene un subset de templates. Los eventos sin template para un
// canal específico se skippean silenciosamente en el dispatcher.

// Helper para interpolar {placeholder} en un string desde context.
const interp = (str, ctx) => {
  if (typeof str !== 'string') return str;
  return str.replace(/\{(\w+(?:\.\w+)*)\}/g, (_, path) => {
    const parts = path.split('.');
    let cur = ctx;
    for (const p of parts) {
      cur = cur?.[p];
      if (cur == null) return '';
    }
    return String(cur);
  });
};

const TEMPLATES = {
  'order.paid': {
    email: {
      buyer: {
        subject: 'Pedido confirmado en Xololo',
        bodyText:
          'Hola {buyer.name},\n\nTu pedido con {seller.name} fue confirmado. ' +
          'Puedes seguir el estado desde tu cuenta.\n\n{order.url}',
      },
      seller: {
        subject: '¡Nueva venta en Xololo!',
        bodyText:
          'Hola {seller.name},\n\nTienes una nueva venta de {listing.title}. ' +
          'Empieza a preparar el envío desde tu dashboard.\n\n{order.url}',
      },
    },
    push: {
      buyer: {
        title: 'Pedido confirmado',
        body: '{seller.name} ya recibió tu pago',
        url: '{order.url}',
      },
      seller: {
        title: '¡Nueva venta!',
        body: '{listing.title} — prepara el envío',
        url: '{order.url}',
      },
    },
    whatsapp: {
      buyer: {
        text:
          'Xololo: tu pedido con {seller.name} está confirmado. Sigue el estado: {order.url}',
      },
      seller: {
        text:
          'Xololo: ¡vendiste {listing.title}! Genera la guía en tu panel: {order.url}',
      },
    },
  },
  'order.label_generated': {
    email: {
      buyer: {
        subject: 'Tu pedido está listo para ser recolectado',
        bodyText:
          'Hola {buyer.name},\n\n{seller.name} generó la guía de envío. ' +
          'El paquete será recolectado por {carrier.name} próximamente.\n\n{order.url}',
      },
    },
    push: {
      buyer: {
        title: 'Guía generada',
        body: '{carrier.name} pasará por tu paquete',
        url: '{order.url}',
      },
    },
  },
  'order.label_pending': {
    email: {
      seller: {
        subject: 'Tu venta espera guía',
        bodyText:
          'Hola {seller.name},\n\nHan pasado más de X horas desde que se confirmó ' +
          'la venta y aún no generas la guía. Súbelas fotos SOS y genera desde tu panel.\n\n{order.url}',
      },
    },
    push: {
      seller: {
        title: '⚠️ Guía pendiente',
        body: 'Sube fotos SOS y genera la guía para {listing.title}',
        url: '{order.url}',
      },
    },
  },
  'order.picked_up': {
    email: {
      buyer: {
        subject: 'Tu pedido está en camino',
        bodyText:
          'Hola {buyer.name},\n\n{carrier.name} recogió tu pedido con {seller.name}. ' +
          'Sigue el tracking: {tracking.url}',
      },
      seller: {
        subject: 'Paquete recolectado',
        bodyText:
          'Hola {seller.name},\n\n{carrier.name} recogió tu envío. ' +
          'Buen trabajo, ya no tienes acciones pendientes hasta entrega.',
      },
    },
    push: {
      buyer: {
        title: 'Paquete recolectado',
        body: '{carrier.name} lo lleva en camino',
        url: '{order.url}',
      },
      seller: {
        title: 'Paquete recolectado',
        body: 'Buen trabajo, ya está en manos de {carrier.name}',
        url: '{order.url}',
      },
    },
  },
  'order.in_transit': {
    email: {
      buyer: {
        subject: 'Tu pedido va en camino',
        bodyText:
          'Hola {buyer.name},\n\nTu pedido con {seller.name} está en tránsito. ' +
          'Fecha estimada: {carrier.eta}.\n\nTracking: {tracking.url}',
      },
    },
  },
  'order.out_for_delivery': {
    email: {
      buyer: {
        subject: '📦 Tu pedido llega hoy',
        bodyText:
          'Hola {buyer.name},\n\nEl chofer salió con tu pedido en la ruta del día. ' +
          'Prepara alguien para recibirlo.\n\n{tracking.url}',
      },
    },
    push: {
      buyer: {
        title: '📦 Pedido en reparto',
        body: 'Llega hoy — prepara para recibirlo',
        url: '{order.url}',
      },
    },
    whatsapp: {
      buyer: {
        text:
          'Xololo: 🛵 tu pedido con {seller.name} está en reparto. Llega hoy. Ver ruta: {tracking.url}',
      },
    },
  },
  'order.delivered': {
    email: {
      buyer: {
        subject: '✅ Pedido entregado',
        bodyText:
          'Hola {buyer.name},\n\nTu pedido con {seller.name} fue entregado. ' +
          'Confirma la recepción en tu cuenta (tienes 48h antes de que se libere ' +
          'el pago automáticamente al vendedor).\n\n{order.url}',
      },
      seller: {
        subject: 'Entrega confirmada',
        bodyText:
          '¡Buen trabajo, {seller.name}! El pedido fue entregado. ' +
          'El pago se libera cuando el buyer confirme (o en 48h por afirmativa ficta).\n\n{order.url}',
      },
    },
    push: {
      buyer: {
        title: '✅ Pedido entregado',
        body: 'Confirma o reporta problema en 48h',
        url: '{order.url}',
      },
      seller: {
        title: '✅ Entregado',
        body: 'El pago se libera pronto',
        url: '{order.url}',
      },
    },
    whatsapp: {
      buyer: {
        text:
          'Xololo: ✅ tu pedido con {seller.name} fue entregado. ¿Todo bien? Confirma aquí: {order.url}',
      },
      seller: {
        text:
          'Xololo: ✅ entregaste tu venta. Pago se libera cuando el buyer confirme o en 48h.',
      },
    },
  },
  'order.review_open': {
    email: {
      buyer: {
        subject: 'Confirma tu recepción · faltan 24h',
        bodyText:
          'Hola {buyer.name},\n\nRecordatorio: tienes hasta {deadline} para ' +
          'confirmar tu recepción o abrir disputa. Después el pago se libera ' +
          'automáticamente al vendedor.\n\n{order.url}',
      },
    },
    push: {
      buyer: {
        title: 'Encuesta abierta',
        body: 'Confirma tu recepción antes de 48h',
        url: '{order.url}',
      },
    },
  },
  'order.tacit_acceptance': {
    email: {
      seller: {
        subject: 'Pago liberado por afirmativa ficta',
        bodyText:
          'Hola {seller.name},\n\nEl buyer no respondió la encuesta en 48h. ' +
          'Se liberó el pago de tu venta automáticamente por afirmativa ficta.',
      },
    },
    whatsapp: {
      seller: {
        text: 'Xololo: pago liberado por afirmativa ficta. Buen trabajo 🎉',
      },
    },
  },
  'order.dispute_opened': {
    email: {
      buyer: {
        subject: 'Disputa abierta — Xololo la está revisando',
        bodyText:
          'Hola {buyer.name},\n\nRecibimos tu reporte. Xololo revisará el caso ' +
          'con la evidencia SOS del vendedor en menos de 72 horas y ' +
          'te contactará con la resolución.\n\n{order.url}',
      },
      seller: {
        subject: '⚠️ Un buyer reportó problema con tu venta',
        bodyText:
          'Hola {seller.name},\n\nUn buyer reportó un problema con tu venta. ' +
          'Xololo está revisando con las fotos SOS que subiste. ' +
          'Los fondos están congelados temporalmente.\n\n{order.url}',
      },
    },
    push: {
      buyer: {
        title: 'Disputa abierta',
        body: 'Xololo revisará en 72h',
        url: '{order.url}',
      },
      seller: {
        title: '⚠️ Disputa recibida',
        body: 'Xololo la está revisando',
        url: '{order.url}',
      },
    },
    whatsapp: {
      buyer: {
        text:
          'Xololo: recibimos tu reporte. Revisaremos y te contactamos en <72h con la resolución.',
      },
      seller: {
        text:
          'Xololo: ⚠️ un buyer reportó problema con tu venta. Revisaremos con las fotos SOS. Fondos temporalmente congelados.',
      },
    },
  },
  'seller.first_sale': {
    email: {
      seller: {
        subject: '🎉 ¡Tu primera venta en Xololo!',
        bodyText:
          '¡Felicidades {seller.name}!\n\nAcabas de hacer tu primera venta ' +
          'en Xololo. Este es el paso 1 de muchos. Genera la guía desde el panel ' +
          'y sigue las buenas prácticas de embalaje para que el seguro SOS aplique.\n\n{order.url}',
      },
    },
    push: {
      seller: {
        title: '🎉 ¡Tu primera venta!',
        body: 'Bienvenido a Xololo',
        url: '{order.url}',
      },
    },
    whatsapp: {
      seller: {
        text:
          '🎉 Xololo: ¡tu primera venta! Genera la guía y sigue las buenas prácticas. Bienvenido.',
      },
    },
  },
};

const get = (event, channel, actor) => {
  const raw = TEMPLATES[event]?.[channel]?.[actor];
  if (!raw) return null;
  // Devolvemos una función que interpolará con context — así los canales
  // pueden decidir cuándo aplicar los placeholders (algunos podrían
  // necesitar HTML seguro, otros plain text).
  return {
    raw,
    interpolate: ctx => {
      const out = {};
      for (const [k, v] of Object.entries(raw)) {
        out[k] = typeof v === 'string' ? interp(v, ctx) : v;
      }
      return out;
    },
  };
};

module.exports = { get, interp };
