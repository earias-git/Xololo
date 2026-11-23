# ADR-007 — Publish gated por plan activo

**Fecha:** 2026-11-23
**Estado:** Aceptado
**Decisor:** earias
**Contexto previo:** ADR-001..006

## Contexto

Antes de este ADR el flujo de seller era:

1. Signup gratuito.
2. Crear listings (draft + publish) sin ningún gate de suscripción.
3. StorefrontPage del seller y ListingPage de cada producto quedan
   públicos de inmediato.

La única barrera real al publish es `effectivePermissionSet.postListings`
(permiso nativo de Sharetribe), no el estado de la suscripción Xololo.
Resultado: un seller puede crear tienda, publicar catálogo y empezar
a vender sin pagar el plan `$169 MXN/mes anual`.

## Decisión

Adoptamos **Opción A**: preview libre, publish gated por plan activo.

### Regla

- **Preview siempre libre.** Cualquier user autenticado puede crear
  drafts, recorrer el wizard completo, subir fotos, definir precio,
  variantes, etc. El draft queda guardado.
- **Publish gated.** El botón final "Publicar" requiere:
  - `sellerMode === 'casual_reseller'` → **exento** (Art. 9 IV LIVA,
    bien usado ocasional; no paga suscripción por diseño), **o**
  - `subscription.status ∈ { 'active', 'trialing', 'past_due' }`.
- **`past_due` incluido** por decisión de negocio: ventana de gracia
  para que el seller arregle el método de pago sin interrumpir el flujo
  de catálogo.
- **`canceled` y `none` bloquean.** El seller ve un modal
  "Activa tu plan para publicar" con CTA → `/account/subscription`.

### Cambios colaterales

- Modo colaborador (workspace activo) omite el gate client-side porque
  el publish se enruta al admin del workspace vía `/api/team/as/listing/*`.
  El gate real del admin se valida server-side en **PR 2**.
- Fetch del status → `GET /api/seller-subscription` dentro de `loadData`
  del EditListingPage duck. Fail-open hacia `error: true` que cae al
  modo bloqueado (safer default).

## Alcance esta PR (PR 1)

- Helper `src/util/xololoCanPublish.js` con `canPublishListings`.
- Thunk `fetchSellerSubscriptionThunk` + estado `sellerSubscription`.
- Hook del gate en `EditListingWizard.handlePublishListing`.
- Modal `planRequiredModal` con CTA a `/account/subscription`.
- Traducciones es/en/de/fr.
- Tests unitarios (12/12 cobertura de todos los casos).

## Fuera de alcance esta PR (próxima iteración — PR 2)

- Auto-close de listings publicados cuando el webhook recibe
  `customer.subscription.deleted` (status → canceled). Debe correr
  server-side via Integration SDK y notificar al seller por email.
- Gate server-side defensivo si el seller intenta publish directo via
  SDK (bypass del UI). Requiere wrapper o webhook de Sharetribe
  `listing.state.updated`.
- Email de aviso 3/7/14 días antes del vencimiento con CTA de renovación.
- Reabrir listings automático cuando el seller reactiva el plan.

## LOCKED — no tocar sin actualizar este ADR

1. `PUBLISHABLE_STATUSES = ['active', 'trialing', 'past_due']` en
   `src/util/xololoCanPublish.js`.
2. La exención `casual_reseller`. Tocar esto rompe el modelo fiscal
   Art. 9 IV LIVA.
3. El patrón "preview libre, publish gated". NO agregar el gate a
   paneles intermedios del wizard (fotos, precio, variantes, etc.).
4. El fail-open del fetch cae al modo bloqueado: **no** invertir esta
   decisión sin revisar implicaciones (un fetch fallido NO debe
   desbloquear publish por accidente).

## Smoke test

1. User `store` sin suscripción → draft completo + al click "Publicar"
   aparece modal "Activa tu plan" + CTA lleva a `/account/subscription`.
2. User `store` con status `active` → publish completa normal.
3. User `store` con status `past_due` → publish completa normal
   (ventana de gracia).
4. User `store` con status `canceled` → modal "Activa tu plan".
5. User `casual_reseller` sin suscripción → publish completa normal
   (exento).
6. User en modo colaborador (workspace activo) → publish completa
   sin consultar status del collaborator (aplica al admin).

## Testing

`yarn jest xololoCanPublish` → 12/12 passing.

## Referencias

- `src/util/xololoCanPublish.js`
- `src/containers/EditListingPage/EditListingPage.duck.js`
- `src/containers/EditListingPage/EditListingWizard/EditListingWizard.js`
- `server/api/webhooks/stripe-billing.js` (sync del status; PR 2
  extenderá para auto-close).
- `src/util/xololoSellerMode.js` (fuente de `isCasualReseller`).
