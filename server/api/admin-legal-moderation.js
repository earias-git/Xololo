// XOLOLO: cola Ops de moderación de legalidad.
//
// Lista listings con publicData.xololoLegalModeration donde verdict es
// 'illegal' (ya bloqueados automático — Ops puede revertir) o
// 'needs_review' (dual-use flaguedos pero NO bloqueados — Ops decide
// si bloquear o marcar como legal).
//
// Endpoints:
//   GET /api/admin/legal-moderation
//     200 → {
//       items: [{
//         listingId, title, description, price, categoryId,
//         authorId, authorName, authorEmail,
//         state: 'published' | 'closed',
//         moderation: { verdict, confidence, category, reasoning,
//                       evidence[], moderatedAt, reviewedBy?, reviewedAt?,
//                       opsDecision? }
//       }],
//       stats: { illegal: N, needsReview: N, resolved: N },
//     }
//
//   POST /api/admin/legal-moderation/decide
//     Body: { listingId, decision: 'reopen'|'confirm_block'|'mark_legal', note? }
//     - reopen: isdk.listings.open + metadata opsDecision='reopened'.
//       Útil si la IA bloqueó por error (falso positivo).
//     - confirm_block: isdk.listings.close + metadata opsDecision='blocked'.
//       Útil cuando un needs_review necesita bloqueo.
//     - mark_legal: metadata opsDecision='legal'. NO cambia state (ya
//       debería estar published). Para dual-use aprobados.

const { getIntegrationSdk } = require('../api-util/integrationSdk');

const CACHE_TTL_MS = 60 * 1000;
let cache = null;
let cacheAt = 0;

const MAX_PAGES = 20;
const PER_PAGE = 100;

const VALID_DECISIONS = new Set(['reopen', 'confirm_block', 'mark_legal']);

const list = async (req, res) => {
  if (cache && Date.now() - cacheAt < CACHE_TTL_MS) {
    return res.json({ ...cache, cached: true });
  }

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    const items = [];
    const authorIds = new Set();
    const authorsById = new Map();

    for (let page = 1; page <= MAX_PAGES; page++) {
      const resp = await isdk.listings.query({
        page,
        perPage: PER_PAGE,
        'fields.listing': ['title', 'description', 'price', 'state', 'publicData', 'createdAt'],
        include: ['author'],
        // Trae listings de cualquier estado — queremos ver los closed
        // (bloqueados por IA) también. states default es ['published'].
        states: ['published', 'closed', 'draft'],
      });
      const data = resp.data.data || [];
      for (const inc of resp.data.included || []) {
        if (inc.type === 'user') authorsById.set(inc.id.uuid, inc);
      }
      for (const l of data) {
        const mod = l.attributes?.publicData?.xololoLegalModeration;
        if (!mod || !mod.verdict) continue;
        // Omitimos 'legal' limpios Y ya resueltos por Ops (reduce ruido).
        if (mod.verdict === 'legal' && !mod.opsDecision) continue;
        const authorId = l.relationships?.author?.data?.id?.uuid || null;
        if (authorId) authorIds.add(authorId);
        items.push({
          listingId: l.id.uuid,
          title: l.attributes?.title || '(sin título)',
          description: l.attributes?.description || '',
          price: l.attributes?.price
            ? { amount: l.attributes.price.amount, currency: l.attributes.price.currency }
            : null,
          state: l.attributes?.state,
          categoryId: l.attributes?.publicData?.categoryLevel1 || null,
          listingType: l.attributes?.publicData?.listingType || null,
          createdAt: l.attributes?.createdAt || null,
          authorId,
          authorName: '',
          authorEmail: null,
          moderation: mod,
        });
      }
      const totalPages = resp.data.meta?.totalPages || 1;
      if (page >= totalPages) break;
    }

    // Resolvemos emails + nombres de authors en una pasada.
    if (authorIds.size > 0) {
      const emailByAuthor = new Map();
      const nameByAuthor = new Map();
      for (const id of authorIds) {
        try {
          const r = await isdk.users.show({ id });
          const u = r.data.data;
          emailByAuthor.set(id, u?.attributes?.email || '');
          nameByAuthor.set(
            id,
            u?.attributes?.profile?.displayName || u?.attributes?.profile?.firstName || ''
          );
        } catch (_) {
          emailByAuthor.set(id, '');
          nameByAuthor.set(id, '');
        }
      }
      for (const item of items) {
        if (item.authorId) {
          item.authorEmail = emailByAuthor.get(item.authorId) || '';
          item.authorName = nameByAuthor.get(item.authorId) || '';
        }
      }
    }

    // Orden: primero los sin decisión (urgentes), después los decididos.
    // Dentro, los illegal pendientes arriba.
    items.sort((a, b) => {
      const aPending = a.moderation.opsDecision ? 1 : 0;
      const bPending = b.moderation.opsDecision ? 1 : 0;
      if (aPending !== bPending) return aPending - bPending;
      const score = m => (m.verdict === 'illegal' ? 0 : m.verdict === 'needs_review' ? 1 : 2);
      return score(a.moderation) - score(b.moderation);
    });

    const stats = {
      illegal: items.filter(i => i.moderation.verdict === 'illegal').length,
      needsReview: items.filter(i => i.moderation.verdict === 'needs_review').length,
      resolved: items.filter(i => !!i.moderation.opsDecision).length,
    };

    cache = { items, stats };
    cacheAt = Date.now();
    return res.json({ items, stats, cached: false });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[admin-legal-moderation] list error:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

const decide = async (req, res) => {
  const { listingId, decision, note } = req.body || {};
  if (!listingId || typeof listingId !== 'string') {
    return res.status(400).json({ error: 'invalid_request', details: 'listingId requerido.' });
  }
  if (!VALID_DECISIONS.has(decision)) {
    return res.status(400).json({ error: 'invalid_request', details: 'decision inválida.' });
  }

  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  try {
    const resp = await isdk.listings.show({ id: listingId });
    const existing = resp.data.data?.attributes?.publicData?.xololoLegalModeration;
    if (!existing) {
      return res.status(400).json({ error: 'no_moderation' });
    }

    const updated = {
      ...existing,
      opsDecision: decision,
      reviewedBy: req.operator?.email || null,
      reviewedAt: new Date().toISOString(),
      opsNote: note || null,
    };

    await isdk.listings.update({
      id: listingId,
      publicData: { xololoLegalModeration: updated },
    });

    // Acción sobre el state del listing según la decisión.
    try {
      if (decision === 'reopen') {
        await isdk.listings.open({ id: listingId });
      } else if (decision === 'confirm_block') {
        await isdk.listings.close({ id: listingId });
      }
      // mark_legal: no toca state (ya debería estar published).
    } catch (stateErr) {
      // eslint-disable-next-line no-console
      console.warn('[admin-legal-moderation] state change failed:', stateErr?.message);
      // No fallamos el request — la metadata quedó marcada.
    }

    cache = null;
    cacheAt = 0;
    return res.json({ ok: true, moderation: updated });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[admin-legal-moderation] decide error:', e?.message);
    return res.status(500).json({ error: 'internal' });
  }
};

module.exports = { list, decide };
