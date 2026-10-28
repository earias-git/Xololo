// XOLOLO Tier Empresarial · E5 — helpers client-side para llamar los
// endpoints "actuar como" /api/team/as/*.
//
// Cuando la UI del colaborador quiere ejecutar una acción (crear
// listing, confirmar order, etc.) sobre la tienda del admin, usa estos
// helpers en lugar del trustedSdk nativo del cliente. El server rechaza
// con 403 si el colaborador no tiene permiso.
//
// En modo "propio" (currentWorkspace === null), un seller sigue usando
// los flows nativos de Sharetribe (trustedSdk.ownListings.*,
// trustedSdk.transactions.*). Estos helpers son para el camino
// "colaborador operando una tienda".

import { apiBaseUrl } from './api';

const post = async (path, body) => {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
};

/**
 * Crea un listing bajo la identidad del admin.
 * @param {string} targetSellerId — admin owner.
 * @param {Object} listing — payload tipo { title, description, price,
 *   publicData, metadata, images[], state }.
 */
export const createListingAs = (targetSellerId, listing) =>
  post('/api/team/as/listing/create', { targetSellerId, listing });

/**
 * Actualiza un listing que pertenece al admin. El server verifica que
 * authorId === targetSellerId antes de escribir.
 */
export const updateListingAs = (targetSellerId, listingId, patch) =>
  post('/api/team/as/listing/update', { targetSellerId, listingId, patch });

export const closeListingAs = (targetSellerId, listingId) =>
  post('/api/team/as/listing/close', { targetSellerId, listingId });

export const openListingAs = (targetSellerId, listingId) =>
  post('/api/team/as/listing/open', { targetSellerId, listingId });

/**
 * Dispara una transition en una transacción del admin.
 */
export const transitionTxAs = (targetSellerId, txId, transition, params) =>
  post('/api/team/as/tx/transition', { targetSellerId, txId, transition, params });

export const sendTxMessageAs = (targetSellerId, txId, content) =>
  post('/api/team/as/tx/message', { targetSellerId, txId, content });

/**
 * Actualiza publicData / profile top-level (displayName, firstName,
 * lastName, bio) del admin. El server filtra keys sensibles:
 * xololoVerified, xololoSuspended, xololoWorkspaces, sellerMode.
 */
export const updateStoreSettingsAs = (targetSellerId, { publicData, profile }) =>
  post('/api/team/as/store/settings', { targetSellerId, publicData, profile });
