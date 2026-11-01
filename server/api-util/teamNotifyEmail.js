// XOLOLO Tier Empresarial · E8 — emails complementarios del flow team.
//
// - teamAcceptedEmail: al admin cuando un colaborador acepta la invitación.
// - teamPausedEmail / teamRemovedEmail: al colaborador cuando el admin
//   cambia su status.
//
// Mismo patrón de teamInviteEmail: Resend directo + log-only sin API key.

const { renderEmailHtml } = require('./notifications/emailTemplates');

const RESEND_URL = 'https://api.resend.com/emails';

const resendEnv = () => ({
  apiKey: process.env.RESEND_API_KEY,
  fromName: process.env.EMAIL_FROM_NAME || 'Xololo',
  fromAddress: process.env.EMAIL_FROM_ADDRESS || 'noreply@xololo.mx',
  replyTo: process.env.EMAIL_REPLY_TO || process.env.EMAIL_FROM_ADDRESS || 'noreply@xololo.mx',
});

const sendPayload = async ({ to, subject, bodyHtml, bodyText, cta, label }) => {
  const { apiKey, fromName, fromAddress, replyTo } = resendEnv();
  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.log(`[teamNotifyEmail:${label}] → ${to} · "${subject}" (LOG ONLY, no RESEND_API_KEY)`);
    return { ok: true, sent: false, mode: 'log_only', to };
  }
  const html = renderEmailHtml({
    actor: 'buyer',
    seller: null,
    title: subject,
    bodyHtml,
    bodyText,
    cta,
    footerOpts: { insuranceLine: false },
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
        to: [to],
        reply_to: replyTo,
        subject,
        html,
        text: bodyText,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      // eslint-disable-next-line no-console
      console.error(`[teamNotifyEmail:${label}] Resend ${res.status}: ${errBody}`);
      return { ok: false, error: 'resend_failed' };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, sent: true, id: data?.id, to };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[teamNotifyEmail:${label}] exception:`, e.message);
    return { ok: false, error: 'exception' };
  }
};

const sendTeamAcceptedEmail = ({ adminEmail, collaboratorEmail, collaboratorDisplayName, dashboardUrl }) => {
  if (!adminEmail) return Promise.resolve({ ok: false, skipped: 'no_recipient' });
  const name = collaboratorDisplayName || collaboratorEmail || 'tu colaborador';
  const subject = `${name} aceptó tu invitación`;
  const bodyHtml = `
    <p>¡Buenas noticias!</p>
    <p>
      <strong>${name}</strong> (<code>${collaboratorEmail || ''}</code>) aceptó
      la invitación a tu equipo y ya puede operar tu tienda con los permisos
      que le asignaste.
    </p>
    <p>
      Puedes revisar su acceso, cambiar sus permisos o pausar su acceso en
      cualquier momento desde Dashboard → Equipo.
    </p>
  `;
  const bodyText = `${name} (${collaboratorEmail || ''}) aceptó tu invitación. Gestiona el equipo en: ${dashboardUrl}`;
  return sendPayload({
    to: adminEmail,
    subject,
    bodyHtml,
    bodyText,
    cta: { label: 'Ver mi equipo', href: dashboardUrl },
    label: 'accepted',
  });
};

const sendTeamPausedEmail = ({ collaboratorEmail, adminDisplayName, sellerDisplayName }) => {
  if (!collaboratorEmail) return Promise.resolve({ ok: false, skipped: 'no_recipient' });
  const admin = adminDisplayName || 'El administrador';
  const store = sellerDisplayName || 'la tienda';
  const subject = `Tu acceso a ${store} fue pausado temporalmente`;
  const bodyHtml = `
    <p>Hola,</p>
    <p>
      <strong>${admin}</strong> pausó tu acceso como colaborador en
      <strong>${store}</strong>. No podrás operar la tienda hasta que te
      reactiven.
    </p>
    <p>
      Tu cuenta Xololo propia sigue intacta — puedes seguir usándola para
      tus propias publicaciones y compras.
    </p>
    <p>
      Si crees que es un error, contacta directamente al administrador.
    </p>
  `;
  const bodyText = `${admin} pausó tu acceso a ${store}. Tu cuenta propia sigue activa.`;
  return sendPayload({
    to: collaboratorEmail,
    subject,
    bodyHtml,
    bodyText,
    cta: null,
    label: 'paused',
  });
};

const sendTeamRemovedEmail = ({ collaboratorEmail, adminDisplayName, sellerDisplayName }) => {
  if (!collaboratorEmail) return Promise.resolve({ ok: false, skipped: 'no_recipient' });
  const admin = adminDisplayName || 'El administrador';
  const store = sellerDisplayName || 'la tienda';
  const subject = `Tu acceso a ${store} fue removido`;
  const bodyHtml = `
    <p>Hola,</p>
    <p>
      <strong>${admin}</strong> removió tu acceso como colaborador en
      <strong>${store}</strong>. Ya no podrás operar esa tienda.
    </p>
    <p>
      Tu cuenta Xololo propia sigue intacta — puedes seguir usándola para
      tus propias publicaciones y compras.
    </p>
  `;
  const bodyText = `${admin} removió tu acceso a ${store}. Tu cuenta propia sigue activa.`;
  return sendPayload({
    to: collaboratorEmail,
    subject,
    bodyHtml,
    bodyText,
    cta: null,
    label: 'removed',
  });
};

module.exports = {
  sendTeamAcceptedEmail,
  sendTeamPausedEmail,
  sendTeamRemovedEmail,
};
