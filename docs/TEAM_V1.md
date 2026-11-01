# Xololo — Tier Empresarial (equipos) v1

Fecha: 2026-11-01
Estado: en producción (iteración abierta).
Fases implementadas: E1 → E7. E8 (este documento + emails + legal) cierra el ciclo.

Este documento es la fuente de verdad para el **tier Empresarial** de
sellers: un seller admin paga una suscripción Enterprise que le
permite sumar colaboradores a su tienda con permisos granulares por
rol. Todas las acciones del equipo quedan registradas y el admin
sigue siendo el titular legal + fiscal de la tienda.

Complementa: [`SUBSCRIPTIONS_V1.md`](./SUBSCRIPTIONS_V1.md) (billing
Starter), [`SELLER_CASUAL.md`](./SELLER_CASUAL.md) (segunda mano),
[`SECURITY.md`](./SECURITY.md) (secrets, HMAC, rotación).

---

## 0. Los 3 tiers de seller

| Tier | Para quién | Pricing | Marca distintiva |
|---|---|---|---|
| **Casual** (segunda mano) | Particular que vende sus cosas ocasionalmente | $0 · comisión por venta | Sin tienda, sin IVA (Art. 9 fracc. IV LIVA) |
| **Starter** | Micronegocio con tienda | $229/mes mensual · $169/mes anual | Storefront + Verified + Promote |
| **Empresarial** | PYME con equipo | $499/mes mensual · $399/mes anual (2 colaboradores incluidos) · +$99 / +$69 por colaborador extra | Hasta ∞ colaboradores con permisos granulares + audit cross-user |

El payout, la facturación CFDI y la responsabilidad legal **no se
distribuyen** entre colaboradores: el admin es el titular único de la
cuenta Stripe Connect, el único al que se le emite CFDI, el único
suspendible por OPS. Los colaboradores son auxiliares operativos.

---

## 1. Pricing (acordado 2026-10-28)

| Concepto | Mensual | Anual |
|---|---|---|
| Suscripción Empresarial base | $499 MXN/mes | $399 MXN/mes (= $4,788/año) |
| Colaboradores incluidos | 2 | 2 |
| Colaborador extra | $99 MXN/mes | $69 MXN/mes (= $828/año) |
| Comisiones Xololo | Igual que Starter | Igual que Starter |
| Stripe fee | 3.6% + IVA (igual) | 3.6% + IVA (igual) |
| Onboarding fee único | $499 MXN (igual que Starter) | $499 MXN |

**Prices en Stripe** (idempotentes vía `yarn setup-stripe-billing`):

| Lookup key | Monto | Interval |
|---|---|---|
| `xololo-enterprise-plan-anual` | $4,788 MXN | año |
| `xololo-enterprise-plan-mensual` | $499 MXN | mes |
| `xololo-enterprise-seat-anual` | $828 MXN | año |
| `xololo-enterprise-seat-mensual` | $99 MXN | mes |

El seat Price se agrega a la subscription con `subscriptions.update`
cuando el admin excede los 2 incluidos.

---

## 2. Permisos atómicos (10)

| Key | Qué cubre | Riesgo |
|---|---|---|
| `listings.create` | Publicar listings nuevos | Medio |
| `listings.edit` | Modificar precio, fotos, stock | Medio-alto |
| `listings.delete` | Dar de baja listings | Alto |
| `promote` | Xololear, QR, link social, descuentos | Bajo |
| `shipping` | Generar guías, SOS photos, recolección | Medio |
| `orders.view` | Ver órdenes y detalle | Bajo |
| `orders.manage` | Confirmar, cancelar, mensajear al buyer | Medio-alto |
| `finance` | Payouts, Stripe balance, descargar CFDI | **Alto** |
| `store.settings` | Nombre, logo, direcciones, horarios | Alto |
| `team` | Invitar/remover colaboradores, cambiar permisos | **Reservado al admin** — nunca asignable a un colaborador |

Fuente de verdad: [`src/util/xololoTeam.js`](../src/util/xololoTeam.js)
(ESM, cliente) con mirror en
[`server/api-util/teamStore.js`](../server/api-util/teamStore.js)
(CommonJS, server). Mantener en sync.

## 3. Roles preset (5 asignables + admin implícito)

| Rol | Permisos |
|---|---|
| **Admin** (dueño) | Todos. No editable. |
| **Manager** | Todo salvo `team` + `finance` |
| **Catálogo / Vendedor** | listings.* + `promote` + `orders.view` |
| **Logística** | `shipping` + `orders.manage` + `orders.view` |
| **Finanzas** | `finance` + `orders.view` |
| **Custom** | Elige los 10 (menos `team`) uno a uno |

El rol admin no se asigna como colaborador — el server lo rechaza con
`cannot_assign_admin_role`.

Transfer de admin (traspaso del dueño): endpoint reservado en la
roadmap v2. En v1 el admin es inmutable.

---

## 4. Modelo de datos

### Admin (seller con plan Enterprise)

```js
metadata.xololoSubscription = {
  tier: 'enterprise',
  plan: 'annual' | 'monthly',
  status: 'active',
  stripeCustomerId, stripeSubscriptionId,
  seatPriceId,          // price_xxx del seat Price
  seatsExtraPaid: 0,    // asientos adicionales ya pagados en Stripe
  currentPeriodEnd, cancelAtPeriodEnd,
  ...
}

metadata.xololoTeam = {
  collaborators: [{
    collaboratorId: '<userUuid>',
    email, roleName, permissions: string[],
    invitedBy: { userId, email } | { operatorId, email },
    invitedAt, acceptedAt,
    status: 'invited' | 'active' | 'paused' | 'removed',
    pausedAt,
  }],
  seats: { used, included: 2, extraPaid },
  actions: [{ id, at, actor, action, target, result }],  // audit log, max 500
  updatedAt,
}
```

### Colaborador (user al que invitaron)

```js
publicData.xololoWorkspaces = {
  workspaces: [{
    sellerId: '<adminUuid>',
    sellerDisplayName, sellerSlug,
    roleName, permissions: string[],
    status: 'invited' | 'active' | 'paused',
    addedAt,
  }],
  currentWorkspace: '<adminUuid>' | null,   // null = modo propio
}
```

**Simetría obligatoria**: toda mutación toca ambos stores
(`admin.metadata.xololoTeam` + `collaborator.publicData.xololoWorkspaces`)
en el mismo request. Si el 2° write falla, se logea el drift —
reconciler diario (futuro) detecta inconsistencias.

Por qué doble:
- Admin consulta su equipo sin recorrer N users.
- Colaborador consulta sus workspaces sin requerir Integration SDK.

---

## 5. Lifecycle de un colaborador

```
      ┌───────────┐
      │ sin memb. │
      └─────┬─────┘
            │ addInvite (admin paga seat si pasa el cap)
            ▼
      ┌───────────┐  acceptInvite  ┌──────────┐
      │  invited  ├────────────────▶│  active  │
      └─────┬─────┘                 └────┬─────┘
            │                            │
            │                            │ pauseCollaborator
            │                            │ (seat sigue contando)
            │                            ▼
            │                       ┌──────────┐
            │                       │  paused  │
            │                       └────┬─────┘
            │                            │ resumeCollaborator
            │  removeCollaborator        │
            │  (seat se libera)          │
            ▼                            │
      ┌───────────┐                      │
      │  removed  │◀─────────────────────┘ removeCollaborator
      └───────────┘
```

**Seats enforcement**: `recomputeSeats` cuenta `invited + active +
paused` (no `removed`). Anti-gaming: pagas el seat desde que mandas
la invitación, no cuando el colaborador acepta.

---

## 6. Endpoints

Todos bajo `/api/team/*`, gated por `requirePermission(key)` o
`requireAnyWorkspace`.

### Gestión del equipo (`team` permission — admin only)

| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/team/invite` | Firma JWT 7d, envía email, crea invite |
| POST | `/team/update-permissions` | Cambia rol/permisos |
| POST | `/team/pause` | Flipa a `paused` (seat sigue contando) |
| POST | `/team/resume` | Flipa a `active` |
| POST | `/team/remove` | Flipa a `removed` (seat libre, workspace fuera del colaborador) |
| GET | `/team/actions?limit=100` | Audit log del team |
| POST | `/team/buy-seat` | +1 seat extra en Stripe + sync local |
| POST | `/team/downgrade` | Cancela sub Enterprise si no hay colaboradores activos |

### Para el colaborador

| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/team/accept-invite` | Valida token + email match, flipa a `active` |
| POST | `/team/switch-workspace` | Cambia `currentWorkspace` o vuelve a `null` |
| GET | `/team/collaborators` | Lista el equipo (requireAnyWorkspace) |

### Wrappers "actuar como" el admin

Todos exigen que `targetSellerId === admin del workspace activo del
colaborador`. Cada endpoint verifica además que el recurso
(listing/tx) pertenezca al admin (defensa en profundidad).

| Método | Ruta | Permiso | Qué hace |
|---|---|---|---|
| POST | `/team/as/listing/create` | `listings.create` | `isdk.listings.create({authorId=adminId, ...})` |
| POST | `/team/as/listing/update` | `listings.edit` | `isdk.listings.update` tras validar authorId |
| POST | `/team/as/listing/close` | `listings.delete` | `isdk.listings.close` |
| POST | `/team/as/listing/open` | `listings.edit` | `isdk.listings.open` |
| POST | `/team/as/tx/transition` | `orders.manage` | `isdk.transactions.transition` tras validar providerId |
| POST | `/team/as/tx/message` | `orders.manage` | `isdk.messages.send` — buyer ve "Mensaje de \<admin\>" |
| POST | `/team/as/store/settings` | `store.settings` | `isdk.users.updateProfile(adminId)` con blacklist de keys sensibles |

### Taxonomy / meta

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/team/meta` | Devuelve el taxonomy (permisos + roles presets) para la UI |

---

## 7. UI

### Para el admin: `/dashboard?section=equipo`

- Si plan ≠ Enterprise → **upgrade card** con pricing dual y CTA a
  `/account/subscription`.
- Si plan = Enterprise:
  - Header: `N colaboradores · X/Y asientos`.
  - Botón `+ Invitar colaborador` → modal con email + rol + checkboxes
    (si custom).
  - Tabla con acciones por fila: editar, pausar/reactivar, remover.
  - Botón `Ver historial` → `TeamActionsLog` con filtros por actor +
    acción.
- Si al invitar el server devuelve 402 `seat_limit_reached`, la UI
  (TODO E8.1) ofrecerá al admin comprar un seat extra con un click
  antes de reintentar. Por ahora el error se muestra crudo.

### Para el colaborador

- **`/accept-invite?token=…`**: página autenticada que decodifica el
  JWT en el cliente para mostrar quién lo invitó + lista de permisos
  antes de aceptar. Al aceptar redirige a Dashboard.
- **Floating WorkspaceSwitcher** top-right (position: fixed): botón
  blanco "👤 Mi cuenta" o verde "🏢 \<Tienda\>" con dropdown. Al
  cambiar, `window.location.reload()`.
- **WorkspaceRibbon** fijo arriba cuando `currentWorkspace != null`:
  "Operando como \<Tienda\> · Rol X · N permisos · [Salir del
  workspace]".

### Para OPS: `/ops/users` drawer

- Badge `🏢 Enterprise · N` en la tabla master junto al tipo.
- Nuevo tab **"Equipo"** read-only con 3 secciones: resumen
  Enterprise, tabla de colaboradores, historial del team.

---

## 8. Legal / responsabilidad

### Admin acepta al upgrade:

> *"Como titular de la suscripción Empresarial, soy responsable legal
> del contenido publicado y de las transacciones ejecutadas por los
> colaboradores que yo agregue a mi tienda. Entiendo que todas las
> facturas (CFDI) se emiten a mi RFC, los payouts de Stripe Connect
> se depositan únicamente en mi cuenta registrada, y que puedo
> remover a cualquier colaborador en cualquier momento sin reembolso
> del seat que esté usando en el periodo en curso."*

Checkbox obligatorio en el flow de upgrade.

### Colaborador acepta al aceptar invitación:

> *"Operaré la tienda `<nombre>` siguiendo las instrucciones del
> administrador. Entiendo que mi acceso puede ser revocado en
> cualquier momento, que todas mis acciones quedan registradas en el
> audit log del equipo y pueden ser revisadas por el administrador o
> por OPS, y que los pagos de las ventas que yo gestione se depositan
> en la cuenta del administrador — nunca en la mía."*

Checkbox obligatorio en `/accept-invite`.

### Addendum TOS

[`src/containers/TermsOfServicePage/TeamConsentAddendum.js`](../src/containers/TermsOfServicePage/TeamConsentAddendum.js)
expone el marco legal completo bajo el TOS hospedado, mientras
jurídico (Ernesto) revisa el draft para el asset final.

---

## 9. Emails

| Evento | Para | Canal | Template |
|---|---|---|---|
| Invitación | Colaborador | email | `teamInviteEmail.js` — link mágico 7d con role + permisos |
| Aceptación | Admin | email | `teamAcceptedEmail.js` — confirma quién aceptó |
| Pausa | Colaborador | email (futuro) | `teamPausedEmail.js` |
| Remoción | Colaborador | email (futuro) | `teamRemovedEmail.js` |

Sin `RESEND_API_KEY` los helpers caen a log-only (mismo patrón que
el resto del stack de notifications).

---

## 10. Guards server-side críticos

1. **requirePermission(key)** — admin pasa siempre; colaborador exige
   workspace `active` + permiso en array.
2. **Resource ownership check** en `/team/as/*` — antes de escribir,
   `GET isdk.listings.show` o `isdk.transactions.show` para validar
   `authorId`/`providerId` === `adminId`.
3. **Blacklist** en `store/settings`: `xololoVerified`,
   `xololoVerifiedAt`, `xololoSuspended`, `xololoWorkspaces`,
   `sellerMode` filtradas aunque el colaborador tenga el permiso.
4. **Role `admin` no asignable** a colaboradores (`cannot_assign_admin_role`).
5. **Permiso `team` filtrado** siempre antes de persistir, aunque
   venga en el body (defensa en profundidad).
6. **Seat enforcement** en `invite`: 402 si `active ≥ included +
   extraPaid`.
7. **Downgrade bloqueado** con 409 `has_collaborators` si hay
   colaboradores en `invited | active | paused`.
8. **Token invite** firmado con `TEAM_INVITE_SECRET`, TTL 7d,
   rotación via `TEAM_INVITE_SECRET_PREV`.
9. **Email match** en accept-invite: `payload.sub ==
   currentUser.email` (case-insensitive).
10. **Audit log** cada acción — `recordTeamAction` fire-and-forget.

---

## 11. Env vars

```bash
# E6 billing (opcional si no se usa Enterprise)
STRIPE_SECRET_KEY=…
# Prices se resuelven por lookup_key — no hace falta guardar IDs.

# E2 token de invitación
TEAM_INVITE_SECRET=…          # opcional — fallback a JWT_SECRET
TEAM_INVITE_SECRET_PREV=…     # opcional — ventana de rotación

# Email (compartido con el resto del stack)
RESEND_API_KEY=…
EMAIL_FROM_NAME=Xololo
EMAIL_FROM_ADDRESS=noreply@xololo.mx
EMAIL_REPLY_TO=soporte@xololo.mx
```

---

## 12. Checklist operativo pre-launch

- [ ] `yarn setup-stripe-billing` corrido en producción (4 Prices
      Enterprise creados).
- [ ] `TEAM_INVITE_SECRET` configurado en Render.
- [ ] Legal (Ernesto) revisa checkbox texts + addendum TOS.
- [ ] Email templates probados end-to-end con `RESEND_API_KEY` real.
- [ ] Primer seller test upgradea a Enterprise, invita a 1 colaborador,
      verifica flow completo.
- [ ] OPS verifica que el tab Equipo aparece en el drawer.

---

## 13. Backlog v2

- **Transfer de admin**: traspaso del dueño con re-onboarding de
  Stripe Connect del nuevo admin.
- **Dashboard de productividad del equipo**: ventas por colaborador,
  listings por colaborador, histogramas de actividad.
- **Pause/remove notifications**: emails automáticos al colaborador.
- **Buy-seat inline flow**: cuando `invite` devuelve 402, modal
  "comprar seat ($69/$99)" + confirm + reintentar.
- **Upgrade in-place Starter → Enterprise**: hoy requiere pausar
  Starter primero. Switch con prorated vía
  `stripe.subscriptions.update` queda para v2.
- **Reconciler diario**: cron que detecta drift entre
  `admin.metadata.xololoTeam` y `collaborator.publicData.xololoWorkspaces`.
- **Permisos adicionales**: `inventory` separado de `listings.edit`,
  `analytics`, `events` para marketing.

---

## Referencias de código

- [src/util/xololoTeam.js](../src/util/xololoTeam.js) · [test](../src/util/xololoTeam.test.js)
- [server/api-util/teamStore.js](../server/api-util/teamStore.js) · [test](../server/api-util/teamStore.test.js)
- [server/api-util/teamAuth.js](../server/api-util/teamAuth.js) · [test](../server/api-util/teamAuth.test.js)
- [server/api-util/teamInviteToken.js](../server/api-util/teamInviteToken.js) · [test](../server/api-util/teamInviteToken.test.js)
- [server/api-util/teamInviteEmail.js](../server/api-util/teamInviteEmail.js)
- [server/api/team.js](../server/api/team.js) — gestión del equipo
- [server/api/team-as.js](../server/api/team-as.js) — wrappers "actuar como"
- [server/api/team-seats.js](../server/api/team-seats.js) — seats + downgrade
- [server/api-util/billingPlans.js](../server/api-util/billingPlans.js) — Prices Enterprise + seats
- [src/containers/DashboardPage/DashboardTeamView.js](../src/containers/DashboardPage/DashboardTeamView.js)
- [src/containers/AcceptInvitePage/AcceptInvitePage.js](../src/containers/AcceptInvitePage/AcceptInvitePage.js)
- [src/components/WorkspaceSwitcher/WorkspaceSwitcher.js](../src/components/WorkspaceSwitcher/WorkspaceSwitcher.js)
- [src/components/WorkspaceRibbon/WorkspaceRibbon.js](../src/components/WorkspaceRibbon/WorkspaceRibbon.js)
- [src/util/apiAsWorkspace.js](../src/util/apiAsWorkspace.js) — helper client para los wrappers
