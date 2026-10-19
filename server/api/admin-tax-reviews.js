// XOLOLO Gate antifraude fiscal (task #39): revisión humana de las
// clasificaciones fiscales especiales declaradas por sellers en el form
// de Pricing. Hasta que un operator aprueba, el motor de cobro usa el
// default conservador 16% + enajenación.
//
// Endpoints:
//   GET /api/admin/tax-reviews
//     Lista listings con publicData.taxClassification.reviewStatus
//     !== 'approved' (pendientes y rechazados recientes), con contexto
//     del listing y del seller para que el operator decida.
//     200 → { items: [{ listingId, title, price, authorId, authorName,
//              authorEmail, categoryId, taxClassification: {...} }],
//              cached: boolean }
//
//   POST /api/admin/tax-reviews/review
//     Body: { listingId, status: 'approved' | 'rejected', reviewNote? }
//     Actualiza publicData.taxClassification.reviewStatus +
//     reviewedBy/reviewedAt/reviewNote. Al aprobar, el próximo render
//     del preview aplica el override y los cálculos reales lo honran.
//     200 → { ok: true }
//     400 → { error: 'invalid_request' }

const { requireAdmin } = require('../api-util/adminGate');
const { getIntegrationSdk } = require('../api-util/integrationSdk');

const CACHE_TTL_MS = 2 * 60 * 1000; // 2 min: cola de revisión activa.
let cache = null;
let cacheAt = 0;

const MAX_PAGES = 20;
const PER_PAGE = 100;

const VALID_STATUSES = new Set(['approved', 'rejected']);

const list = async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin.ok) return;

  if (cache && Date.now() - cacheAt < CACHE_TTL_MS) {
    return res.json({ ...cache, cached: true });
  }

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    // 1) Barremos todos los listings; el Integration SDK no permite
    //    filtrar por campo anidado de publicData, así que paginamos y
    //    filtramos en memoria. Volumen esperado al inicio: bajo (sellers
    //    nuevos). Cuando crezca, migraremos a un índice propio.
    const pending = [];
    const authorIds = new Set();

    for (let page = 1; page <= MAX_PAGES; page++) {
      const resp = await isdk.listings.query({
        page,
        perPage: PER_PAGE,
        // Sólo necesitamos title + publicData + author.
        'fields.listing': ['title', 'price', 'publicData', 'createdAt'],
        include: ['author'],
      });
      const data = resp.data.data || [];
      const included = resp.data.included || [];
      const authorsById = new Map();
      for (const inc of included) {
        if (inc.type === 'user') authorsById.set(inc.id.uuid, inc);
      }

      for (const l of data) {
        const tc = l.attributes?.publicData?.taxClassification;
        if (!tc || !tc.code) continue;
        // Mostramos pendientes y rechazados (los aprobados no necesitan
        // acción; si el seller cambia el code, vuelve a pending).
        if (tc.reviewStatus === 'approved') continue;

        const authorRel = l.relationships?.author?.data;
        const authorId = authorRel?.id?.uuid || null;
        if (authorId) authorIds.add(authorId);
        const authorInc = authorId ? authorsById.get(authorId) : null;

        const price = l.attributes?.price;
        pending.push({
          listingId: l.id.uuid,
          title: l.attributes?.title || '(sin título)',
          price: price ? { amount: price.amount, currency: price.currency } : null,
          createdAt: l.attributes?.createdAt || null,
          categoryId: l.attributes?.publicData?.categoryLevel1 || null,
          authorId,
          authorName: authorInc?.attributes?.profile?.displayName || '',
          authorEmail: null, // email vive en attrs, no en profile — abajo lo rellenamos
          taxClassification: tc,
        });
      }

      const totalPages = resp.data.meta?.totalPages || 1;
      if (page >= totalPages) break;
    }

    // 2) Resolvemos emails de los authors en una pasada. isdk.users.show
    //    por id para no asumir que la query de listings nos trae email.
    if (authorIds.size > 0) {
      const emailByAuthor = new Map();
      for (const id of authorIds) {
        try {
          const r = await isdk.users.show({ id, 'fields.user': ['email'] });
          emailByAuthor.set(id, r.data.data?.attributes?.email || '');
        } catch (_) {
          emailByAuthor.set(id, '');
        }
      }
      for (const item of pending) {
        if (item.authorId) item.authorEmail = emailByAuthor.get(item.authorId) || '';
      }
    }

    // Pendientes primero; dentro, el más viejo arriba (FIFO).
    pending.sort((a, b) => {
      const aPending = a.taxClassification.reviewStatus === 'pending' ? 0 : 1;
      const bPending = b.taxClassification.reviewStatus === 'pending' ? 0 : 1;
      if (aPending !== bPending) return aPending - bPending;
      const aAt = a.taxClassification.declaredAt || '';
      const bAt = b.taxClassification.declaredAt || '';
      return aAt.localeCompare(bAt);
    });

    const value = { items: pending };
    cache = value;
    cacheAt = Date.now();
    return res.json(value);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[admin-tax-reviews] list error:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

const review = async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin.ok) return;

  const { listingId, status, reviewNote } = req.body || {};
  if (!listingId || typeof listingId !== 'string') {
    return res.status(400).json({ error: 'invalid_request', details: 'listingId requerido.' });
  }
  if (!VALID_STATUSES.has(status)) {
    return res
      .status(400)
      .json({ error: 'invalid_request', details: "status debe ser 'approved' o 'rejected'." });
  }

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    const resp = await isdk.listings.show({ id: listingId });
    const existing = resp.data.data?.attributes?.publicData?.taxClassification;
    if (!existing || !existing.code) {
      return res
        .status(400)
        .json({ error: 'invalid_request', details: 'El listing no tiene clasificación fiscal declarada.' });
    }

    const updated = {
      ...existing,
      reviewStatus: status,
      reviewedBy: admin.email,
      reviewedAt: new Date().toISOString(),
      reviewNote: reviewNote || null,
    };

    await isdk.listings.update({
      id: listingId,
      publicData: { taxClassification: updated },
    });

    // Invalida cache de la lista — el próximo GET refleja el cambio.
    cache = null;
    return res.json({ ok: true });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[admin-tax-reviews] review error:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

module.exports = { list, review };
