// XOLOLO 2026-11-23 — ADR-007: gate de publish por plan activo.
//
// Regla:
//   - casual_reseller → siempre puede (exento, Art. 9 IV LIVA — no
//     paga suscripción por diseño).
//   - store → puede si subscription.status ∈ {active, trialing,
//     past_due}. Bloqueado si canceled/none/undefined.
//
// Preview SIEMPRE libre: cualquier user autenticado puede crear
// drafts y recorrer el wizard. El gate solo aplica al botón final
// "Publicar".
//
// LOCKED (ver docs/decisions/ADR-007-publish-gated-by-plan.md):
//   - No mover el listado de PUBLISHABLE_STATUSES sin ADR update.
//   - No eximir a 'store' sin ADR update.
//   - No usar este helper para decidir visibilidad de listings ya
//     publicados (ese es el auto-close del webhook — PR 2).

import { isCasualReseller } from './xololoSellerMode';

export const PUBLISHABLE_STATUSES = ['active', 'trialing', 'past_due'];

export const CANNOT_PUBLISH_REASONS = {
  NO_PLAN: 'no_plan', // nunca se suscribió / status null / 'none'
  CANCELED: 'canceled', // tenía plan, lo canceló
  UNKNOWN: 'unknown', // status inesperado (defensive)
};

/**
 * Decide si un seller puede completar el publish de un listing.
 *
 * @param {Object} currentUser - API entity del user autenticado
 * @param {Object} subscription - { status, plan, ... } de /api/seller-subscription
 * @returns {{ allowed: boolean, reason: string }}
 *   allowed=true → reason ∈ {'casual_exempt','active','trialing','past_due'}
 *   allowed=false → reason ∈ CANNOT_PUBLISH_REASONS
 */
export const canPublishListings = (currentUser, subscription) => {
  if (!currentUser?.id) {
    return { allowed: false, reason: CANNOT_PUBLISH_REASONS.NO_PLAN };
  }

  if (isCasualReseller(currentUser)) {
    return { allowed: true, reason: 'casual_exempt' };
  }

  const status = subscription?.status;

  if (!status || status === 'none') {
    return { allowed: false, reason: CANNOT_PUBLISH_REASONS.NO_PLAN };
  }

  if (status === 'canceled') {
    return { allowed: false, reason: CANNOT_PUBLISH_REASONS.CANCELED };
  }

  if (PUBLISHABLE_STATUSES.includes(status)) {
    return { allowed: true, reason: status };
  }

  return { allowed: false, reason: CANNOT_PUBLISH_REASONS.UNKNOWN };
};

/**
 * Formato compacto para condicionar UI sin desestructurar.
 */
export const isPublishAllowed = (currentUser, subscription) =>
  canPublishListings(currentUser, subscription).allowed;
