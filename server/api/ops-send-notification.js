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
const { getIntegrationSdk } = require('../api-util/integrationSdk');

// XOLOLO 2026-11-18: slug URL-friendly del título de un listing.
// Replica la lógica interna de Sharetribe para construir URLs
// tipo /l/<slug>/<id>. Suficiente aproximación para el link que
// mostramos al seller — Sharetribe acepta cualquier slug, lo que
// cuenta es el id.
const slugify = text =>
  String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

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

// XOLOLO 2026-11-18: search de users por email/displayName para
// autocomplete del módulo Notificaciones. Si el query incluye "@",
// prueba búsqueda exacta por email primero (rápida). Si no hay hit
// o el query no es email, hace pull paginado y filtra en memoria
// (marketplace chico; si crece mucho migrar a índice).
const searchUsers = async (req, res) => {
  const q = String(req.query?.q || '').trim();
  const limit = Math.min(Number(req.query?.limit) || 10, 25);
  if (q.length < 2) {
    return res.status(200).json({ users: [] });
  }

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    const results = [];
    const seen = new Set();

    // 1) Si parece email, intentar búsqueda exacta.
    if (q.includes('@')) {
      try {
        const resp = await isdk.users.query({ email: q });
        const data = resp.data?.data || [];
        for (const u of data) {
          const id = u.id?.uuid;
          if (!id || seen.has(id)) continue;
          seen.add(id);
          results.push({
            id,
            email: u.attributes?.email,
            displayName: u.attributes?.profile?.displayName || u.attributes?.profile?.abbreviatedName || '',
            slug: u.attributes?.profile?.publicData?.storeSlug || null,
          });
        }
      } catch (_) {
        // sigue con fallback
      }
    }

    // 2) Fallback: pull paginado y filtro en memoria (hasta 500 users).
    if (results.length < limit) {
      const qLower = q.toLowerCase();
      for (let page = 1; page <= 5 && results.length < limit; page++) {
        const resp = await isdk.users.query({ perPage: 100, page });
        const data = resp.data?.data || [];
        for (const u of data) {
          const id = u.id?.uuid;
          if (!id || seen.has(id)) continue;
          const email = (u.attributes?.email || '').toLowerCase();
          const name = (
            u.attributes?.profile?.displayName ||
            u.attributes?.profile?.abbreviatedName ||
            ''
          ).toLowerCase();
          if (email.includes(qLower) || name.includes(qLower)) {
            seen.add(id);
            results.push({
              id,
              email: u.attributes?.email,
              displayName: u.attributes?.profile?.displayName || u.attributes?.profile?.abbreviatedName || '',
              slug: u.attributes?.profile?.publicData?.storeSlug || null,
            });
            if (results.length >= limit) break;
          }
        }
        if (data.length < 100) break;
      }
    }

    return res.status(200).json({ users: results.slice(0, limit) });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[ops-send-notification:searchUsers]', e?.message);
    return res.status(500).json({ error: 'search_failed' });
  }
};

// XOLOLO 2026-11-18: listings del user (hasta 50), con data útil
// para el módulo Notificaciones (título, slug, si es variant master,
// nº de variantes esperadas, categoría). El frontend usa esto para
// pre-llenar {{listingTitle}}, {{listingUrl}}, {{expectedVariants}}.
const listUserListings = async (req, res) => {
  const userId = req.params?.userId;
  if (!userId) return res.status(400).json({ error: 'invalid_request' });

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    const resp = await isdk.listings.query({
      authorId: userId,
      perPage: 50,
      'fields.listing': ['title', 'publicData', 'state'],
    });
    const data = resp.data?.data || [];
    const listings = data
      .map(l => {
        const pd = l.attributes?.publicData || {};
        const isMaster = pd.isVariantMaster === true;
        const matrix = Array.isArray(pd.variantsMatrix) ? pd.variantsMatrix : [];
        const title = l.attributes?.title || '';
        const id = l.id?.uuid;
        return {
          id,
          title,
          state: l.attributes?.state,
          slug: slugify(title),
          url: `https://xololo.mx/l/${slugify(title)}/${id}`,
          editVariantsUrl: `https://xololo.mx/l/${slugify(title)}/${id}/edit/variants`,
          categoryLevel1: pd.categoryLevel1,
          isVariantMaster: isMaster,
          variantGroupId: pd.variantGroupId || null,
          expectedVariants: isMaster ? matrix.length : 0,
        };
      })
      // Masters de variantes primero (los que probablemente requieren resync).
      .sort((a, b) => Number(b.isVariantMaster) - Number(a.isVariantMaster));
    return res.status(200).json({ listings });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[ops-send-notification:listUserListings]', e?.message);
    return res.status(500).json({ error: 'listings_fetch_failed' });
  }
};

module.exports = { send, listTemplates, listLog, searchUsers, listUserListings };
