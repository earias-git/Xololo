// XOLOLO 2026-11-18 — endpoint OPS para enviar email ad-hoc a un
// seller/user. Útil cuando el operador necesita comunicar algo
// fuera de los templates (migraciones, avisos, resincronizaciones).
//
// POST /api/admin/ops/send-notification
//   Body: { to: string, subject: string, bodyText: string, bodyHtml?: string, replyTo?: string }
//   200 → { sent, id }
//   400 → { error: 'invalid_body' | 'invalid_recipient' | 'missing_subject_or_body' }
//
// Gated por requireOperator (MFA). Log del envío queda en la
// consola del server (sendAdminMessage ya loggea) + metadata del
// operator en el response para que el OPS pueda registrar quién
// mandó qué.

const { sendAdminMessage } = require('../api-util/notifications/sendAdminMessage');
const { OPS_TEMPLATES, AVAILABLE_PLACEHOLDERS } = require('../api-util/notifications/opsTemplates');
const opsSendLog = require('../api-util/notifications/opsSendLog');

const send = async (req, res) => {
  const { to, subject, bodyText, bodyHtml, replyTo } = req.body || {};

  if (typeof to !== 'string' || typeof subject !== 'string' || typeof bodyText !== 'string') {
    return res.status(400).json({ error: 'invalid_body' });
  }

  const result = await sendAdminMessage({ to, subject, bodyText, bodyHtml, replyTo });

  if (!result.sent) {
    opsSendLog.push({
      to,
      subject,
      operator: req.operator,
      status: 'failed',
      error: result.error || result.reason || 'send_failed',
    });
    return res
      .status(result.error === 'invalid_recipient' || result.error === 'missing_subject_or_body' ? 400 : 502)
      .json({ error: result.error || result.reason || 'send_failed' });
  }

  opsSendLog.push({
    to,
    subject,
    operator: req.operator,
    status: 'sent',
    resendId: result.id,
  });
  // eslint-disable-next-line no-console
  console.log(
    `[ops-send-notification] by ${req.operator?.email || 'unknown'} → ${to} · "${subject}" · id=${result.id}`
  );

  return res.status(200).json({ sent: true, id: result.id });
};

const listTemplates = (req, res) => {
  res.status(200).json({ templates: OPS_TEMPLATES, placeholders: AVAILABLE_PLACEHOLDERS });
};

const listLog = (req, res) => {
  res.status(200).json({ log: opsSendLog.list({ limit: 100 }) });
};

module.exports = { send, listTemplates, listLog };
