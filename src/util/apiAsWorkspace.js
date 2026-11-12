// XOLOLO Tier Empresarial · E5/E9 — helpers client-side para llamar los
// endpoints "actuar como" /api/team/as/*.
//
// Cuando la UI del colaborador quiere ejecutar una acción (crear
// listing, confirmar order, etc.) sobre la tienda del admin, usa estos
// helpers en lugar del trustedSdk nativo del cliente. El server rechaza
// con 403 si el colaborador no tiene permiso.
//
// En modo "propio" (currentWorkspace === null), un seller sigue usando
// los flows nativos de Sharetribe (sdk.ownListings.*, sdk.transactions.*).
// Estos helpers son para el camino "colaborador operando una tienda".
//
// E9 fase 2: todos los helpers de listings devuelven un response con
// shape SDK-compatible ({data: {data: X, included: [], meta: {}}}) para
// que los thunks reutilicen sin transformar — ver server/api/team-as.js.

import appSettings from '../config/settings';
import { apiBaseUrl, typeHandlers } from './api';
import { transit } from './sdkLoader';

// XOLOLO · E9 helper POST para endpoints "actuar como".
//
// Los endpoints custom de /api/team/as/* y /api/manage-listings responden
// Transit+JSON para preservar los tipos del SDK (Money, UUID, LatLng,
// BigDecimal). Si se parseara con res.json() plano, las instances se
// convertirían en plain objects y los helpers del SDK (formatMoney, etc.)
// crashearían con "Value must be a Money type".
//
// XOLOLO 2026-11-11: también el BODY se manda como transit — antes se
// JSON.stringify-aba, lo cual aplasta Money/UUID/LatLng/BigDecimal del
// payload del wizard (price, authorId, geolocation) a objetos planos
// que el Integration SDK rechaza en listings.create/update (síntoma:
// "Error al crear el borrador"). El router del server ya tiene
// middleware global `application/transit+json` → `transit.read`, así
// que el handler recibe los tipos reconstruidos sin trabajo extra.
//
// Retorna un objeto {data} para imitar el shape axios-like que usan los
// reducers (response.data.data, response.data.included, response.data.meta).
const serializeBody = data =>
  transit.write(data || {}, { typeHandlers, verbose: appSettings.sdk.transitVerbose });

const post = async (path, body) => {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/transit+json' },
    body: serializeBody(body),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const err = new Error(errData?.error || 'team_as_failed');
    err.status = res.status;
    err.data = errData;
    throw err;
  }
  // El server responde application/transit+json; deserializamos a
  // los tipos reales del SDK. En error el server sigue mandando JSON.
  const text = await res.text();
  const parsed = transit.read(text, { typeHandlers });
  return { data: parsed };
};

// -----------------------------------------------------------
// Listings — createDraft / publishDraft / update / discardDraft
// -----------------------------------------------------------

/**
 * Crea un listing draft bajo la identidad del admin.
 * @param {string} targetSellerId — admin owner.
 * @param {Object} listing — payload del wizard (title, description,
 *   price, publicData, metadata, images[]).
 * @param {Object} queryParams — include/fields para rehidratar response.
 */
export const createDraftAs = (targetSellerId, listing, queryParams) =>
  post('/api/team/as/listing/create-draft', { targetSellerId, listing, queryParams });

/**
 * Publica un listing que estaba en draft.
 */
export const publishDraftAs = (targetSellerId, listingId, queryParams) =>
  post('/api/team/as/listing/publish-draft', { targetSellerId, listingId, queryParams });

/**
 * Lee un listing del admin con los includes/fields del wizard. Se usa
 * en EditListingPage.duck.js cuando hay workspace activo: sdk.ownListings
 * no funciona para el colaborador (no es el owner).
 */
export const showListingAs = (targetSellerId, listingId, queryParams) =>
  post('/api/team/as/listing/show', { targetSellerId, listingId, queryParams });

/**
 * Actualiza un listing existente del admin. El server verifica que
 * authorId === targetSellerId antes de escribir.
 */
export const updateListingAs = (targetSellerId, listingId, patch, queryParams) =>
  post('/api/team/as/listing/update', { targetSellerId, listingId, patch, queryParams });

/**
 * Descarta (close) un listing draft que estaba en edición.
 */
export const discardDraftAs = (targetSellerId, listingId) =>
  post('/api/team/as/listing/discard-draft', { targetSellerId, listingId });

/**
 * Cierra un listing publicado.
 */
export const closeListingAs = (targetSellerId, listingId, queryParams) =>
  post('/api/team/as/listing/close', { targetSellerId, listingId, queryParams });

/**
 * Re-abre un listing cerrado.
 */
export const openListingAs = (targetSellerId, listingId, queryParams) =>
  post('/api/team/as/listing/open', { targetSellerId, listingId, queryParams });

/**
 * Actualiza el stock de un listing del admin (equivalente a
 * sdk.stock.compareAndSet).
 */
export const updateStockAs = (targetSellerId, listingId, oldTotal, newTotal) =>
  post('/api/team/as/listing/update-stock', {
    targetSellerId,
    listingId,
    oldTotal,
    newTotal,
  });

// -----------------------------------------------------------
// Legacy alias — createListing directo (no draft). Mantenido para
// backward compat; el wizard usa createDraftAs + publishDraftAs.
// -----------------------------------------------------------

export const createListingAs = (targetSellerId, listing, queryParams) =>
  post('/api/team/as/listing/create', { targetSellerId, listing, queryParams });

// -----------------------------------------------------------
// Transactions
// -----------------------------------------------------------

export const showTxAs = (targetSellerId, txId, queryParams) =>
  post('/api/team/as/tx/show', { targetSellerId, txId, queryParams });

export const queryTxMessagesAs = (targetSellerId, txId, queryParams) =>
  post('/api/team/as/tx/messages', { targetSellerId, txId, queryParams });

export const transitionTxAs = (targetSellerId, txId, transition, params) =>
  post('/api/team/as/tx/transition', { targetSellerId, txId, transition, params });

export const sendTxMessageAs = (targetSellerId, txId, content) =>
  post('/api/team/as/tx/message', { targetSellerId, txId, content });

// -----------------------------------------------------------
// Store settings
// -----------------------------------------------------------

/**
 * Actualiza publicData / profile top-level (displayName, firstName,
 * lastName, bio) del admin. El server filtra keys sensibles:
 * xololoVerified, xololoSuspended, xololoWorkspaces, sellerMode.
 */
export const updateStoreSettingsAs = (targetSellerId, { publicData, profile }) =>
  post('/api/team/as/store/settings', { targetSellerId, publicData, profile });
