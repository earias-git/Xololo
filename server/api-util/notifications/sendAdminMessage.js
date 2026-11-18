// XOLOLO 2026-11-18 — helper para enviar un email ad-hoc desde OPS
// a un seller/user. Se usa cuando un operador necesita avisar
// algo fuera de los templates predefinidos (p.ej. "ve a corregir
// las variantes de tu anuncio").
//
// NO usar para transacciones del marketplace — eso va por los
// templates + dispatcher. Esto es para comunicación ad-hoc.

const RESEND_URL = 'https://api.resend.com/emails';

/**
 * Envía un email transaccional one-off vía Resend.
 *
 * @param {object} opts
 * @param {string} opts.to — email destinatario (uno solo).
 * @param {string} opts.subject
 * @param {string} opts.bodyText — versión plain text (obligatoria)
 * @param {string} [opts.bodyHtml] — versión HTML (opcional). Si no
 *   se pasa, se genera un wrapper mínimo con el bodyText.
 * @param {string} [opts.replyTo] — override del reply-to. Default
 *   EMAIL_REPLY_TO o EMAIL_FROM_ADDRESS.
 * @returns {Promise<{sent:boolean, id?:string, error?:string, reason?:string}>}
 */
const sendAdminMessage = async ({ to, subject, bodyText, bodyHtml, replyTo } = {}) => {
  if (!to || !/^.+@.+\..+$/.test(to)) {
    return { sent: false, error: 'invalid_recipient' };
  }
  if (!subject || !bodyText) {
    return { sent: false, error: 'missing_subject_or_body' };
  }

  const apiKey = process.env.RESEND_API_KEY;
  const fromName = process.env.EMAIL_FROM_NAME || 'Xololo';
  const fromAddress = process.env.EMAIL_FROM_ADDRESS || 'noreply@xololo.mx';
  const effectiveReplyTo = replyTo || process.env.EMAIL_REPLY_TO || fromAddress;

  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.log(
      `[sendAdminMessage] → ${to} · "${subject}" (LOG ONLY, no RESEND_API_KEY)`
    );
    return { sent: false, reason: 'no_api_key' };
  }

  const html =
    bodyHtml ||
    `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${subject}</title></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;line-height:1.55;max-width:600px;margin:0 auto;padding:24px;"><pre style="white-space:pre-wrap;font-family:inherit;font-size:14px;margin:0;">${bodyText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')}</pre></body></html>`;

  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: `${fromName} <${fromAddress}>`,
        to: [to],
        reply_to: effectiveReplyTo,
        subject,
        html,
        text: bodyText,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.error(
        `[sendAdminMessage] Resend rechazó "${subject}" → ${to}:`,
        data?.message || `HTTP ${res.status}`
      );
      return { sent: false, error: data?.message || `HTTP ${res.status}` };
    }
    // eslint-disable-next-line no-console
    console.log(
      `[sendAdminMessage] ✓ ${to} · "${subject}" · id=${data?.id || 'unknown'}`
    );
    return { sent: true, id: data?.id };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[sendAdminMessage] fetch error "${subject}" → ${to}:`, e.message);
    return { sent: false, error: e.message };
  }
};

module.exports = { sendAdminMessage };
