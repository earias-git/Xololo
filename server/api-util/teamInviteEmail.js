// XOLOLO Tier Empresarial · E2 — email de invitación al colaborador.
//
// No pasa por el matrix de /notifications porque el "colaborador" no
// es ni buyer ni seller — es un rol transversal. Reusa Resend + el
// renderEmailHtml para branding consistente.
//
// Si no hay RESEND_API_KEY, cae a log-only (como el canal estándar).

const { renderEmailHtml } = require('./notifications/emailTemplates');

const RESEND_URL = 'https://api.resend.com/emails';

const ROLE_HUMAN = {
  admin: 'Administrador',
  manager: 'Manager',
  catalog: 'Catálogo / Vendedor',
  logistics: 'Logística',
  finance: 'Finanzas',
  custom: 'Permisos personalizados',
};

/**
 * Dispara el email de invitación. Nunca lanza; devuelve
 * { ok, sent, mode?, reason?, id? } como los otros canales.
 */
const sendTeamInviteEmail = async ({
  collaboratorEmail,
  adminDisplayName,
  adminEmail,
  roleName,
  permissionsCount,
  acceptUrl,
}) => {
  if (!collaboratorEmail) return { ok: false, skipped: 'no_recipient' };
  const apiKey = process.env.RESEND_API_KEY;
  const fromName = process.env.EMAIL_FROM_NAME || 'Xololo';
  const fromAddress = process.env.EMAIL_FROM_ADDRESS || 'noreply@xololo.mx';
  const replyTo = process.env.EMAIL_REPLY_TO || fromAddress;

  const roleLabel = ROLE_HUMAN[roleName] || roleName;
  const subject = `${adminDisplayName || 'Xololo'} te invitó a su equipo en Xololo`;
  const bodyHtml = `
    <p>Hola,</p>
    <p>
      <strong>${adminDisplayName || adminEmail || 'Un vendedor de Xololo'}</strong>
      te invitó a administrar su tienda con el rol <strong>${roleLabel}</strong>
      (${permissionsCount} permiso${permissionsCount === 1 ? '' : 's'} asignado${permissionsCount === 1 ? '' : 's'}).
    </p>
    <p>
      Al aceptar, podrás entrar a tu panel y elegir operar <em>tu propia cuenta</em>
      o la tienda a la que te invitaron, con los permisos que el administrador definió.
      Puedes salir cuando quieras — tu cuenta de Xololo sigue siendo tuya.
    </p>
    <p>Esta invitación caduca en 7 días.</p>
  `;
  const bodyText = `${adminDisplayName || adminEmail || 'Un vendedor de Xololo'} te invitó a administrar su tienda en Xololo con el rol ${roleLabel}. Caduca en 7 días. Acepta aquí: ${acceptUrl}`;
  const cta = { label: 'Aceptar invitación', href: acceptUrl };

  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.log(
      `[teamInviteEmail] → ${collaboratorEmail} · role=${roleName} · "${subject}" (LOG ONLY, no RESEND_API_KEY)`
    );
    return { ok: true, sent: false, mode: 'log_only', to: collaboratorEmail };
  }

  const html = renderEmailHtml({
    actor: 'buyer', // "buyer" en el matrix = tratamiento como individuo (no vendor branded)
    seller: null, // sin seller branding — es un email Xololo-direct
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
        to: [collaboratorEmail],
        reply_to: replyTo,
        subject,
        html,
        text: bodyText,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      // eslint-disable-next-line no-console
      console.error(`[teamInviteEmail] Resend ${res.status}: ${errBody}`);
      return { ok: false, error: 'resend_failed', status: res.status };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, sent: true, id: data?.id, to: collaboratorEmail };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[teamInviteEmail] exception:', e.message);
    return { ok: false, error: 'exception' };
  }
};

module.exports = { sendTeamInviteEmail };
