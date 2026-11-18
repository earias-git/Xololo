# ADR-005: Hidratación del landing vía endpoint server-side

Fecha: 2026-11-18
Status: **ACTIVA — implementada y validada en producción**
Owner: @earias
Supersede: n/a

## Decisión

La LandingPage **no consulta Sharetribe directo**. Pega al
endpoint propio `GET /api/landing-listings`, que:

1. Pagina internamente (perPage=100, max 5 páginas) hasta reunir
   N listings válidos por bucket — o agotar el marketplace.
2. Aplica **toda la lógica de filtrado en el server** (sin
   depender de que Sharetribe indexe campos no registrados en
   Console):
   - **products**: `!isSibling && !isEvent`
   - **services**: `!isSibling` (incluye eventos para que el
     selector cliente los agrupe)
   - **used**: `!isSibling && isUsedListing` donde
     `isUsedListing` combina 3 señales (OR):
     - a) `publicData.condition === 'used'`
     - b) `publicData.taxClassification.code === 'exento_9_iv'`
     - c) `author.profile.publicData.sellerMode === 'casual_reseller'`
3. Dedup `included[]` por `type:id` para no inflar la respuesta.
4. Cache in-memory 60s + `Cache-Control: public, max-age=30, s-maxage=60`.
5. Fail-open: si Sharetribe rechaza una página, retorna lo
   acumulado hasta entonces.

El cliente (`src/ducks/landingListings.duck.js`) hace **1 solo
fetch** y revive los tipos SDK (`UUID`, `Money`, `LatLng`,
`BigDecimal`) para que los selectores existentes (que esperan
el shape SDK) funcionen sin cambios.

## Contexto

### Bug reportado 2026-11-18

El landing mostraba 5-7 productos cuando el marketplace tenía
46 published. Causa: tras ADR-004 (sync real de siblings), un
master generaba 10-15 siblings nuevos; con `perPage=24` + sort
por `createdAt DESC`, los siblings ocupaban todos los slots de
la página 1. Los masters "viejos" (Oxford, Chuleta, Mezcal,
Cempasúchil) quedaban en página 2, que el landing nunca pedía.
El filtro cliente `filterSearchable` dejaba ~5 resultados reales.

### Alternativas descartadas

- **Parche `perPage=100`** (commit `a68f90386`, revertido):
  aguantaba hasta ~200 published; falla cuando el marketplace
  crece. **Rechazado** como solución final.
- **Registrar `variantGroupId` + `isVariantMaster` como listing
  fields searchable en Sharetribe Console**: requiere trabajo
  manual en Console + reindex de 2-4h; depende de que el
  operador configure correctamente. Válido técnicamente, pero
  **no se eligió** para no depender de intervenciones manuales.
- **Rediseñar el modelo de variantes** (siblings dentro del
  master en vez de listings separados): rework grande con
  migración de data existente. **Archivado**.

### Por qué el server-side gana

| Dimensión | Cliente directo | Server-side (elegido) |
|---|---|---|
| Round-trips | 3 queries | 1 fetch |
| Lógica filtrado | Duplicada cliente+server | **Única, central** |
| Depende de Console? | Sí (campos registrados) | **No** |
| Escala | Limitada por perPage cliente | **Pagina hasta reunir N válidos** |
| Cache cross-user | No | **60s in-memory + 30s CDN** |
| Rollback | Difícil (código distribuido) | Revertir 1 commit |

## Reglas LOCKED

**Zero cambios sin actualizar este ADR:**

1. **Las 3 señales de usado deben coincidir** entre:
   - `server/api-util/landingListingsService.js#isUsedListing`
   - `src/ducks/landingListings.duck.js#isUsedListing` (si aún
     se usa cliente-side; en V1 quedó solo server-side)
   - `src/containers/SearchPage/SearchPage.duck.js` (filtro
     `condition=used` del `/s`)

   Si se agrega una señal (d), actualizar los tres lugares y
   los smoke tests. Si se quita alguna, documentar por qué en
   un ADR nuevo.

2. **El shape de retorno es contrato**:
   ```
   { products: {data, included}, services: {data, included}, used: {data, included} }
   ```
   Los selectores `selectFeaturedProducts/Services/Used` lo
   asumen. Cambiarlo requiere migrar los selectores y los
   placeholders de la LandingPage.

3. **El predicado `isValidFn` recibe `(listing, authorsById)`**
   — no sólo `listing`. Esto permite filtrar por señales que
   dependen del author (como `sellerMode`). No colapsar a
   `l => bool` sin pasar por un ADR.

4. **NO exponer `expand=true` ni datos sensibles** en el
   endpoint público `/api/landing-listings`. Solo el shape
   mínimo que el landing necesita. El endpoint es público y
   sin auth.

## Smoke tests obligatorios

`server/smoke/landingListings.smoke.test.js` cubre:

1. Siblings nunca entran a ningún bucket (anti-saturación).
2. Used filtra por condition O taxCode.
3. **Used incluye casual_reseller (señal c)** — anti-regresión
   del bug de "Guantes" reportado 2026-11-18.
4. Paginación continúa cuando page 1 se satura de siblings.
5. Included se deduplica por type+id.
6. Cache: 2ª llamada no re-consulta Sharetribe.

Si uno falla al tocar `landingListingsService.js`, PARAR y
confirmar que el cambio es intencional. Actualizar el test
junto con el código, no después.

## Código afectado (marcado `XOLOLO LOCKED`)

- `server/api-util/landingListingsService.js` — service completo.
- `server/api/landing-listings.js` — endpoint.
- `server/apiRouter.js` — ruta `/api/landing-listings`.
- `src/ducks/landingListings.duck.js` — fetcher + reviveSdkTypes.

## Rollback

Para revertir a 3 queries cliente directo:
1. Revertir commits `99524f083` + `5e341e549`.
2. El selector `filterSearchable` cliente y el `perPage=24` vuelven.
3. **ATENCIÓN**: el bug del landing vacío con muchos siblings
   regresa. No revertir sin plan alterno.

## Qué hacer cuando el marketplace crezca a >1000 published

El `maxPages=5` (= 500 listings por bucket) actual es suficiente.
Si crece más:
- **Opción A**: aumentar `maxPages` a 10-20. Lineal en costo
  Sharetribe pero los primeros 1000 masters/simples siguen
  entrando. Suficiente para landing (se muestran solo 12).
- **Opción B**: registrar `isVariantMaster` como listing field
  searchable en Console (ADR-006?) → cambia el filter a
  `pub_isVariantMaster=true` y `maxPages=1` suficiente.
- **Opción C**: montar Algolia como índice secundario con
  campos de filtro custom.

A/B son compatibles con este ADR sin rework del servicio.

## Estado por fase

- [x] Diagnóstico + decisión server-side (este commit)
- [x] Implementación backend + frontend — commit `99524f083`
- [x] Fix señal (c) casual_reseller — commit `5e341e549`
- [x] ADR + LOCKED notes (este commit)
