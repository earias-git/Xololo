// XOLOLO 2026-11-18 — Endpoints públicos de comunidades.
//
// 3 rutas públicas (sin auth, cache 60s):
//   GET /api/communities                → lista comunidades publicadas
//   GET /api/communities/:slug          → una comunidad + first page de listings
//   GET /api/communities/:slug/listings → paginado con filtros
//
// El shape de /listings coincide con /api/landing-listings para que
// los selectores del cliente (SearchPage selectors) se reutilicen.
//
// LOCKED (ver docs/MODEL_COMMUNITIES_V1.md §7):
//   - 404 si la comunidad no existe o isPublished=false.
//   - NO exponer admins, createdBy, isPublished=false metadata.
//     El service ya filtra via getBySlugPublic / toPublic.

const service = require('../api-util/communitiesService');
const { isValidCommunityType } = require('../../src/util/communities');

const CACHE_HEADER = 'public, max-age=60, stale-while-revalidate=120';

// GET /api/communities
const list = (req, res) => {
  const communities = service.listPublic();
  res.set('Cache-Control', CACHE_HEADER);
  return res.status(200).json({ communities });
};

// GET /api/communities/:slug?type=sectorial
// El type es opcional (desambigua si ids colisionan entre types;
// hoy nunca pasa pero queda prevenido).
const show = async (req, res) => {
  const { slug } = req.params;
  const type = req.query?.type && isValidCommunityType(req.query.type)
    ? req.query.type
    : undefined;

  try {
    const payload = await service.getCommunityPayload(slug, type);
    if (!payload) return res.status(404).json({ error: 'community_not_found' });
    res.set('Cache-Control', CACHE_HEADER);
    return res.status(200).json(payload);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[api/communities:show]', e?.message);
    return res.status(500).json({ error: e?.message || 'internal_error' });
  }
};

// GET /api/communities/:slug/listings?page=1&perPage=24&categoryLevel1=...
const listingsForCommunity = async (req, res) => {
  const { slug } = req.params;
  const type = req.query?.type && isValidCommunityType(req.query.type)
    ? req.query.type
    : undefined;
  const page = Math.max(1, Number(req.query?.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(req.query?.perPage) || 24));

  // XOLOLO: pass-through de filtros Sharetribe (prefix pub_*) para
  // facet filtering server-side. V1: sólo categoryLevel1 y uso; el
  // resto se filtra client-side.
  const pubFilters = {};
  if (req.query?.categoryLevel1) {
    pubFilters.pub_categoryLevel1 = String(req.query.categoryLevel1);
  }
  if (req.query?.uso) {
    pubFilters.pub_uso = `has:${req.query.uso}`;
  }

  try {
    const payload = await service.getCommunityListings({
      slug,
      type,
      page,
      perPage,
      pubFilters: Object.keys(pubFilters).length ? pubFilters : undefined,
    });
    if (!payload) return res.status(404).json({ error: 'community_not_found' });
    // Cache sólo la primera página sin filtros.
    if (page === 1 && !Object.keys(pubFilters).length) {
      res.set('Cache-Control', CACHE_HEADER);
    }
    return res.status(200).json(payload);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[api/communities:listings]', e?.message);
    return res.status(500).json({ error: e?.message || 'internal_error' });
  }
};

module.exports = { list, show, listingsForCommunity };
