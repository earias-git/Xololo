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

## Alcance PR 2 (ENTREGADO 2026-11-23)

Infraestructura preexistente que ADR-007 PR 2 consolida y ajusta:
- `server/api-util/publicationGate.js#applyPublicationGate` ya cerraba
  (y reabría) listings al cruzar la frontera activo/no-activo. Lo
  reusamos sin reescribirlo.
- Webhook `server/api/webhooks/stripe-billing.js` ya enruta
  `customer.subscription.updated`/`.deleted` → `syncSubscriptionMetadata`
  → gate. El email `seller.subscription_canceled` ya estaba listo.

Cambios netos en PR 2:

1. **Frontera alineada con ADR-007.** `syncSubscriptionMetadata` ahora
   usa `isPublishableStatus(status)` en lugar de `status === 'active'`.
   `PUBLISHABLE_INTERNAL_STATUSES = ['active', 'past_due']` vive en
   `publicationGate.js` y espeja al cliente. `past_due` ya NO cierra
   listings — es la ventana de gracia de ADR-007.
2. **Casual exemption defensive.** `applyPublicationGate` lee
   `publicData.sellerMode` del seller; si es `casual_reseller` sale
   sin tocar sus listings. En práctica nunca pasa (casuals no
   se suscriben), pero blindamos contra data migration o import.
3. **Gate server-side defensivo.** `server/api/team-as.js#publishDraft`
   valida el plan del ADMIN (no del colaborador) antes de aprobar
   el listing. Un colaborador que fuerce el POST con un admin sin
   plan recibe `409 plan_required`. Fail-close en error de verificación.
4. **Tests.** `server/api-util/publicationGate.test.js` cubre: casual
   exempt, close en flow normal, reopen sólo los marcados por Xololo,
   fail-close en users.show rejection, frontera de statuses.

## Fuera de alcance (próximas iteraciones)

- Email de aviso 3/7/14 días antes del vencimiento con CTA de renovación.
- Webhook de Sharetribe `listing.state.updated` para interceptar un
  publish que el admin haga directamente vía SDK (el gate server-side
  de PR 2 cubre sólo el flow colaborador).

## LOCKED — no tocar sin actualizar este ADR

1. `PUBLISHABLE_STATUSES = ['active', 'trialing', 'past_due']` en
   `src/util/xololoCanPublish.js`. Su espejo server-side es
   `PUBLISHABLE_INTERNAL_STATUSES = ['active', 'past_due']` en
   `server/api-util/publicationGate.js` (el server mapea trialing→active
   en `STRIPE_TO_XOLOLO_STATUS`, así que la lista server equivale a
   la del cliente). Mover una lista exige mover la otra.
2. La exención `casual_reseller` en ambos helpers (cliente y server).
   Tocar esto rompe el modelo fiscal Art. 9 IV LIVA.
3. El patrón "preview libre, publish gated". NO agregar el gate a
   paneles intermedios del wizard (fotos, precio, variantes, etc.).
4. El fail-open del fetch cae al modo bloqueado: **no** invertir esta
   decisión sin revisar implicaciones (un fetch fallido NO debe
   desbloquear publish por accidente). Su contraparte server-side es
   el fail-close de `ensureAdminCanPublish` y de la lectura de
   sellerMode en `applyPublicationGate`.
5. La frontera "cuándo correr el gate" vive en
   `syncSubscriptionMetadata` y usa `isPublishableStatus`. No volver
   a `wasActive !== isActive`: eso cierra listings en `past_due` y
   rompe la ventana de gracia.

## Smoke test — PR 1 (UI gate)

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

## Smoke test — PR 2 (webhook + auto-close + gate server-side)

7. Admin `store` con status `active` cancela plan en Stripe →
   webhook `customer.subscription.deleted` → status pasa a `canceled`
   → `applyPublicationGate` cierra todos los listings `published` del
   admin y les marca `xololoGatedClosed: true`. Email
   `seller.subscription_canceled` enviado.
8. Mismo admin reactiva plan (nuevo checkout exitoso) →
   `checkout.session.completed` → status → `active` → gate reabre
   SOLO los listings con `xololoGatedClosed: true`. Los que el seller
   había cerrado a mano siguen cerrados.
9. Admin `store` con status `active` tiene impago →
   `invoice.payment_failed` + status `past_due` → el gate **no cierra**
   los listings (past_due es grace window). Email
   `seller.payment_failed_warning` enviado.
10. Admin `store` sin plan activo + colaborador intenta publicar
    listing via `POST /api/team/as/listing/publish-draft` →
    `409 plan_required` + listing queda en draft.
11. Admin `store` con `active` + colaborador publica → publicación
    exitosa como siempre.
12. User `casual_reseller` imaginario con Stripe sub cancelada (edge
    case de data) → `applyPublicationGate` retorna
    `skipped: 'casual_reseller'` y no cierra sus listings.

## Testing

- `yarn jest xololoCanPublish` → 12/12 passing (client UI gate).
- `yarn test-server --testPathPatterns=publicationGate` → 12/12
  passing (server gate + casual exemption + boundary).

## Referencias

- `src/util/xololoCanPublish.js`
- `src/containers/EditListingPage/EditListingPage.duck.js`
- `src/containers/EditListingPage/EditListingWizard/EditListingWizard.js`
- `server/api/webhooks/stripe-billing.js` (sync del status; PR 2
  extenderá para auto-close).
- `src/util/xololoSellerMode.js` (fuente de `isCasualReseller`).
