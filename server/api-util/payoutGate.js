// XOLOLO Track #27 — fuente única de verdad del gate de payout.
//
// Dedupla la lógica que vivía inlined en 3 endpoints:
//   - server/api/seller-payout-gate.js      (status del seller actual)
//   - server/api/seller-pending-payouts.js  (status + monto retenido)
//   - server/api/admin-payout-queue.js      (cola Ops de pendientes)
// y la usa también como defensa server-side de `release`/`retry` del
// admin — NUNCA ejecutar un transfer si el gate no está satisfecho,
// aunque la UI de Ops lo haya pedido (falla cerrado contra errores
// de operador).
//
// Reglas (actualizadas 2026-11-23, task #27):
//   - stripeConnected: boolean de user.attributes.stripeConnected.
//   - legalDocsComplete: TODOS los slots requeridos (filtrados por
//     personType + sellerMode) tienen doc con status === 'approved'.
//     La versión v1 aceptaba "subido en cualquier status" — eso era
//     fase 1 y permitía que un seller con docs rechazados o en
//     revisión cruzara el gate. Fase 2 (task #27) cierra ese hueco.
//
// LOCKED: cambiar el criterio de approved (ej. volver a "uploaded")
// o removear la validación stripe requiere ADR explícito.

const { slotsForPersonType } = require('./legalDocSlots');

// Un documento cuenta como "aprobado" sólo cuando ops lo revisó y lo
// aceptó explícitamente. Pending, rejected, uploaded, vacío → no cuenta.
const isDocApproved = doc => !!doc && doc.status === 'approved';

/**
 * ¿Todos los slots requeridos del seller tienen doc APROBADO?
 *
 * @param {string|null} personType — 'fisica' | 'moral' | null
 * @param {Object} docs — map { [slotKey]: { status, ... } }
 * @param {string} sellerMode — 'store' | 'casual_reseller'
 * @returns {boolean}
 */
const isLegalDocsComplete = (personType, docs, sellerMode) => {
  if (!personType) return false;
  const required = slotsForPersonType(personType, sellerMode);
  if (!required.length) return false;
  return required.every(slot => isDocApproved(docs?.[slot.key]));
};

/**
 * Computa el gate completo a partir del entity del user y su flag
 * stripeConnected ya resuelto. Devuelve shape compatible con el que
 * ya consume el hook usePayoutGate y PayoutQueueView.
 *
 * @param {Object} params
 * @param {Object} params.user — user entity (de sdk.currentUser.show o isdk.users.show)
 * @param {boolean} [params.stripeConnected] — si se omite, se lee de user.attributes.stripeConnected
 * @returns {{
 *   canReceivePayout: boolean,
 *   blockers: Array<{key: string, label: string, routeName: string}>,
 *   stripeConnected: boolean,
 *   legalDocsComplete: boolean,
 * }}
 */
const computePayoutGate = ({ user, stripeConnected }) => {
  const attrs = user?.attributes || {};
  const profile = attrs.profile || {};
  const legalDocs = profile.metadata?.xololoLegalDocs || {};
  const sellerMode = profile.publicData?.sellerMode || 'store';

  const stripeOk =
    typeof stripeConnected === 'boolean' ? stripeConnected : attrs.stripeConnected === true;
  const legalDocsComplete = isLegalDocsComplete(
    legalDocs.personType || null,
    legalDocs.docs || {},
    sellerMode
  );

  const blockers = [];
  if (!stripeOk) {
    blockers.push({
      key: 'stripe',
      label: 'Conecta tu cuenta de banco para recibir tu dinero',
      routeName: 'StripePayoutPage',
    });
  }
  if (!legalDocsComplete) {
    blockers.push({
      key: 'legalDocs',
      label: 'Sube y espera la aprobación de tus documentos legales',
      routeName: 'LegalDocsPage',
    });
  }

  return {
    canReceivePayout: blockers.length === 0,
    blockers,
    stripeConnected: stripeOk,
    legalDocsComplete,
  };
};

module.exports = {
  isDocApproved,
  isLegalDocsComplete,
  computePayoutGate,
};
