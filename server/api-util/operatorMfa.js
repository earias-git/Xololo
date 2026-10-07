// XOLOLO Fase 1C.4 — MFA TOTP (Google Authenticator / Authy / 1Password)
// para operators Xololo. Decisión 2026-10-06: obligatorio para TODOS
// incluyendo super_admin (CEO).
//
// Flow enrollment:
//   1. Operator loguea con password → JWT con mfaVerified=false (si
//      ya tiene MFA habilitada) o true (primer login, sin MFA aún).
//   2. Operator entra a /admin/settings/mfa → POST /mfa/enroll genera
//      secret TOTP + QR data URL + 8 recovery codes.
//   3. Operator escanea QR con su app → POST /mfa/verify-enroll con
//      el código actual. Si pasa, mfaEnabled=true + recoveryCodes
//      hasheadas se guardan en el directory.
//   4. Logins futuros: tras verificar password, JWT viene con
//      mfaVerified=false → frontend redirige a /admin/mfa-verify →
//      POST /mfa/verify con código TOTP → re-firma JWT con
//      mfaVerified=true.
//
// Recovery codes: 8 códigos one-shot. Se guardan hasheados (bcrypt)
// en operator.mfaRecoveryCodes. Al usar uno, se marca como consumido.

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { generateSecret, generateURI, verifySync } = require('otplib');
const QRCode = require('qrcode');

const ISSUER = 'Xololo Admin';

/**
 * Genera un secret TOTP nuevo + QR data URL para enrollment.
 */
const generateEnrollment = async operator => {
  const secret = generateSecret(); // base32 string
  const otpauthUrl = generateURI({
    issuer: ISSUER,
    label: operator.email,
    secret,
  });
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 300,
  });
  return { secret, otpauthUrl, qrDataUrl };
};

/**
 * Valida un código TOTP contra un secret. Retorna boolean.
 * Usa verifySync con ventana de ±1 step (30s) para tolerar desfase
 * mínimo de reloj entre el server y el device del operator.
 */
const verifyToken = (token, secret) => {
  if (!token || !secret) return false;
  const clean = String(token).replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  try {
    const result = verifySync({ token: clean, secret, window: 1 });
    return !!(result && result.valid);
  } catch (e) {
    return false;
  }
};

/**
 * Genera 8 recovery codes legibles (formato XXXX-XXXX). Devuelve
 * array con el plain text (para mostrar UNA VEZ al operator) y array
 * con los hashes (para guardar).
 */
const generateRecoveryCodes = async () => {
  const plain = [];
  const hashes = [];
  for (let i = 0; i < 8; i++) {
    const code = `${crypto.randomBytes(2).toString('hex').toUpperCase()}-${crypto
      .randomBytes(2)
      .toString('hex')
      .toUpperCase()}`;
    plain.push(code);
    hashes.push({
      hash: await bcrypt.hash(code, 10),
      consumedAt: null,
    });
  }
  return { plain, hashes };
};

/**
 * Verifica un recovery code contra la lista. Si matchea, devuelve el
 * array actualizado con ese código marcado como consumido.
 * Retorna { ok, updatedCodes } — el caller debe persistir updatedCodes.
 */
const consumeRecoveryCode = async (plainCode, storedCodes) => {
  if (!plainCode || !Array.isArray(storedCodes)) return { ok: false };
  const clean = String(plainCode).replace(/\s+/g, '').toUpperCase();
  for (let i = 0; i < storedCodes.length; i++) {
    const entry = storedCodes[i];
    if (entry.consumedAt) continue;
    const match = await bcrypt.compare(clean, entry.hash);
    if (match) {
      const updatedCodes = storedCodes.map((c, idx) =>
        idx === i ? { ...c, consumedAt: new Date().toISOString() } : c
      );
      return { ok: true, updatedCodes };
    }
  }
  return { ok: false };
};

module.exports = {
  generateEnrollment,
  verifyToken,
  generateRecoveryCodes,
  consumeRecoveryCode,
};
