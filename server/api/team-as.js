// XOLOLO Tier Empresarial · E5 — wrappers "actuar como" el admin.
//
// Cada endpoint:
//   1. Pasa por requirePermission(key) → verifica que el currentUser
//      (colaborador o el propio admin) tiene permiso para esta acción
//      en la tienda del `targetSellerId` resolvido.
//   2. Usa Integration SDK para ejecutar la mutación bajo la identidad
//      del admin (authorId / userId del admin, NO del colaborador).
//   3. Llama recordTeamAction en el audit log del admin.
//
// Esto evita que el colaborador afecte sus propias listings/transacciones
// cuando está "operando como" la tienda del admin, y mantiene al admin
// como responsable server-side.
//
// Nota operativa: todos estos endpoints requieren Integration SDK
// configurado (SHARETRIBE_INTEGRATION_CLIENT_ID/SECRET). Sin ellos
// devuelven 500 integration_api_missing.

const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { recordTeamAction } = require('../api-util/teamStore');

const auditOk = (req, action, target, result) => {
  const isdk = getIntegrationSdk();
  if (!isdk) return;
  recordTeamAction({
    isdk,
    adminId: req.actingAs.adminId,
    actor: {
      userId: req.actingAs.actorUserId,
      email: req.actingAs.actorEmail,
      name: req.actingAs.actorName,
    },
    action,
    target: target || null,
    result: result || 'ok',
  });
};

// ============================================================
// Listings
// ============================================================

const createListing = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  const { targetSellerId, listing } = req.body || {};
  if (!listing || typeof listing !== 'object') {
    return res.status(400).json({ error: 'listing_body_required' });
  }
  try {
    // authorId del admin — crítico. Si el caller lo pasa en el body,
    // lo IGNORAMOS y forzamos targetSellerId (único source of truth).
    const resp = await isdk.listings.create({
      ...listing,
      authorId: req.actingAs.adminId,
    });
    const created = resp.data.data;
    auditOk(req, 'listing.create', {
      listingId: created?.id?.uuid,
      title: created?.attributes?.title,
    });
    return res.json({ listing: created });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[team-as.createListing] error:', e?.message || e);
    auditOk(req, 'listing.create', { error: e?.message }, 'failed');
    return res.status(500).json({ error: 'internal', detail: e?.message });
  }
};

const updateListing = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  const { listingId, patch } = req.body || {};
  if (!listingId) return res.status(400).json({ error: 'listingId_required' });
  if (!patch || typeof patch !== 'object') {
    return res.status(400).json({ error: 'patch_required' });
  }

  // Guard crítico: antes de escribir, verificar que el listing pertenece
  // al admin del workspace. Un colaborador NO puede modificar listings
  // de otro seller.
  try {
    const current = await isdk.listings.show({ id: listingId, include: ['author'] });
    const authorId = current.data.data?.relationships?.author?.data?.id?.uuid;
    if (authorId !== req.actingAs.adminId) {
      return res.status(403).json({ error: 'listing_not_in_workspace' });
    }
    const resp = await isdk.listings.update({ id: listingId, ...patch });
    auditOk(req, 'listing.edit', { listingId });
    return res.json({ listing: resp.data.data });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[team-as.updateListing] error:', e?.message || e);
    auditOk(req, 'listing.edit', { listingId, error: e?.message }, 'failed');
    return res.status(500).json({ error: 'internal', detail: e?.message });
  }
};

const closeListing = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });
  const { listingId } = req.body || {};
  if (!listingId) return res.status(400).json({ error: 'listingId_required' });
  try {
    const current = await isdk.listings.show({ id: listingId, include: ['author'] });
    const authorId = current.data.data?.relationships?.author?.data?.id?.uuid;
    if (authorId !== req.actingAs.adminId) {
      return res.status(403).json({ error: 'listing_not_in_workspace' });
    }
    const resp = await isdk.listings.close({ id: listingId });
    auditOk(req, 'listing.close', { listingId });
    return res.json({ listing: resp.data.data });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[team-as.closeListing] error:', e?.message || e);
    return res.status(500).json({ error: 'internal', detail: e?.message });
  }
};

const openListing = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });
  const { listingId } = req.body || {};
  if (!listingId) return res.status(400).json({ error: 'listingId_required' });
  try {
    const current = await isdk.listings.show({ id: listingId, include: ['author'] });
    const authorId = current.data.data?.relationships?.author?.data?.id?.uuid;
    if (authorId !== req.actingAs.adminId) {
      return res.status(403).json({ error: 'listing_not_in_workspace' });
    }
    const resp = await isdk.listings.open({ id: listingId });
    auditOk(req, 'listing.open', { listingId });
    return res.json({ listing: resp.data.data });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[team-as.openListing] error:', e?.message || e);
    return res.status(500).json({ error: 'internal', detail: e?.message });
  }
};

// ============================================================
// Transactions / Orders
// ============================================================

const transitionTx = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  const { txId, transition, params = {} } = req.body || {};
  if (!txId || !transition) {
    return res.status(400).json({ error: 'txId_and_transition_required' });
  }

  // Guard: la tx debe pertenecer al admin del workspace (como provider).
  try {
    const current = await isdk.transactions.show({
      id: txId,
      include: ['provider'],
    });
    const providerId = current.data.data?.relationships?.provider?.data?.id?.uuid;
    if (providerId !== req.actingAs.adminId) {
      return res.status(403).json({ error: 'tx_not_in_workspace' });
    }

    const resp = await isdk.transactions.transition({
      id: txId,
      transition,
      params,
    });
    auditOk(req, `tx.${transition}`, { txId });
    return res.json({ transaction: resp.data.data });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[team-as.transitionTx] error:', e?.message || e);
    auditOk(req, `tx.${transition}`, { txId, error: e?.message }, 'failed');
    return res.status(500).json({ error: 'internal', detail: e?.message });
  }
};

const sendTxMessage = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  const { txId, content } = req.body || {};
  if (!txId || !content?.trim()) {
    return res.status(400).json({ error: 'txId_and_content_required' });
  }

  try {
    const current = await isdk.transactions.show({ id: txId, include: ['provider'] });
    const providerId = current.data.data?.relationships?.provider?.data?.id?.uuid;
    if (providerId !== req.actingAs.adminId) {
      return res.status(403).json({ error: 'tx_not_in_workspace' });
    }

    // Integration SDK envía el mensaje bajo la identidad del admin.
    // El buyer verá "Mensaje de <admin>" aunque internamente lo haya
    // tipeado un colaborador — por eso el audit es crítico.
    const resp = await isdk.messages.send({
      transactionId: txId,
      content: content.trim(),
    });
    auditOk(req, 'tx.message', {
      txId,
      preview: content.trim().slice(0, 80),
    });
    return res.json({ message: resp.data.data });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[team-as.sendTxMessage] error:', e?.message || e);
    return res.status(500).json({ error: 'internal', detail: e?.message });
  }
};

// ============================================================
// Store settings
// ============================================================

const updateStoreSettings = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  const { publicData, protectedData, profile } = req.body || {};
  if (!publicData && !protectedData && !profile) {
    return res.status(400).json({ error: 'nothing_to_update' });
  }

  // Blacklist de keys que no queremos que un colaborador manipule aunque
  // tenga 'store.settings'. Son campos que afectan payouts, suspension
  // state o relación de equipo — gobernados por OPS o Admin propio.
  const BLOCKED_PUBLIC_KEYS = new Set([
    'xololoVerified',
    'xololoVerifiedAt',
    'xololoSuspended',
    'xololoWorkspaces',
    'sellerMode',
  ]);
  const cleanPublic = publicData
    ? Object.fromEntries(
        Object.entries(publicData).filter(([k]) => !BLOCKED_PUBLIC_KEYS.has(k))
      )
    : null;
  // Metadata y protectedData no se exponen al cliente — por seguridad,
  // sólo aceptamos cambios a publicData y a profile top-level (firstName/
  // lastName/displayName). protectedData se ignora via workspace.
  const safeProfile = profile
    ? {
        displayName: profile.displayName,
        firstName: profile.firstName,
        lastName: profile.lastName,
        bio: profile.bio,
      }
    : null;

  try {
    const payload = { id: req.actingAs.adminId };
    if (cleanPublic && Object.keys(cleanPublic).length) {
      payload.publicData = cleanPublic;
    }
    if (safeProfile) {
      // profile.* se mapea directamente al nivel top: Sharetribe
      // Integration SDK acepta displayName, firstName, lastName, bio.
      if (safeProfile.displayName) payload.displayName = safeProfile.displayName;
      if (safeProfile.firstName) payload.firstName = safeProfile.firstName;
      if (safeProfile.lastName) payload.lastName = safeProfile.lastName;
      if (safeProfile.bio) payload.bio = safeProfile.bio;
    }
    const resp = await isdk.users.updateProfile(payload);
    auditOk(req, 'store.settings_update', {
      keys: [
        ...Object.keys(cleanPublic || {}).map(k => `publicData.${k}`),
        ...Object.keys(safeProfile || {}).map(k => `profile.${k}`),
      ],
    });
    return res.json({ user: resp.data.data });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[team-as.updateStoreSettings] error:', e?.message || e);
    return res.status(500).json({ error: 'internal', detail: e?.message });
  }
};

module.exports = {
  createListing,
  updateListing,
  closeListing,
  openListing,
  transitionTx,
  sendTxMessage,
  updateStoreSettings,
};
