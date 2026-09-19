// XOLOLO: canal Web Push para notificaciones (D.9).
// v1 usa el estándar Web Push API con VAPID keys. Se skippea si
// no hay VAPID keys configuradas o si el actor no tiene suscripción
// registrada.
//
// Requiere:
//   - VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (generar con `web-push generate-vapid-keys`)
//   - VAPID_SUBJECT (mailto:notifications@xololo.mx)
//   - subscripciones guardadas en user.privateData.webPushSubscriptions[]
//     (creadas cuando el buyer o seller acepta el permiso en el navegador
//     — flujo cliente-side, fuera de scope de este archivo)
//
// v1 loguea si no hay subscripciones — no rompe el flow.

let webpush = null;
const getWebpush = () => {
  if (webpush) return webpush;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subj = process.env.VAPID_SUBJECT || 'mailto:notifications@xololo.mx';
  if (!pub || !priv) return null;
  try {
    // eslint-disable-next-line global-require
    webpush = require('web-push');
    webpush.setVapidDetails(subj, pub, priv);
    return webpush;
  } catch (e) {
    // web-push no está instalado — es opcional en v1.
    return null;
  }
};

const send = async ({ actor, event, template, context }) => {
  const recipient = context?.[actor];
  const subscriptions = recipient?.webPushSubscriptions || [];
  if (subscriptions.length === 0) {
    return { skipped: 'no_subscriptions' };
  }

  const wp = getWebpush();
  if (!wp) {
    return { skipped: 'web_push_not_configured' };
  }

  const rendered = template.interpolate(context);
  const payload = JSON.stringify({
    title: rendered.title,
    body: rendered.body,
    url: rendered.url,
    icon: rendered.icon || 'https://xololo.mx/static/icon-192.png',
    tag: event, // dedupe: notificaciones del mismo evento se reemplazan
  });

  const results = await Promise.allSettled(
    subscriptions.map(sub => wp.sendNotification(sub, payload))
  );
  const sent = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;

  // eslint-disable-next-line no-console
  console.log(
    `[notifications:push] → ${actor} · ${event} · ${sent}/${results.length} entregadas`
  );

  return { sent, failed, mode: 'web_push' };
};

module.exports = { send };
