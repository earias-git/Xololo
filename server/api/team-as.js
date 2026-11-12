// XOLOLO Tier Empresarial · E5/E9 — wrappers "actuar como" el admin.
//
// Cada endpoint:
//   1. Pasa por requirePermission(key) → verifica que el currentUser
//      (colaborador o el propio admin) tiene permiso para esta acción
//      en la tienda del `targetSellerId` resolvido.
//   2. Usa Integration SDK para ejecutar la mutación bajo la identidad
//      del admin (authorId / userId del admin, NO del colaborador).
//   3. Llama recordTeamAction en el audit log del admin.
//   4. Devuelve response con shape SDK-compatible
//      ({data: {data: ..., included: [], meta: {}}}) para que los
//      thunks client reutilicen sin transformar.
//
// E9 fase 2 (2026-11-05): ampliado para cubrir el ciclo completo del
// EditListingPage wizard: createDraft, publishDraft, discardDraft,
// updateStock, además de create/update/close/open originales.
//
// Nota operativa: todos estos endpoints requieren Integration SDK
// configurado (SHARETRIBE_INTEGRATION_CLIENT_ID/SECRET). Sin ellos
// devuelven 500 integration_api_missing.

const { types: sdkTypes } = require('sharetribe-flex-integration-sdk');
const { getIntegrationSdk } = require('../api-util/integrationSdk');
const { recordTeamAction } = require('../api-util/teamStore');
const { sendTransit } = require('../api-util/transitResponse');

// XOLOLO 2026-11-11: wrap defensivo string→UUID. El body viene por
// transit, así que un listingId/UUID que el cliente mandó como instance
// llega como instance; pero adminId (de la session cookie) es string.
// El Integration SDK exige UUID para authorId/listingId.
const asUUID = v => {
  if (!v) return v;
  if (typeof v === 'object' && v._sdkType === 'UUID') return v;
  return new sdkTypes.UUID(v);
};

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

// Normaliza queryParams del body a un objeto plano. Acepta include[],
// fields.listing, fields.image, fields.user, y las claves de image
// variants que CRA/Sharetribe generan dinámicamente (ej "imageVariant.x").
const sanitizeQueryParams = raw => {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    // Permitimos cualquier clave que empiece con "fields." o "limit." o
    // sea "include" o "imageVariant.". Rechazamos keys desconocidas por
    // precaución.
    if (
      k === 'include' ||
      k === 'expand' ||
      k.startsWith('fields.') ||
      k.startsWith('limit.') ||
      k.startsWith('imageVariant.')
    ) {
      out[k] = v;
    }
  }
  return out;
};

// Re-fetch del listing con los includes/fields del wizard para que la
// respuesta tenga el shape SDK completo que el frontend espera (author,
// images, currentStock, etc.). isdk.listings.show devuelve
// { data: {data: listing, included: [...], meta: {}} } directamente —
// envolvemos en {data: ...} para imitar axios-like response del SDK
// que el payload creator del thunk espera.
//
// XOLOLO E9 fase 2: los reducers del wizard (EditListingPage,
// ManageListingsPage) guardan listings en la slice "ownListing" y
// no en "listing". Integration SDK marca los recursos como type:'listing'
// — reescribimos a 'ownListing' para que el flow nativo encuentre el
// resource en el store de Redux.
const toOwnListingType = r => (r && r.type === 'listing' ? { ...r, type: 'ownListing' } : r);

// Devuelve el payload interno {data, included, meta} — el caller lo
// envía via sendTransit. En el cliente, el shape final equivalente al
// del SDK (`response.data.data`) viene de que fetch wrappea el body
// transit-deserializado como `.data`.
const rehydrateAsSdk = async (isdk, listingId, queryParams) => {
  const resp = await isdk.listings.show({
    id: asUUID(listingId),
    ...sanitizeQueryParams(queryParams),
  });
  return {
    data: toOwnListingType(resp.data.data),
    included: (resp.data.included || []).map(toOwnListingType),
    meta: resp.data.meta || {},
  };
};

// Guard: verifica que el listing pertenezca al admin del workspace.
// Devuelve null si OK, o un error-response para enviar al cliente.
const ensureListingBelongsToAdmin = async (isdk, listingId, adminId) => {
  const current = await isdk.listings.show({ id: asUUID(listingId), include: ['author'] });
  const authorId = current.data.data?.relationships?.author?.data?.id?.uuid;
  if (authorId !== adminId) {
    return { status: 403, body: { error: 'listing_not_in_workspace' } };
  }
  return null;
};

// ============================================================
// Listings — create / createDraft
// ============================================================

// Crea un listing en estado draft (análogo a sdk.ownListings.createDraft).
// authorId forzado al admin del workspace.
const createDraft = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  const { listing, queryParams } = req.body || {};
  if (!listing || typeof listing !== 'object') {
    return res.status(400).json({ error: 'listing_body_required' });
  }
  try {
    // state 'draft' explícito — el admin publicará en un paso separado.
    const resp = await isdk.listings.create({
      ...listing,
      authorId: asUUID(req.actingAs.adminId),
      state: 'draft',
    });
    const created = resp.data.data;
    const listingId = created.id.uuid;
    auditOk(req, 'listing.create_draft', {
      listingId,
      title: created?.attributes?.title,
    });
    // Rehidratamos con los includes del wizard.
    const sdkLike = await rehydrateAsSdk(isdk, listingId, queryParams);
    return sendTransit(res, sdkLike);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[team-as.createDraft] error:', e?.message || e);
    if (e?.data?.errors) {
      // eslint-disable-next-line no-console
      console.error('[team-as.createDraft] sdk errors:', JSON.stringify(e.data.errors, null, 2));
    }
    // eslint-disable-next-line no-console
    console.error('[team-as.createDraft] payload keys:', Object.keys(listing || {}));
    auditOk(req, 'listing.create_draft', { error: e?.message }, 'failed');
    return res.status(500).json({
      error: 'internal',
      detail: e?.message,
      // storableError client-side lee error.data.errors → apiErrors.
      // Al llamarlo "errors" el flujo estándar lo expone sin cambios.
      data: { errors: e?.data?.errors || [] },
    });
  }
};

// Legacy alias: createListing crea directo en 'published'. Lo mantenemos
// por backward compat; el flujo del wizard usa createDraft + publishDraft.
const createListing = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });
  const { listing, queryParams } = req.body || {};
  if (!listing || typeof listing !== 'object') {
    return res.status(400).json({ error: 'listing_body_required' });
  }
  try {
    const resp = await isdk.listings.create({
      ...listing,
      authorId: asUUID(req.actingAs.adminId),
    });
    const created = resp.data.data;
    const listingId = created.id.uuid;
    auditOk(req, 'listing.create', { listingId, title: created?.attributes?.title });
    const sdkLike = await rehydrateAsSdk(isdk, listingId, queryParams);
    return sendTransit(res, sdkLike);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[team-as.createListing] error:', e?.message || e);
    auditOk(req, 'listing.create', { error: e?.message }, 'failed');
    return res.status(500).json({ error: 'internal', detail: e?.message });
  }
};

// ============================================================
// Listings — show (lectura del listing del admin para el wizard)
// ============================================================

// Lee un listing del admin bajo la identidad del Integration SDK.
// Lo usa EditListingPage.duck.js showListingThunk cuando hay workspace
// activo: sdk.ownListings.show falla porque el listing no pertenece al
// colaborador. Reutilizamos rehydrateAsSdk para devolver el shape SDK
// que espera el reducer, incluyendo author/images/currentStock.
const showListing = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  const { listingId, queryParams } = req.body || {};
  if (!listingId) return res.status(400).json({ error: 'listingId_required' });

  try {
    const guard = await ensureListingBelongsToAdmin(isdk, listingId, req.actingAs.adminId);
    if (guard) return res.status(guard.status).json(guard.body);

    const sdkLike = await rehydrateAsSdk(isdk, listingId, queryParams);
    return sendTransit(res, sdkLike);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[team-as.showListing] error:', e?.message || e);
    return res.status(500).json({ error: 'internal', detail: e?.message });
  }
};

// ============================================================
// Listings — update / publishDraft / discardDraft / close / open
// ============================================================

const updateListing = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  const { listingId, patch, queryParams } = req.body || {};
  if (!listingId) return res.status(400).json({ error: 'listingId_required' });
  if (!patch || typeof patch !== 'object') {
    return res.status(400).json({ error: 'patch_required' });
  }

  try {
    const guard = await ensureListingBelongsToAdmin(isdk, listingId, req.actingAs.adminId);
    if (guard) return res.status(guard.status).json(guard.body);

    await isdk.listings.update({ id: asUUID(listingId), ...patch });
    auditOk(req, 'listing.edit', { listingId });
    const sdkLike = await rehydrateAsSdk(isdk, listingId, queryParams);
    return sendTransit(res, sdkLike);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[team-as.updateListing] error:', e?.message || e);
    if (e?.data?.errors) {
      // eslint-disable-next-line no-console
      console.error('[team-as.updateListing] sdk errors:', JSON.stringify(e.data.errors, null, 2));
    }
    auditOk(req, 'listing.edit', { listingId, error: e?.message }, 'failed');
    return res.status(500).json({
      error: 'internal',
      detail: e?.message,
      data: { errors: e?.data?.errors || [] },
    });
  }
};

const publishDraft = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  const { listingId, queryParams } = req.body || {};
  if (!listingId) return res.status(400).json({ error: 'listingId_required' });

  try {
    const guard = await ensureListingBelongsToAdmin(isdk, listingId, req.actingAs.adminId);
    if (guard) return res.status(guard.status).json(guard.body);

    // Integration SDK: publish mueve el state draft → pendingApproval o
    // published según la política del marketplace.
    await isdk.listings.approve({ id: asUUID(listingId) }).catch(async () => {
      // Si approve falla (no moderado), probamos con update state.
      await isdk.listings.update({ id: asUUID(listingId), state: 'published' });
    });
    auditOk(req, 'listing.publish', { listingId });
    const sdkLike = await rehydrateAsSdk(isdk, listingId, queryParams);
    return sendTransit(res, sdkLike);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[team-as.publishDraft] error:', e?.message || e);
    auditOk(req, 'listing.publish', { listingId, error: e?.message }, 'failed');
    return res.status(500).json({ error: 'internal', detail: e?.message });
  }
};

const discardDraft = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  const { listingId } = req.body || {};
  if (!listingId) return res.status(400).json({ error: 'listingId_required' });

  try {
    const guard = await ensureListingBelongsToAdmin(isdk, listingId, req.actingAs.adminId);
    if (guard) return res.status(guard.status).json(guard.body);

    // Integration SDK no expone discardDraft explícito; cerramos el
    // listing (close deja un listing en estado "closed" que ya no es
    // visible). Es el equivalente operacional al discard del wizard.
    const resp = await isdk.listings.close({ id: asUUID(listingId) });
    auditOk(req, 'listing.discard_draft', { listingId });
    return sendTransit(res, { data: toOwnListingType(resp.data.data), included: [], meta: {} });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[team-as.discardDraft] error:', e?.message || e);
    auditOk(req, 'listing.discard_draft', { listingId, error: e?.message }, 'failed');
    return res.status(500).json({ error: 'internal', detail: e?.message });
  }
};

const closeListing = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });
  const { listingId, queryParams } = req.body || {};
  if (!listingId) return res.status(400).json({ error: 'listingId_required' });
  try {
    const guard = await ensureListingBelongsToAdmin(isdk, listingId, req.actingAs.adminId);
    if (guard) return res.status(guard.status).json(guard.body);
    await isdk.listings.close({ id: asUUID(listingId) });
    auditOk(req, 'listing.close', { listingId });
    const sdkLike = await rehydrateAsSdk(isdk, listingId, queryParams);
    return sendTransit(res, sdkLike);
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
  const { listingId, queryParams } = req.body || {};
  if (!listingId) return res.status(400).json({ error: 'listingId_required' });
  try {
    const guard = await ensureListingBelongsToAdmin(isdk, listingId, req.actingAs.adminId);
    if (guard) return res.status(guard.status).json(guard.body);
    await isdk.listings.open({ id: asUUID(listingId) });
    auditOk(req, 'listing.open', { listingId });
    const sdkLike = await rehydrateAsSdk(isdk, listingId, queryParams);
    return sendTransit(res, sdkLike);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[team-as.openListing] error:', e?.message || e);
    return res.status(500).json({ error: 'internal', detail: e?.message });
  }
};

// ============================================================
// Stock (compareAndSet)
// ============================================================

// El wizard llama sdk.stock.compareAndSet({listingId, oldTotal, newTotal})
// para actualizar el stock de un listing. Lo replicamos como admin.
const updateStock = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  const { listingId, oldTotal, newTotal } = req.body || {};
  if (!listingId) return res.status(400).json({ error: 'listingId_required' });
  if (typeof newTotal !== 'number') return res.status(400).json({ error: 'newTotal_required' });

  try {
    const guard = await ensureListingBelongsToAdmin(isdk, listingId, req.actingAs.adminId);
    if (guard) return res.status(guard.status).json(guard.body);
    const resp = await isdk.stock.compareAndSet({
      listingId: asUUID(listingId),
      oldTotal: oldTotal == null ? null : oldTotal,
      newTotal,
    });
    auditOk(req, 'listing.stock_update', { listingId, newTotal });
    return sendTransit(res, { data: resp.data.data, included: [], meta: {} });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[team-as.updateStock] error:', e?.message || e);
    auditOk(req, 'listing.stock_update', { listingId, error: e?.message }, 'failed');
    return res.status(500).json({ error: 'internal', detail: e?.message });
  }
};

// ============================================================
// Transactions / Orders
// ============================================================

// Lectura del detalle de una transaction (equivalente a
// sdk.transactions.show). Verifica que la tx pertenezca al admin del
// workspace (provider === adminId) y la devuelve con el shape que
// TransactionPage.duck.js espera.
const showTx = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  const { txId, queryParams } = req.body || {};
  if (!txId) return res.status(400).json({ error: 'txId_required' });

  try {
    const resp = await isdk.transactions.show({
      id: asUUID(txId),
      ...sanitizeQueryParams(queryParams),
    });
    const providerId = resp.data.data?.relationships?.provider?.data?.id?.uuid;
    if (providerId !== req.actingAs.adminId) {
      return res.status(403).json({ error: 'tx_not_in_workspace' });
    }
    return sendTransit(res, {
      data: resp.data.data,
      included: resp.data.included || [],
      meta: resp.data.meta || {},
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[team-as.showTx] error:', e?.message || e);
    return res.status(500).json({ error: 'internal', detail: e?.message });
  }
};

// Query de messages de una transaction.
const queryMessages = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  const { txId, queryParams } = req.body || {};
  if (!txId) return res.status(400).json({ error: 'txId_required' });

  try {
    // Guard: solo mensajes de txs del admin.
    const tx = await isdk.transactions.show({ id: asUUID(txId), include: ['provider'] });
    const providerId = tx.data.data?.relationships?.provider?.data?.id?.uuid;
    if (providerId !== req.actingAs.adminId) {
      return res.status(403).json({ error: 'tx_not_in_workspace' });
    }
    const resp = await isdk.messages.query({
      transactionId: asUUID(txId),
      ...sanitizeQueryParams(queryParams),
    });
    return sendTransit(res, {
      data: resp.data.data,
      included: resp.data.included || [],
      meta: resp.data.meta || {},
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[team-as.queryMessages] error:', e?.message || e);
    return res.status(500).json({ error: 'internal', detail: e?.message });
  }
};

const transitionTx = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const isdk = getIntegrationSdk();
  if (!isdk) return res.status(500).json({ error: 'integration_api_missing' });

  const { txId, transition, params = {} } = req.body || {};
  if (!txId || !transition) {
    return res.status(400).json({ error: 'txId_and_transition_required' });
  }

  try {
    const current = await isdk.transactions.show({
      id: asUUID(txId),
      include: ['provider'],
    });
    const providerId = current.data.data?.relationships?.provider?.data?.id?.uuid;
    if (providerId !== req.actingAs.adminId) {
      return res.status(403).json({ error: 'tx_not_in_workspace' });
    }

    const resp = await isdk.transactions.transition({
      id: asUUID(txId),
      transition,
      params,
    });
    auditOk(req, `tx.${transition}`, { txId });
    return sendTransit(res, {
      data: resp.data.data,
      included: resp.data.included || [],
      meta: resp.data.meta || {},
    });
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
    const current = await isdk.transactions.show({ id: asUUID(txId), include: ['provider'] });
    const providerId = current.data.data?.relationships?.provider?.data?.id?.uuid;
    if (providerId !== req.actingAs.adminId) {
      return res.status(403).json({ error: 'tx_not_in_workspace' });
    }

    const resp = await isdk.messages.send({
      transactionId: asUUID(txId),
      content: content.trim(),
    });
    auditOk(req, 'tx.message', {
      txId,
      preview: content.trim().slice(0, 80),
    });
    return sendTransit(res, {
      data: resp.data.data,
      included: resp.data.included || [],
      meta: resp.data.meta || {},
    });
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
  const safeProfile = profile
    ? {
        displayName: profile.displayName,
        firstName: profile.firstName,
        lastName: profile.lastName,
        bio: profile.bio,
      }
    : null;

  try {
    const payload = { id: asUUID(req.actingAs.adminId) };
    if (cleanPublic && Object.keys(cleanPublic).length) {
      payload.publicData = cleanPublic;
    }
    if (safeProfile) {
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
  createDraft,
  showListing,
  updateListing,
  publishDraft,
  discardDraft,
  closeListing,
  openListing,
  updateStock,
  showTx,
  queryMessages,
  transitionTx,
  sendTxMessage,
  updateStoreSettings,
};
