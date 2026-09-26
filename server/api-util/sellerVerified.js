// XOLOLO P3: cálculo y sincronización del badge "Xololo Verified".
//
// Fuente de verdad SERVER-side: los criterios miran metadata privada
// del usuario (subscription status, docs legales aprobados) — que sólo
// es visible vía Integration API. Para que el badge pueda mostrarse
// en cualquier página pública (storefront, ListingPage) sin exponer
// esa metadata, sincronizamos el resultado como un boolean en
// `profile.publicData.xololoVerified`.
//
// Criterios v1 (todos requeridos):
//   1. Suscripción activa (metadata.xololoSubscription.status === 'active')
//   2. Cobros configurados (attributes.stripeConnected === true)
//   3. Perfil completo (firstName, lastName, displayName, slug de tienda)
//   4. Documentos legales aprobados: TODOS los slots requeridos por su
//      personType tienen status='approved' en metadata.xololoLegalDocs
//
// PENDIENTE (docs/SUBSCRIPTIONS_V1.md §5): Facturama. Cuando timbre de
// facturas quede integrado, agregar el criterio 5 aquí. Por ahora se
// omite — no bloqueamos el badge por algo que aún no existe.
//
// Sync: `syncVerifiedBadge` debe llamarse tras cualquier evento que
// pueda cambiar el resultado. Ver call sites documentados en el JSDoc.

const { slotsForPersonType } = require('./legalDocSlots');

const isDocApproved = doc => doc && doc.status === 'approved';

/**
 * Computa el badge para un user entity ya cargado con metadata privada
 * (Integration API — `sdk.users.show`).
 * @param {Object} user — user entity con .attributes.profile.metadata poblado
 * @returns {boolean}
 */
const computeVerifiedFromUser = user => {
  const attrs = user?.attributes || {};
  const profile = attrs.profile || {};
  const publicData = profile.publicData || {};
  const metadata = profile.metadata || {};

  // (1) Subscription activa
  const sub = metadata.xololoSubscription || {};
  if (sub.status !== 'active') return false;

  // (2) Payouts configurados
  if (attrs.stripeConnected !== true) return false;

  // (3) Perfil completo
  if (!profile.firstName || !profile.lastName || !profile.displayName) return false;
  if (!publicData.slug) return false;

  // (4) Documentos legales aprobados
  const legal = metadata.xololoLegalDocs || {};
  const personType = legal.personType;
  if (!personType) return false;
  const requiredSlots = slotsForPersonType(personType);
  if (requiredSlots.length === 0) return false;
  const docs = legal.docs || {};
  const allApproved = requiredSlots.every(slot => isDocApproved(docs[slot.key]));
  if (!allApproved) return false;

  return true;
};

/**
 * Lee el user, computa el badge y — sólo si cambió — escribe
 * `profile.publicData.xololoVerified` y `profile.publicData.xololoVerifiedAt`.
 * Silencioso ante errores (no relanza): el caller no debe romper su
 * flujo principal porque el sync del badge falló.
 *
 * Call sites:
 *   - stripeBilling.syncSubscriptionMetadata (cuando cambia el status)
 *   - upload-legal-doc (al aprobarse/rechazarse un doc)
 *   - admin-legal-docs.review (idem)
 *   - Cualquier futuro handler que toque payouts, perfil o slug
 *
 * @param {Object} params
 * @param {Object} params.isdk — Integration SDK
 * @param {string} params.sellerId
 */
const syncVerifiedBadge = async ({ isdk, sellerId }) => {
  try {
    const resp = await isdk.users.show({ id: sellerId });
    const user = resp.data.data;
    const publicData = user.attributes?.profile?.publicData || {};
    const nextVerified = computeVerifiedFromUser(user);
    const prevVerified = publicData.xololoVerified === true;

    if (nextVerified === prevVerified) return { changed: false, verified: nextVerified };

    await isdk.users.updateProfile({
      id: sellerId,
      publicData: {
        xololoVerified: nextVerified,
        xololoVerifiedAt: nextVerified ? new Date().toISOString() : null,
      },
    });
    return { changed: true, verified: nextVerified };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[sellerVerified] sync falló para ${sellerId}:`, e?.message || e);
    return { changed: false, verified: null, error: e?.message || 'unknown' };
  }
};

module.exports = {
  computeVerifiedFromUser,
  syncVerifiedBadge,
};
