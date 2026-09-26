// XOLOLO F3 · Sprint 6B: envía al user logueado un email preview del
// reporte mensual del mes indicado (default: mes anterior).
//
// Contrato:
//   POST /api/seller-monthly-report-preview
//   Body (opcional): { year: 2026, month: 8 }  (month 0-indexed)
//   Auth: user logueado.
//   200 → { ok: true, monthLabel: 'agosto 2026', sent: true, count: 12 }
//   401 → { error: 'unauthorized' }
//   500 → { error: 'internal' }
//
// Ayuda al seller a validar cómo se ve el email sin esperar al día 1
// del siguiente mes. También sirve para debugging del template.

const { getSdk } = require('../api-util/sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { sendEventNotifications } = require('../api-util/notifications');
const { buildMonthlyReportForSeller } = require('../api-util/monthlyReport');

module.exports = async (req, res) => {
  try {
    const sdk = getSdk(req, res);
    let userId;
    try {
      const u = await sdk.currentUser.show();
      userId = u.data.data.id.uuid;
    } catch (e) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const isdk = getIntegrationSdk();
    if (!isdk) {
      return res.status(500).json({ error: 'internal', details: 'Integration SDK sin configurar.' });
    }

    // Default: mes anterior al actual (en UTC — para preview el offset
    // no es crítico).
    const now = new Date();
    let year = now.getUTCFullYear();
    let month = now.getUTCMonth() - 1; // -1 = mes anterior
    if (month < 0) {
      month = 11;
      year -= 1;
    }
    // Permitir override en el body si el user quiere ver otro mes.
    const b = req.body || {};
    if (Number.isInteger(b.year) && Number.isInteger(b.month) && b.month >= 0 && b.month <= 11) {
      year = b.year;
      month = b.month;
    }

    const ctx = await buildMonthlyReportForSeller(isdk, userId, { year, month });

    // XOLOLO P1: reportamos el estado REAL del envío al cliente en vez
    // de asumir sent:true. Antes esto ocultaba que el email caía en
    // modo log_only (sin RESEND_API_KEY) o que Resend lo rechazaba.
    // Inspeccionamos el resultado del canal 'email' para el seller y
    // exponemos: sent, mode (resend|log_only|skipped), recipientEmail
    // y error si aplica.
    const notifResult = await sendEventNotifications('seller.monthly_report', ctx);
    const emailResult = (notifResult?.results || []).find(r => r?.channel === 'email') || {};
    const recipientEmail = ctx?.seller?.email || null;
    const sent = emailResult.sent === true;
    const mode = emailResult.mode || (emailResult.skipped ? `skipped:${emailResult.skipped}` : null);
    const errorMsg = emailResult.error || null;
    // eslint-disable-next-line no-console
    console.log(
      `[monthly-report-preview] userId=${userId} recipient=${recipientEmail || 'NONE'} ` +
        `sent=${sent} mode=${mode || 'n/a'} error=${errorMsg || 'none'}`
    );

    return res.json({
      ok: true,
      monthLabel: ctx.report.monthLabel,
      count: Number(ctx.report.count) || 0,
      sent,
      mode,
      recipientEmail,
      error: errorMsg,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[seller-monthly-report-preview] unexpected:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};
