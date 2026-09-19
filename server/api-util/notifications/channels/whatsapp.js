// XOLOLO: canal WhatsApp Business para notificaciones (D.9).
// v1 usa Meta Cloud API directa (no proveedor intermediario). Skippea
// si no hay config o si el actor no tiene número WhatsApp registrado.
//
// Requiere:
//   - WHATSAPP_PHONE_NUMBER_ID (del app WhatsApp Business en Meta)
//   - WHATSAPP_ACCESS_TOKEN (long-lived del app)
//   - WHATSAPP_API_VERSION (default v18.0)
//
// Los templates OFICIALES deben pre-aprobarse en Meta (24h de review).
// v1 usa mensajes de tipo "text" — SOLO funcionan si el buyer/seller
// tuvo interacción con Xololo en las últimas 24h. Para notificaciones
// fuera de esa ventana se necesitan templates aprobados (message
// templates de tipo "utility" o "marketing" con nombres registrados).
//
// v2: migrar a templates aprobados con placeholders para poder enviar
// en cualquier momento. Por ahora logueamos si no está configurado.

const send = async ({ actor, event, template, context }) => {
  const recipient = context?.[actor];
  const phone = recipient?.whatsapp;
  if (!phone) return { skipped: 'no_phone' };

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const apiVersion = process.env.WHATSAPP_API_VERSION || 'v18.0';

  if (!phoneNumberId || !accessToken) {
    // eslint-disable-next-line no-console
    console.log(
      `[notifications:whatsapp] → ${phone} · ${event}/${actor} · SKIPPED (not configured)`
    );
    return { skipped: 'whatsapp_not_configured' };
  }

  const rendered = template.interpolate(context);
  const cleanPhone = String(phone).replace(/[^\d]/g, '');
  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: cleanPhone,
    type: 'text',
    text: { body: rendered.text, preview_url: false },
  };

  try {
    const res = await fetch(
      `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      }
    );
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        sent: false,
        error: data?.error?.message || `HTTP ${res.status}`,
        details: data,
      };
    }
    return { sent: true, messageId: data?.messages?.[0]?.id };
  } catch (e) {
    return { sent: false, error: e.message };
  }
};

module.exports = { send };
