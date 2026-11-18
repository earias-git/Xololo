# ADR-006: Modelo de categorización en 3 capas + Comunidades

Fecha: 2026-11-18
Status: **PROPUESTA — en revisión**
Owner: @earias
Supersede: n/a (reemplaza el modelo plano actual de `categoryLevel1`
con un enfoque extensible)

## Decisión

Xololo adopta un modelo de **3 capas independientes** para
clasificar listings y agrupar sellers:

| Capa | Cardinalidad | Propósito |
|---|---|---|
| **Categoría primaria** | 1 por listing | Dónde vive el producto/servicio en la taxonomía (navegación) |
| **Facetas** | N por listing | Atributos transversales buscables (sector, uso, canal, fiscal, entrega, modalidad, ...) |
| **Comunidad** | N por seller | Agrupación comercial de sellers (sectorial, modelo de negocio, geografía) con landing propia |

La comunidad **no clasifica productos; agrupa sellers**. Esto
permite que un mismo listing aparezca en landings de todas las
comunidades a las que pertenece su seller, sin duplicar data ni
inflar la taxonomía primaria.

## Contexto

### Problema

El modelo actual (`publicData.categoryLevel1`) obliga a elegir
una sola casa por producto. Casos reales que rompen el modelo:

- Una planta ornamental de un vivero: no es Moda ni Alimentos ni
  Electrónica. Cabe forzadamente en Hogar.Jardinería, pero pierde
  el ángulo agrícola/productivo.
- Alimentos orgánicos locales: son Alimentos por categoría, pero
  el buyer que busca "orgánicos de Morelos" no los encuentra fácil.
- Servicios de jardinería: son Servicios, pero pertenecen al
  mismo buyer-persona que compra plantas (Sector Verde).

Agregar "Sector Verde" como undécima `categoryLevel1` no escala:
mañana se pide "Sector Salud", "Sector Automotriz", etc. Y las
facetas transversales (orgánico, mayoreo, productor directo) no
caben en un árbol jerárquico.

### Contexto estratégico

Xololo reutiliza la comunidad OPF (13 años de trayectoria en
sector verde) como puente de lanzamiento. Para que OPF tenga una
landing dedicada sin construir una plataforma paralela, el modelo
debe soportar "comunidades verticales" como primitiva nativa. La
misma primitiva habilita futuras comunidades geográficas (Morelos,
San Miguel de Allende) y de modelo de negocio (Productor Directo,
Mayoreo).

## Modelo de datos

### Capa 1 — Categoría primaria (contrato)

```
listing.publicData.categoryLevel1 : string   // "servicios"
listing.publicData.categoryLevel2 : string   // "jardineria"
listing.publicData.categoryLevel3 : string?  // "poda"  (opcional)
```

Jerarquía autoritativa en `src/config/listingAttributes.js` (ya
existe para L1 y L2; se agrega L3 opcional para subdivisiones
finas como "poda", "derribo", "chipping" dentro de arboricultura).

**Regla**: exactamente una categoría por listing. El wizard fuerza
la elección en el paso Detalles.

### Capa 2 — Facetas

```
listing.publicData.facets : {
  sector:         string[]    // ["verde", "agricola"]
  uso:            string[]    // ["ornamental", "comestible"]
  canal:          string[]    // ["menudeo", "mayoreo"]
  entrega:        string[]    // ["recoger-en-vivero", "flete-personalizado"]
  modalidad:      string[]    // ["presencial", "remoto"]   (servicios)
  cobertura:      string[]    // ["hasta-25km", "regional"] (servicios)
  clima:          string[]    // ["interior", "exterior-templado"]
  cuidado:        string[]    // ["bajo", "medio", "alto"]
  cultivo:        string[]    // ["organico", "convencional", "hidroponico"]
  valor_agregado: string[]    // ["ninguno", "maceta", "arreglo", "sembrada-en-sitio"]
  fiscal:         string      // "tasa-16" | "tasa-0-art-2a" | "exento-art-9" | "exento-9-iv-usado"
  origen:         string[]    // ["cultivo-propio", "reventa", "importado"]
  escala:         string[]    // ["residencial", "comercial", "industrial"] (servicios)
  certificaciones: string[]   // ["organico-certificado", "isa-arborist", "perito-agricola"]
}
```

**Reglas**:
- Todas las facetas son opcionales salvo `fiscal` (tiene default por categoría).
- Catálogo autoritativo en `src/config/facets.js` (nuevo archivo, se
  crea en Fase 1).
- Valores son slugs normalizados; etiquetas visibles vienen del
  catálogo con i18n.
- Facetas pueden ser mono-valor (`fiscal`) o multi-valor (`entrega`).

### Capa 3 — Comunidad

Nuevo modelo:

```
community : {
  id:             string          // "opf" | "morelos" | "productor-directo"
  type:           "sectorial" | "modelo" | "geografica"
  name:           string          // "OPF – Sector Verde"
  slug:           string          // URL slug
  description:    string
  branding: {
    logoUrl:      string
    heroUrl:      string
    primaryColor: string
    secondaryColor: string
    bylaws:       string?         // "13 años de la red del Prof..."
  }
  admins:         userId[]
  membership:     "open" | "request" | "invite_only"
  requires_certification: boolean  // Si true, al aceptar seller valida cert
  seller_count:   number           // cache calculado
  created_at:     ISO
}
```

Pertenencia:

```
seller.profile.publicData.communities : {
  sectorial:  string[]  // ["opf", "alimentos-organicos"]
  modelo:     string[]  // ["productor-directo"]
  geografica: string[]  // ["morelos", "cuernavaca"]
}
```

**Reglas**:
- Un seller puede pertenecer a N comunidades de cualquier tipo.
- La membresía es gratuita por default; algunas comunidades (p.ej.
  "Orgánicos Certificados") requieren verificación de documentos.
- Admins de la comunidad son operadores + opcionalmente líderes
  externos (p.ej. el Prof. para OPF).

### URLs y rutas

Backend: **una sola tabla/colección `communities`**; el tipo es un
atributo.

Frontend: rutas distintas según `type` para claridad conceptual al
buyer:

```
/comunidad/opf                   → type=sectorial, slug=opf
/comunidad/alimentos-organicos   → type=sectorial, slug=alimentos-organicos
/region/morelos                  → type=geografica, slug=morelos
/region/san-miguel-de-allende    → type=geografica, slug=san-miguel-de-allende
/programa/productor-directo      → type=modelo, slug=productor-directo
```

El route handler lee el prefijo (`/comunidad`, `/region`,
`/programa`), lo mapea a type, hace lookup por slug.

## Reglas LOCKED

1. **Categoría primaria es 1 y solo 1 por listing**. Si en el
   futuro se requieren múltiples, actualizar este ADR + migrar
   data existente + ajustar search.
2. **Facetas NO pueden duplicar lo que vive en `categoryLevel2/3`**.
   Si un atributo tiene jerarquía, va en la taxonomía primaria. Si
   es transversal, va en facetas. Catálogo de facetas vive en
   `src/config/facets.js` — no hardcodear en componentes.
3. **La comunidad pertenece al seller, no al listing**. Los
   listings heredan la visibilidad vía join server-side; no se
   duplica el atributo en cada listing.
4. **Los 3 tipos de comunidad usan la misma entidad backend**. La
   separación es solo de URL y branding. Admin OPS las lista
   juntas con filtro por tipo.
5. **Fiscal**: el `facets.fiscal` del seller declara; Xololo no
   asesora. El valor `exento-art-9` requiere disclaimer visible
   en la UI y queda registrado en audit log del listing.

## Dependencias

- **Validación fiscal con contador especializado agrícola**
  (TODO antes de la Fase 3 de implementación). Casos a resolver:
  - Criterio del SAT para plantas ornamentales (16% vs. 0%).
  - Alcance del "productor directo" en Art. 9 fracc. IV.
  - Cuándo un servicio de jardinería incluye venta de plantas y
    cómo clasificar la operación combinada.
- **Validación de catálogo con sellers reales de OPF** antes de
  cerrar la taxonomía del Sector Verde (ver
  `docs/TAXONOMIA_SECTOR_VERDE.md`).

## Impacto en código existente

### Reemplazo gradual

El modelo actual (`categoryLevel1` solo) **no se elimina**. Se
expande:
- `categoryLevel2` ya existe en algunas subcategorías; se
  generaliza.
- `categoryLevel3` es nuevo opcional.
- `facets` es nuevo (objeto en `publicData`).
- `communities` es nuevo (objeto en `seller.profile.publicData`).

Los listings legacy siguen funcionando: si no tienen `facets` ni
el seller tiene `communities`, aparecen normalmente, sin filtros
nuevos.

### Lugares afectados (todos en fases posteriores, NO este ADR)

- `src/config/listingAttributes.js` — agregar L3 opcional.
- `src/config/facets.js` — NUEVO.
- `src/config/communities.js` — NUEVO (lista de comunidades
  iniciales).
- `src/containers/EditListingPage/*` — wizard con pasos:
  - Categoría (existe, ampliar a L3).
  - Facetas (nuevo panel).
  - Fiscal (ampliar con 4 opciones + disclaimer).
- `src/containers/SearchPage/*` — filtros por faceta en la UI.
- `src/containers/ManageStorePage/*` — tab Comunidades.
- `server/api/communities.js` — NUEVO CRUD + join.
- Nuevas landings `/comunidad/:slug`, `/region/:slug`,
  `/programa/:slug`.
- `server/api-util/landingListingsService.js` — ADR-005; si un
  buyer entra por una landing de comunidad, filtrar sellers por
  membresía.

## Smoke tests obligatorios (cuando se implemente)

- Un seller sin comunidades sigue visible en search/landing como
  hoy.
- Un listing sin facetas aparece en todos los filtros (no excluye).
- Un seller con membresía a OPF aparece en `/comunidad/opf` Y en
  categoría primaria.
- Un seller en Comunidad Morelos y Comunidad Productor Directo
  aparece en ambas landings sin duplicar.
- Un listing con `fiscal: exento-art-9` muestra el disclaimer en
  ListingPage.

## Plan de fases (sin tocar código en este ADR)

- **Fase 0 (este ADR)**: decisión arquitectónica y reglas LOCKED.
- **Fase 1**: `docs/TAXONOMIA_SECTOR_VERDE.md` con validación OPF.
- **Fase 2**: `docs/MODEL_COMMUNITIES_V1.md` con flujos UX.
- **Fase 3**: validación fiscal con contador (TODO bloqueante).
- **Fase 4**: implementación backend (model + endpoints).
- **Fase 5**: implementación frontend (wizard + landings).
- **Fase 6**: seeding de OPF como primera comunidad.
- **Fase 7**: QA + rollout.

## Rollback

Si la decisión se demuestra equivocada en V1:
- Las facetas son additive — eliminar el atributo en
  `publicData.facets` deshabilita los filtros nuevos; todo sigue
  funcionando por `categoryLevel1`.
- Las comunidades son additive — eliminar las membresías del
  seller las oculta de las landings dedicadas; su tienda sigue
  en el buscador general.

Zero migración destructiva.

## Estado por fase

- [x] Fase 0: ADR + decisión
- [~] Fase 1: Taxonomía Sector Verde — [docs/TAXONOMIA_SECTOR_VERDE.md](../TAXONOMIA_SECTOR_VERDE.md) (draft; pendiente validación OPF)
- [x] Fase 2: Modelo Comunidades V1 — [docs/MODEL_COMMUNITIES_V1.md](../MODEL_COMMUNITIES_V1.md)
- [ ] Fase 3: Validación fiscal con contador
- [ ] Fase 4-7: Implementación
