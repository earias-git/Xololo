// XOLOLO: canal email para notificaciones (D.9 + email branding).
// Envío real via Resend REST API. No hay dependencia npm nueva —
// usamos fetch directo.
//
// Config requerido:
//   RESEND_API_KEY        API key de resend.com (dashboard → API Keys)
//   EMAIL_FROM_NAME       "Xololo" (default)
//   EMAIL_FROM_ADDRESS    "noreply@xololo.mx" (requiere dominio verificado en Resend)
//   EMAIL_REPLY_TO        "soporte@xololo.mx" (opcional; default = FROM_ADDRESS)
//
// Sin config: skip silencioso con log. Nunca rompe el flow principal.
//
// Filosofía dual-brand:
//   - Emails al SELLER: full Xololo branding (es una notificación del
//     marketplace, no una comunicación de tienda)
//   - Emails al BUYER: dual-brand — header con logo/color del seller
//     (contexto de la compra), footer Xololo con mensaje de compra
//     protegida (garantía del marketplace)
//   - Sender siempre "Xololo <noreply@xololo.mx>" — el buyer sabe que
//     Xololo respalda el envío aunque compre en tienda X

const { renderEmailHtml } = require('../emailTemplates');

const RESEND_URL = 'https://api.resend.com/emails';

const buildSellerContextForEmail = (rawSeller = {}) => ({
  name: rawSeller.name || rawSeller.displayName || 'Tienda',
  logoUrl: rawSeller.logoUrl,
  primaryColor: rawSeller.primaryColor,
  secondaryColor: rawSeller.secondaryColor,
  slug: rawSeller.slug,
});

const send = async ({ actor, event, template, context }) => {
  const recipient = context?.[actor];
  const recipientEmail = recipient?.email;
  if (!recipientEmail) {
    return { skipped: 'no_recipient_email' };
  }

  const apiKey = process.env.RESEND_API_KEY;
  const fromName = process.env.EMAIL_FROM_NAME || 'Xololo';
  const fromAddress = process.env.EMAIL_FROM_ADDRESS || 'noreply@xololo.mx';
  const replyTo = process.env.EMAIL_REPLY_TO || fromAddress;

  const rendered = template.interpolate(context);

  // Sin API key: log-only. Útil para dev/testing sin gastar cuota.
  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.log(
      `[notifications:email] → ${recipientEmail} · ${event}/${actor} · "${rendered.subject}" (LOG ONLY, no RESEND_API_KEY)`
    );
    return { sent: false, mode: 'log_only', reason: 'no_api_key', to: recipientEmail };
  }

  // Armamos el HTML dual-brand. Para SELLER pasamos seller=null para que
  // renderEmailHtml use el header Xololo puro. Para BUYER usamos el
  // context.seller (con logo, colores, slug) que trae el dispatcher.
  const html = renderEmailHtml({
    actor,
    seller: actor === 'buyer' ? buildSellerContextForEmail(context?.seller) : null,
    title: rendered.subject,
    bodyHtml: rendered.bodyHtml,
    bodyText: rendered.bodyText,
    cta: rendered.cta,
  });

  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: `${fromName} <${fromAddress}>`,
        to: [recipientEmail],
        reply_to: replyTo,
        subject: rendered.subject,
        html,
        // text fallback para clientes que no renderean HTML
        text: rendered.bodyText || undefined,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.error(
        `[notifications:email] Resend rechazó ${event}/${actor}:`,
        data?.message || `HTTP ${res.status}`
      );
      return { sent: false, error: data?.message || `HTTP ${res.status}` };
    }
    // eslint-disable-next-line no-console
    console.log(
      `[notifications:email] ✓ ${recipientEmail} · ${event}/${actor} · id=${data?.id || 'unknown'}`
    );
    return { sent: true, id: data?.id, mode: 'resend' };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[notifications:email] fetch error ${event}/${actor}:`, e.message);
    return { sent: false, error: e.message };
  }
};

module.exports = { send };
