// XOLOLO: canal email para notificaciones (D.9).
// v1 usa la API transaccional de Sharetribe (los templates viajan
// como email transaccional dentro del marketplace). Skippea si no
// hay config.
//
// En v2 podemos migrar a Postmark/Resend/SendGrid si necesitamos
// templates HTML más ricos o mejores estadísticas de open/click.

const send = async ({ actor, event, template, context }) => {
  const recipient = context?.[actor];
  const recipientEmail = recipient?.email;
  if (!recipientEmail) {
    return { skipped: 'no_recipient_email' };
  }

  const rendered = template.interpolate(context);

  // v1: log estructurado. En prod real esto llama a la API de email.
  // Estructura del envío:
  //   to: recipientEmail
  //   subject: rendered.subject
  //   text: rendered.bodyText
  //   html: rendered.bodyHtml (opcional)
  // eslint-disable-next-line no-console
  console.log(
    `[notifications:email] → ${recipientEmail} · ${event}/${actor} · "${rendered.subject}"`
  );

  // TODO(v2): integrar con Sharetribe Notifications API o proveedor
  // dedicado. Por ahora solo logueamos para verificar que la matriz
  // dispara los eventos correctos.
  return { sent: false, mode: 'log_only', to: recipientEmail };
};

module.exports = { send };
