// XOLOLO: generación de boletos digitales de evento con QR embedded.
//
// Un boleto es:
//   - Un JWT firmado con { txId, listingId, buyerId, iat, exp } que
//     identifica al asistente de forma inforgeable.
//   - Un QR en PNG (data URL base64) que apunta a una URL de verificación
//     con ese JWT como query param.
//   - Un HTML listo para embeber en el bodyHtml del email del buyer, con
//     el QR inline, nombre + evento + fecha + lugar.
//
// Flow futuro de check-in (commit siguiente):
//   seller abre /event-check-in, escanea el QR del buyer con la cam del
//   browser, se abre /api/event-ticket-verify?token=... que valida la
//   firma + marca metadata.xololoEventCheckedIn={at,txId} para evitar
//   doble-uso.
//
// Secreto: EVENT_TICKET_SECRET (actual) para firmar; EVENT_TICKET_SECRET_PREV
// (previo, si está) también se acepta al verificar — habilita rotación sin
// invalidar los boletos ya emitidos.
// Si ninguno de los _SECRET está, cae a OPERATOR_SESSION_SECRET como
// fallback. Si no hay nada, el feature se degrada (no se emite ticket).
//
// Procedimiento de rotación (ver docs/SECURITY.md):
//   1. Setear EVENT_TICKET_SECRET_PREV = valor actual de EVENT_TICKET_SECRET.
//   2. Setear EVENT_TICKET_SECRET = nuevo valor random (openssl rand -hex 32).
//   3. Deploy. Boletos nuevos firman con el nuevo; los viejos verifican con PREV.
//   4. Tras TICKET_TTL_SECONDS (180 días), eliminar EVENT_TICKET_SECRET_PREV.

const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');

// Secreto para FIRMAR (siempre el actual).
const TICKET_SECRET = () =>
  process.env.EVENT_TICKET_SECRET ||
  process.env.OPERATOR_SESSION_SECRET ||
  null;

// Secretos para VERIFICAR (actual + previo si existe).
const TICKET_VERIFY_SECRETS = () => {
  const current = TICKET_SECRET();
  const prev = process.env.EVENT_TICKET_SECRET_PREV;
  const list = [current];
  if (prev && prev !== current) list.push(prev);
  return list.filter(Boolean);
};

const TICKET_TTL_SECONDS = 180 * 24 * 60 * 60; // 180 días desde emisión

/**
 * Firma un token para el boleto de un asistente.
 * Retorna null si no hay secreto configurado.
 */
const signTicketToken = ({ txId, listingId, buyerId }) => {
  const secret = TICKET_SECRET();
  if (!secret || !txId || !listingId || !buyerId) return null;
  return jwt.sign(
    { txId, listingId, buyerId, kind: 'event_ticket' },
    secret,
    { expiresIn: TICKET_TTL_SECONDS }
  );
};

/**
 * Verifica un token y devuelve el payload decodificado o null si falla.
 * Durante rotación de secreto, acepta tanto el actual como el previo.
 */
const verifyTicketToken = token => {
  if (!token) return null;
  const secrets = TICKET_VERIFY_SECRETS();
  for (const secret of secrets) {
    try {
      const payload = jwt.verify(token, secret);
      if (payload?.kind === 'event_ticket') return payload;
    } catch (_) {
      // sigue intentando con el siguiente
    }
  }
  return null;
};

/**
 * Genera el QR como data URL PNG. La URL apuntada es la de verificación
 * (ROOT_URL/event-check-in?token=...). El seller en la puerta escanea
 * esto con la cámara del browser.
 */
const generateQrPngDataUrl = async token => {
  const baseUrl = process.env.ROOT_URL || 'https://xololo.mx';
  const verifyUrl = `${baseUrl}/event-check-in?token=${encodeURIComponent(token)}`;
  // margin:1 compacto; width 320px lo hace legible en móvil incluso cuando
  // el cliente de correo re-escala.
  const dataUrl = await QRCode.toDataURL(verifyUrl, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 320,
  });
  return { dataUrl, verifyUrl };
};

/**
 * Arma el HTML del boleto para embeber en el email del buyer. Minimalista
 * (sin dependencias de CSS externo), ancho ~500px, se ve bien en mobile.
 */
const buildTicketBodyHtml = ({ buyer, listing, event, qrDataUrl, quantity }) => {
  const title = listing?.title || 'Evento';
  const date = [event?.date_start, event?.time_start].filter(Boolean).join(' · ');
  const dateEnd = event?.time_end
    ? event?.date_end && event.date_end !== event?.date_start
      ? ` → ${event.date_end} · ${event.time_end}`
      : ` – ${event.time_end}`
    : '';
  const location = event?.location || '';
  const name = buyer?.name || 'asistente';
  const qty = quantity && quantity > 1 ? `${quantity} boletos` : '1 boleto';

  return `
<div style="max-width:520px;margin:12px auto;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;">
  <div style="background:linear-gradient(135deg,#e7f3ff 0%,#f3e8ff 100%);border-radius:14px;padding:22px 24px;border-left:5px solid #1a73e8;">
    <div style="display:inline-block;padding:4px 12px;background:#1a73e8;color:#fff;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.6px;">🎫 BOLETO DIGITAL</div>
    <h2 style="margin:12px 0 6px;font-size:20px;line-height:1.3;">${title}</h2>
    <p style="margin:0;font-size:15px;line-height:1.5;">📅 <strong>${date}${dateEnd}</strong></p>
    ${location ? `<p style="margin:4px 0 0;font-size:14px;line-height:1.5;">📍 ${location}</p>` : ''}
    <p style="margin:10px 0 0;font-size:13.5px;color:#444;">Asistente: <strong>${name}</strong> · ${qty}</p>
  </div>

  <div style="text-align:center;margin-top:18px;padding:18px;background:#fff;border:1px solid #e8e8e8;border-radius:12px;">
    <p style="margin:0 0 10px;font-size:12.5px;color:#555;text-transform:uppercase;letter-spacing:.5px;font-weight:600;">Muestra este código en la entrada</p>
    <img src="${qrDataUrl}" alt="QR del boleto" style="max-width:260px;width:100%;height:auto;display:block;margin:0 auto;" />
    <p style="margin:12px 0 0;font-size:11.5px;color:#777;">O desde tu celular, bastará con mostrar esta pantalla.</p>
  </div>

  <p style="margin:16px auto 0;font-size:12.5px;color:#777;text-align:center;max-width:460px;line-height:1.5;">
    Boleto único e intransferible. Imprímelo o abre este correo en tu celular el día del evento.
    Si extravías el acceso, pide al organizador que te reenvíe el boleto desde su panel.
  </p>
</div>
`.trim();
};

module.exports = {
  signTicketToken,
  verifyTicketToken,
  generateQrPngDataUrl,
  buildTicketBodyHtml,
  TICKET_TTL_SECONDS,
};
