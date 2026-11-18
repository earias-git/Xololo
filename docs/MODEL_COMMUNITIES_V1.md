# MODEL_COMMUNITIES_V1 — modelo UX y técnico de Comunidades

Fecha: 2026-11-18
Status: **BORRADOR — Fase 2 del ADR-006**
Owner: @earias
Relacionado: [ADR-006](decisions/ADR-006-categorization-and-communities.md),
[TAXONOMIA_SECTOR_VERDE.md](TAXONOMIA_SECTOR_VERDE.md)

## Propósito

Pavimentar la implementación. Define flujos UX, contratos de API,
estados, wireframes conceptuales y criterios de aceptación — todo
lo que Fase 4 (backend) y Fase 5 (frontend) necesitan para ejecutar
sin volver a decidir nada arquitectónico.

**No es implementación**. Es el spec. Todo lo que aquí se decide
queda LOCKED al ADR-006 — si algo no cuadra durante Fase 4/5,
volver al ADR, no improvisar.

## 1. Modelo de datos — concreto

### 1.1 Entidad `community` (backend)

Almacenada como **metadata del marketplace** bajo la clave
`communities.<id>` en el namespace `private` (solo operadores
leen/escriben). Lectura pública vía endpoint cacheado.

```json
{
  "id": "opf",
  "type": "sectorial",
  "name": "OPF – Sector Verde",
  "slug": "opf",
  "tagline": "13 años conectando el sector verde mexicano",
  "description": "Red fundacional...",
  "branding": {
    "logoUrl": "https://cdn.xololo.mx/communities/opf/logo.png",
    "heroUrl": "https://cdn.xololo.mx/communities/opf/hero.jpg",
    "primaryColor": "#2d5016",
    "secondaryColor": "#8fbc8f",
    "accentColor": "#c9b037"
  },
  "bylaws": "OPF nació en 2013 como red del Prof. ...",
  "admins": ["<operatorUuid>", "<profOpfUuid>"],
  "membership": "open",
  "requiresCertification": false,
  "primaryFacets": {
    "sector": ["verde"],
    "uso": ["ornamental", "comestible"]
  },
  "seoKeywords": ["viveros méxico", "sector verde", "plantas"],
  "createdAt": "2026-11-18T00:00:00Z",
  "updatedAt": "2026-11-18T00:00:00Z",
  "sellerCount": 0,
  "isPublished": false
}
```

**Reglas duras**:
- `id` es inmutable (parte de URLs). Validado contra
  `/^[a-z0-9-]{3,30}$/`.
- `slug` = `id` por defecto; sólo un operador puede sobreescribir.
- `type ∈ {sectorial, modelo, geografica}`. Decide el prefijo URL.
- `isPublished: false` deja la landing en 404 pero permite que
  sellers se unan vía OPS.
- `sellerCount` se recalcula en cada publish/unpublish o cron
  diario (ver §4.3).

### 1.2 Pertenencia del seller

En `profile.publicData.communities`:

```json
{
  "communities": {
    "sectorial": ["opf", "alimentos-organicos"],
    "modelo": ["productor-directo"],
    "geografica": ["morelos", "cuernavaca"]
  }
}
```

**Por qué 3 arrays separados y no uno plano**:
- Facilita filtros agregados ("todos los geográficos del seller").
- Evita colisión de ids entre tipos (`morelos` como región vs. un
  futuro `morelos` como sectorial).
- Si `communities` no existe o el array está vacío → seller no
  pertenece a ninguna, se comporta como hoy.

### 1.3 Pertenencia a nivel listing (opcional)

Un listing hereda la membresía de su autor por default. Si el
seller quiere **excluir** un listing específico de una comunidad
(p.ej. un vivero OPF vende también muebles rústicos que no caben
en el sector verde):

```json
{
  "listing.publicData.excludeFromCommunities": ["opf"]
}
```

Join server-side resta estos. Default: todos los listings del
seller aparecen en todas sus comunidades.

## 2. Flujos UX

### 2.1 Flujo seller — unirse a una comunidad

```
ManageStorePage
  └─ Tab "Tienda" existe hoy
  └─ NUEVO Tab "Comunidades"
      ├─ Lista de comunidades del seller (chips con logo)
      ├─ Botón "Explorar comunidades"
      │    └─ Modal con lista navegable:
      │       ├─ Sectoriales (OPF, Alimentos Orgánicos, ...)
      │       ├─ Modelo de negocio (Productor Directo, Mayoreo, ...)
      │       └─ Geográficas (por estado, luego por municipio)
      │
      ├─ Al dar click en una comunidad:
      │   ├─ Panel con descripción, logo, # sellers.
      │   ├─ Si membership=open → botón "Unirse" (instant).
      │   ├─ Si membership=request → botón "Solicitar entrada"
      │   │    → notifica admins, estado "pending".
      │   ├─ Si requiresCertification=true → upload docs
      │   │    antes del Unirse.
      │   │
      │   └─ Al unirse (open) o aprobarse (request/cert):
      │       ├─ Se agrega el id al array correspondiente.
      │       ├─ Se dispara webhook interno para recalcular
      │       │   sellerCount.
      │       └─ Toast "Ya eres miembro de X. Tu tienda aparecerá
      │           en /comunidad/X."
      │
      └─ Chips con "Salir" (requiere confirm modal).
```

**Criterios de aceptación**:
- Un seller puede estar en N comunidades sin límite técnico
  (sanidad: UI lista máx 50).
- Unirse a `membership: open` es ≤1 click (+confirm).
- "Salir" no borra listings ni storefront — sólo los deja de
  mostrar en la landing de esa comunidad.

### 2.2 Flujo buyer — descubrir una comunidad

**Entry points**:
1. Link directo (`/comunidad/opf`, compartido por un seller o
   admin OPF).
2. Breadcrumb en ListingPage cuando el seller pertenece a una
   comunidad: "Vive en: OPF Sector Verde".
3. Chip en SellerStorePage debajo del nombre del negocio.
4. Footer "Comunidades" (sólo las 3-5 destacadas; resto en
   `/comunidades`).

**Landing `/comunidad/:slug`**:

```
┌─ Hero ─────────────────────────────────┐
│ [logo OPF]                             │
│ OPF – Sector Verde                     │
│ 13 años conectando el sector verde mexicano │
│ [bylaws expandible]                    │
│ 👥 142 negocios · 📍 CDMX, Morelos, GTO│
└────────────────────────────────────────┘

┌─ Filtros rápidos (facetas primarias) ──┐
│ Categoría: [Todas] Plantas Alimentos   │
│ Uso: Ornamental Comestible             │
│ Entrega: Recoger Envío Local Nacional  │
└────────────────────────────────────────┘

┌─ Negocios destacados (editorial) ──────┐
│ [storefront card][storefront card]...  │
└────────────────────────────────────────┘

┌─ Catálogo (listings de todos) ─────────┐
│ [grid 3-col de productos]              │
│ (SearchPage embebido, scoped a OPF)    │
└────────────────────────────────────────┘

┌─ Footer de comunidad ──────────────────┐
│ ¿Eres del sector verde? Únete a OPF.   │
│ [CTA → /account/communities?suggest=opf] │
└────────────────────────────────────────┘
```

**Criterios de aceptación**:
- Página SSR (SEO).
- 404 si la comunidad no existe o `isPublished=false`.
- Si 0 sellers, muestra estado vacío con CTA "¿Quieres fundarla?".
- Carga en ≤1.5s TTFB con cache de 60s (igual que
  `/api/landing-listings`).

### 2.3 Flujo operador — crear/editar una comunidad

Nuevo tab en `/ops/communities`:

```
Lista con filtro por type + status (published/draft) + membership.
Acciones por fila: Edit, Preview landing, Publish/Unpublish, Delete.

Edit form:
  - Metadata (name, tagline, description, bylaws, keywords).
  - Branding (upload logo, hero; color pickers).
  - Membership rules (open/request/invite + cert?).
  - Admins (autocomplete user).
  - Primary facets (checkboxes derivados del catálogo de facetas).
  - Preview botón (abre /comunidad/:slug en nueva tab).
```

**Criterios de aceptación**:
- Solo operadores con MFA.
- Audit log de cada edit (reutilizar `opsAudit`).
- Delete requiere confirm doble; marca `isDeleted: true` en vez de
  borrar físicamente (preservar historial).

## 3. API — contratos

Todas las rutas públicas tienen cache de 60s (`Cache-Control:
public, max-age=60`) salvo que indique lo contrario.

### 3.1 Públicas

```
GET /api/communities
  Response: { communities: CommunityPublic[] }
  (sólo isPublished=true, ordenadas por sellerCount DESC)

GET /api/communities/:slug
  Response: CommunityPublic & { sellers: SellerPublic[], featuredListings: [] }
  404 si no existe o no published.

GET /api/communities/:slug/listings
  Query: ?page=1&perPage=24&facets[uso]=ornamental&...
  Response: { data, included, meta } (shape idéntico al
  endpoint de landing-listings; el cliente reutiliza selectores).
```

### 3.2 Seller (autenticado)

```
POST /api/communities/:slug/join
  Response: { status: 'joined' | 'pending' | 'rejected', community }
  Dispara email a admins si status=pending.

POST /api/communities/:slug/leave
  Response: { status: 'left' }

GET /api/me/communities
  Response: { communities: CommunityPublic[], pending: [] }

POST /api/me/listings/:id/exclude-from-community
  Body: { communityId }
  Response: { excluded: true }
```

### 3.3 Admin (operator o communityAdmin)

```
GET /api/admin/communities
  Response: { communities: CommunityFull[] }

POST /api/admin/communities
  Body: CommunityDraft
  Response: { community }

PATCH /api/admin/communities/:id
  Body: Partial<CommunityDraft>
  Response: { community }

POST /api/admin/communities/:id/publish
POST /api/admin/communities/:id/unpublish
POST /api/admin/communities/:id/recount-sellers

POST /api/admin/communities/:id/members/:userId/approve
POST /api/admin/communities/:id/members/:userId/reject
GET  /api/admin/communities/:id/members-pending
```

## 4. Lógica de query y cache

### 4.1 Query al listado de una comunidad

Sharetribe Integration SDK no indexa `profile.publicData` en el
query de users, pero sí indexa `publicData` de listings. Estrategia:

1. **Al crear/editar membership** en un seller, también se
   escribe un espejo en `listing.publicData.sellerCommunities`
   (array plano) para cada listing publicado del seller. Se
   actualiza vía Integration SDK en el thunk de join/leave.
2. Query al listado de comunidad: `listings.query` con
   `pub_sellerCommunities: ['opf']` + filtros de usuario + paginate.
3. Si el seller publica un nuevo listing, el `loadData` del
   wizard (al publicar) también escribe `sellerCommunities` desde
   el profile del autor — evita que queden listings nuevos sin
   el espejo.

**Trade-off**: el espejo puede quedar desincronizado si alguien
edita un listing con el Integration SDK directo. Mitigación: cron
nocturno que recalcula el espejo. Documentado como LOCKED
(§7).

### 4.2 Cache de la landing

Reutilizar el pattern de `landingListingsService.js` (ADR-005):
- Cache en memoria por slug (`CACHE['community:opf']`).
- TTL 60s.
- Invalidación manual vía `invalidateCache(slug)` cuando un admin
  edita la comunidad o un seller se une.

### 4.3 Recálculo de sellerCount

- Al `join`/`leave` → increment/decrement en memoria.
- Cron diario (`server/cron/recountCommunities.js`, nuevo) que
  recorre todas las comunidades publicadas y recalcula desde
  Integration SDK + persiste en metadata.

## 5. SEO y linking

### 5.1 URLs

Según el ADR-006:
```
/comunidad/:slug   → type=sectorial
/region/:slug      → type=geografica
/programa/:slug    → type=modelo
```

El route handler lee el prefijo, mapea a type, hace lookup del slug.

### 5.2 SEO

Cada landing emite:
- `<title>{{community.name}} — Xololo</title>`
- `<meta description={{community.tagline}} />`
- OpenGraph con `heroUrl`.
- Schema.org `Organization` para la comunidad.
- Schema.org `ItemList` con los primeros 20 listings.
- Sitemap dinámico incluye `/comunidad/*`, `/region/*`, `/programa/*`
  para las publicadas.

### 5.3 Breadcrumbs en ListingPage

Si el seller pertenece a ≥1 comunidad, mostrar chip en ListingPage
debajo del seller name:

```
Vive en: [OPF Sector Verde] [Morelos]
```

Click lleva a la landing correspondiente.

## 6. Branding cuando falta

Problema: la primera semana no tendremos assets de OPF.
Default visual:

- logoUrl: null → iniciales grandes sobre color primario.
- heroUrl: null → gradient del primary→secondary.
- primaryColor: null → neutro Xololo.

Permite publicar la landing sin bloquear por assets.

## 7. Reglas LOCKED

Añadidas al catálogo del ADR-006:

1. **El espejo `listing.publicData.sellerCommunities` es
   secundario al `profile.publicData.communities` del seller**. Si
   difieren, el profile gana y el cron corrige. NO escribir
   `sellerCommunities` desde la UI del wizard de listing.
2. **`id` y `type` son inmutables** post-creación. Cambiar uno
   requiere crear comunidad nueva + migrar sellers.
3. **Delete nunca es físico** — soft delete (`isDeleted=true`)
   + los sellers pueden quedarse en el array hasta que un cron de
   limpieza mensual los saque.
4. **Facetas y comunidades NO se cruzan en backend**. Una
   landing muestra listings de sellers de la comunidad; los
   filtros de facetas son client-side sobre ese set. Agregar
   facetas al query de Sharetribe directo sería OK en V2.

## 8. Migración y backwards-compatibility

- `profile.publicData.communities` ausente = seller sin comunidades.
  Compatible con el modelo actual.
- `listing.publicData.sellerCommunities` ausente = listing no
  aparece en ninguna landing de comunidad.
- Zero migración destructiva — es additive.

## 9. Observabilidad

Eventos a loggear (reutilizar `trackEvent` existente):
- `community_joined` `{communityId, sellerId, via: 'ui'|'ops'}`.
- `community_left` `{communityId, sellerId}`.
- `community_landing_view` `{slug, referrer}`.
- `community_listing_clickthrough` `{slug, listingId}`.
- `community_published` `{communityId, operator}`.

Dashboards:
- Top comunidades por tráfico.
- Conversion rate landing → ListingPage.
- Growth de sellers por comunidad (semanal).

## 10. Plan de ejecución (ADR-006 Fase 4-6)

### Fase 4 — Backend (estimado: 3-4 días)

PR-1: Modelo + helpers
- `src/util/communities.js` — helpers slug↔type↔route.
- `src/config/communities.js` — catálogo inicial (OPF seed).
- Tests de helpers.

PR-2: Endpoints públicos
- `server/api-util/communitiesService.js` — getBySlug, list, cache.
- `server/api/communities.js` — rutas públicas.
- Smoke test: 404 cuando no publicada, 200 cuando sí.

PR-3: Endpoints seller
- Thunks en `src/ducks/communities.duck.js`.
- Endpoints join/leave/exclude.
- Sync mirror `listing.publicData.sellerCommunities`.

PR-4: Endpoints admin + OPS tab
- CRUD completo.
- audit log.

PR-5: Cron recount + mirror sync.

### Fase 5 — Frontend (estimado: 4-5 días)

PR-6: Landing `/comunidad/:slug`
- SSR page.
- Hero + filtros + grid.
- Reutilizar `SearchPage`'s card components.

PR-7: ManageStorePage tab Comunidades
- Lista + modal explorar + join/leave.

PR-8: ListingPage + SellerStorePage chips.

PR-9: `/ops/communities` admin UI.

### Fase 6 — Seeding OPF

PR-10: Seed `opf` en `communities.js` + assets reales (cuando
estén) + join inicial de ~10 sellers piloto vía OPS.

## 11. Preguntas abiertas (a cerrar antes de Fase 4)

1. ¿`communityAdmin` (líder externo, p.ej. Prof. OPF) tiene MFA
   propio o hereda del operador que lo asigna?
2. ¿La invalidación de cache `community:opf` dispara también
   invalidación de `landing-listings` (porque un listing OPF
   también aparece en el landing general)? Probablemente sí.
3. Rate limit de join/leave (anti-abuso): ¿5/min por seller?
4. ¿El seller puede "destacarse" en la comunidad (featured) o
   lo decide el admin de la comunidad? Decisión: lo decide el
   admin en V1 (featured manual por `isFeatured: true` en el
   array del community doc).

## 12. Estado por PR

- [ ] PR-1 Backend modelo + helpers
- [ ] PR-2 Backend endpoints públicos
- [ ] PR-3 Backend endpoints seller + mirror
- [ ] PR-4 Backend endpoints admin + OPS tab
- [ ] PR-5 Backend cron recount/sync
- [ ] PR-6 Frontend landing comunidad
- [ ] PR-7 Frontend tab ManageStore
- [ ] PR-8 Frontend chips listing + storefront
- [ ] PR-9 Frontend /ops/communities
- [ ] PR-10 Seed OPF + 10 sellers piloto
