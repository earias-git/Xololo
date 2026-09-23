// XOLOLO Track B (docs/SUBSCRIPTIONS_V1.md §2.3): revisión de
// documentos legales de sellers desde /admin. Gated por adminGate.
//
// Endpoints:
//   GET /api/admin/legal-docs
//     Lista todos los sellers con al menos 1 documento subido o con
//     personType elegido, con su status agregado (para la cola de
//     revisión). Cache 5min.
//     200 → { sellers: [{ sellerId, name, email, personType,
//              docs: {...}, pendingCount, approvedCount, rejectedCount }] }
//
//   POST /api/admin/legal-docs/review
//     Body: { sellerId, slot, status: 'approved'|'rejected', reviewNote? }
//     Aprueba/rechaza un documento específico de un seller.
//     200 → { ok: true }
//     400 → { error: 'invalid_request' }

const { requireAdmin } = require('../api-util/adminGate');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { findSlot } = require('../api-util/legalDocSlots');

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = null;
let cacheAt = 0;

const MAX_PAGES = 20;
const PER_PAGE = 100;

const list = async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin.ok) return;

  if (cache && Date.now() - cacheAt < CACHE_TTL_MS) {
    return res.json({ ...cache, cached: true });
  }

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    const sellers = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const resp = await isdk.users.query({
        page,
        perPage: PER_PAGE,
        'fields.user': ['email', 'profile.displayName', 'profile.metadata'],
      });
      const data = resp.data.data || [];
      for (const u of data) {
        const legalDocs = u.attributes?.profile?.metadata?.xololoLegalDocs;
        if (!legalDocs || (!legalDocs.personType && !legalDocs.docs)) continue;
        const docs = legalDocs.docs || {};
        const statuses = Object.values(docs).map(d => d.status);
        sellers.push({
          sellerId: u.id.uuid,
          name: u.attributes?.profile?.displayName || '',
          email: u.attributes?.email || '',
          personType: legalDocs.personType || null,
          docs,
          pendingCount: statuses.filter(s => s === 'pending').length,
          approvedCount: statuses.filter(s => s === 'approved').length,
          rejectedCount: statuses.filter(s => s === 'rejected').length,
        });
      }
      const totalPages = resp.data.meta?.totalPages || 1;
      if (page >= totalPages) break;
    }

    // Sellers con documentos pendientes primero.
    sellers.sort((a, b) => b.pendingCount - a.pendingCount);

    const value = { sellers };
    cache = value;
    cacheAt = Date.now();
    return res.json(value);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[admin-legal-docs] list error:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

const review = async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin.ok) return;

  const { sellerId, slot: slotKey, status, reviewNote } = req.body || {};
  if (!sellerId || typeof sellerId !== 'string') {
    return res.status(400).json({ error: 'invalid_request', details: 'sellerId requerido.' });
  }
  if (!findSlot(slotKey)) {
    return res.status(400).json({ error: 'invalid_request', details: 'slot inválido.' });
  }
  if (status !== 'approved' && status !== 'rejected') {
    return res.status(400).json({ error: 'invalid_request', details: "status debe ser 'approved' o 'rejected'." });
  }

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    const resp = await isdk.users.show({ id: sellerId });
    const existing = resp.data.data.attributes?.profile?.metadata?.xololoLegalDocs || {};
    const docs = existing.docs || {};
    if (!docs[slotKey]) {
      return res.status(400).json({ error: 'invalid_request', details: 'El seller no ha subido ese documento.' });
    }
    const updatedDocs = {
      ...docs,
      [slotKey]: {
        ...docs[slotKey],
        status,
        reviewedAt: new Date().toISOString(),
        reviewedBy: admin.email,
        reviewNote: reviewNote || null,
      },
    };
    await isdk.users.updateProfile({
      id: sellerId,
      metadata: {
        xololoLegalDocs: { ...existing, docs: updatedDocs },
      },
    });
    // Invalida cache de la lista — el próximo GET refleja el cambio.
    cache = null;
    return res.json({ ok: true });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[admin-legal-docs] review error:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

module.exports = { list, review };
