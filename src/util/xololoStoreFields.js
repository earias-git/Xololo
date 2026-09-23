// XOLOLO: userFields (configurados en Sharetribe Console, scope
// 'public') que en realidad son campos de TIENDA — ManageStorePage
// tiene su propio formulario dedicado para ellos
// (src/containers/ManageStorePage/). El template renderiza TODOS los
// userFields públicos por default en cualquier formulario genérico de
// datos de usuario (signup, "Datos personales"), duplicándolos ahí.
//
// Feedback directo de earias tras navegar el sitio (2026-09-24):
//   - b.2: se filtran de "Datos personales" (ProfileSettingsPage).
//   - registro: se filtran del formulario de signup — una cuenta
//     nueva debe pedir sólo lo básico (email, nombre, password); la
//     tienda se configura DESPUÉS, en "Mi tienda".
//
// Fuente única para no duplicar/desincronizar la lista entre los 2
// lugares que la usan.
export const STORE_FIELD_KEYS = new Set([
  'slug',
  'shortDescription',
  'longDescription',
  'brandPrimaryColor',
  'brandSecondaryColor',
  'logoUrl',
  'bannerUrl',
  'bannerUrl2',
  'bannerUrl3',
  'whatsapp',
  'instagram',
  'facebook',
  'legalName',
  'legalAddress',
  'commercialAddress',
  'pickupAddress',
  'commercialSameAsLegal',
  'pickupSameAsLegal',
  'pickupReferences',
  'address',
  'originPostalCode',
  'primaryCategory',
  'showCalendar',
]);

export const excludeStoreFields = userFields =>
  (userFields || []).filter(uf => !STORE_FIELD_KEYS.has(uf.key));
