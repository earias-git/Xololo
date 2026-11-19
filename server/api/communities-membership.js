// XOLOLO 2026-11-18 — Endpoints de membership de comunidades (ADR-006 PR-3).
//
// Rutas autenticadas (user via sdk.currentUser.show):
//   POST /api/communities/:slug/join   → une al current user
//   POST /api/communities/:slug/leave  → lo saca
//   GET  /api/me/communities           → lista las comunidades del user
//
// Guardarraíles:
//   - Rate limit `community` (5/min por user).
//   - Sólo el current user puede modificar sus propias memberships.
//     No hay forma de join-por-otro-user en estos endpoints (eso va
//     en PR-4 admin).
//   - Si la comunidad `membership !== 'open'` en V1 devolvemos 403
//     con status `not_open`. Los flujos request/invite van en V2.
//   - Si `requiresCertification=true`, 403 con status `cert_required`.
//     El flujo de upload va en PR-4+.

const { getSdk } = require('../api-util/sdk');
const communitiesService = require('../api-util/communitiesService');
const communityMembership = require('../api-util/communityMembership');
const { isValidCommunityType } = require('../../src/util/communities');

const _authSeller = async (req, res) => {
  try {
    const sdk = getSdk(req, res);
    const resp = await sdk.currentUser.show();
    const id = resp.data?.data?.id?.uuid;
    if (!id) {
      res.status(401).json({ error: 'unauthorized' });
      return null;
    }
    return id;
  } catch (_) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
};

const _resolveCommunityForMutation = (req, res) => {
  const { slug } = req.params;
  const typeHint = req.query?.type && isValidCommunityType(req.query.type)
    ? req.query.type
    : undefined;
  const community = communitiesService.getBySlug(slug, typeHint);
  if (!community || community.isDeleted) {
    res.status(404).json({ error: 'community_not_found' });
    return null;
  }
  // El seller sólo puede unirse si está publicada. Un draft no es
  // joinable (el admin puede pre-invitar con PR-4).
  if (!community.isPublished) {
    res.status(404).json({ error: 'community_not_published' });
    return null;
  }
  return community;
};

// POST /api/communities/:slug/join
const join = async (req, res) => {
  const sellerId = await _authSeller(req, res);
  if (!sellerId) return;

  const community = _resolveCommunityForMutation(req, res);
  if (!community) return;

  if (community.membership && community.membership !== 'open') {
    return res.status(403).json({
      error: 'not_open',
      details: `Membership mode = ${community.membership}. Flujo request/invite no disponible en V1.`,
    });
  }
  if (community.requiresCertification) {
    return res.status(403).json({
      error: 'cert_required',
      details: 'Esta comunidad requiere certificación aprobada. Flujo no disponible en V1.',
    });
  }

  try {
    const result = await communityMembership.joinCommunity(sellerId, {
      id: community.id,
      type: community.type,
    });
    return res.status(200).json({
      ...result,
      community: communitiesService.toPublic(community),
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[communities-membership:join]', e?.message);
    return res.status(500).json({ error: e?.message || 'join_failed' });
  }
};

// POST /api/communities/:slug/leave
const leave = async (req, res) => {
  const sellerId = await _authSeller(req, res);
  if (!sellerId) return;

  const community = _resolveCommunityForMutation(req, res);
  if (!community) return;

  try {
    const result = await communityMembership.leaveCommunity(sellerId, {
      id: community.id,
      type: community.type,
    });
    return res.status(200).json({
      ...result,
      community: communitiesService.toPublic(community),
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[communities-membership:leave]', e?.message);
    return res.status(500).json({ error: e?.message || 'leave_failed' });
  }
};

// GET /api/me/communities?targetSellerId=<uuid>
// targetSellerId opcional — útil cuando el user es colaborador y
// está editando listings del Negocio: devuelve las comunidades del
// Negocio (author), no las del colaborador. Si no viene, usa el
// currentUser (comportamiento legacy).
const myCommunities = async (req, res) => {
  const sellerId = await _authSeller(req, res);
  if (!sellerId) return;

  const targetSellerId = req.query?.targetSellerId
    ? String(req.query.targetSellerId)
    : sellerId;

  // Validación de permiso cuando el target es otro seller:
  // el user debe tener workspace activo con el target.
  if (targetSellerId !== sellerId) {
    try {
      const { getIntegrationSdk } = require('../api-util/integrationSdk');
      const isdk = getIntegrationSdk();
      const uResp = await isdk.users.show({ id: sellerId });
      const workspaces =
        uResp.data?.data?.attributes?.profile?.publicData?.xololoWorkspaces
          ?.workspaces || [];
      const hasActive = workspaces.some(
        w => w?.adminId === targetSellerId && w?.status === 'active'
      );
      if (!hasActive) {
        return res.status(403).json({ error: 'not_a_collaborator' });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[communities-membership:myCommunities] auth check', e?.message);
      return res.status(500).json({ error: 'auth_check_failed' });
    }
  }

  try {
    const communities = await communityMembership.listSellerMemberships(targetSellerId);
    return res.status(200).json({ communities });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[communities-membership:myCommunities]', e?.message);
    return res.status(500).json({ error: e?.message || 'list_failed' });
  }
};

// XOLOLO 2026-11-18 — PATCH /api/me/listings/:id/communities
// Body: { includeInCommunities?: string[], excludeFromCommunities?: string[] }
// Permite al seller marcar que un listing específico aparezca
// (opt-in para sectoriales) o no aparezca (opt-out para geográficas)
// en ciertas comunidades suyas.
const setListingCommunities = async (req, res) => {
  const sellerId = await _authSeller(req, res);
  if (!sellerId) return;

  const listingId = req.params?.id;
  if (!listingId) return res.status(400).json({ error: 'missing_listing_id' });

  // XOLOLO 2026-11-19 — bug fix crítico: antes solo extraíamos
  // excludeFromCommunities del body, ignorando includeInCommunities.
  // Esto causaba que el toggle de OPF (sectorial opt-in) siempre
  // guardara included=[] en el server, aunque el frontend mandaba
  // ['opf']. Reportado por earias con logs del server que mostraban
  // rawBody con ['opf'] pero requestedInclude=[] en el helper.
  const includeInCommunities = req.body?.includeInCommunities;
  const excludeFromCommunities = req.body?.excludeFromCommunities;

  // Al menos uno debe venir; ambos deben ser arrays si vienen.
  if (includeInCommunities !== undefined && !Array.isArray(includeInCommunities)) {
    return res.status(400).json({ error: 'invalid_include_list' });
  }
  if (excludeFromCommunities !== undefined && !Array.isArray(excludeFromCommunities)) {
    return res.status(400).json({ error: 'invalid_exclude_list' });
  }
  if (includeInCommunities === undefined && excludeFromCommunities === undefined) {
    return res.status(400).json({ error: 'missing_include_or_exclude' });
  }

  // XOLOLO 2026-11-19 — log del body EXACTO que llega al endpoint
  // para debug.
  // eslint-disable-next-line no-console
  console.log(
    `[communities-membership:PATCH] listingId=${listingId} rawBody=${JSON.stringify(
      req.body || null
    )}`
  );

  try {
    const result = await communityMembership.setListingCommunities({
      sellerId,
      listingId,
      includeInCommunities,
      excludeFromCommunities,
    });
    return res.status(200).json(result);
  } catch (e) {
    const msg = e?.message || 'set_failed';
    const status =
      msg === 'not_listing_owner' ? 403 :
      msg === 'author_not_found' ? 404 :
      msg === 'missing_listing_id' ? 400 :
      msg === 'invalid_include_list' ? 400 :
      msg === 'invalid_exclude_list' ? 400 :
      msg === 'missing_include_or_exclude' ? 400 :
      500;
    // eslint-disable-next-line no-console
    console.error('[communities-membership:setListingCommunities]', msg);
    return res.status(status).json({ error: msg });
  }
};

module.exports = {
  join,
  leave,
  myCommunities,
  setListingCommunities,
};
