# ADR-004: Sincronización de stock master ↔ matriz de variantes

Fecha: 2026-11-17
Status: **ACTIVA — en implementación**
Owner: @earias
Supersede: n/a

## Decisión

Al guardar el panel de Variantes:

1. **El master toma su stock y precio de la fila del `variantsMatrix`
   cuyos `variantValues` coinciden con los suyos.** Si el master tiene
   98 en `currentStock` y la fila Blanco/XS dice 20, el master pasa
   a 20.
2. **Los siblings se crean/actualizan/cierran según el matrix**, con
   el stock exacto que el seller puso en cada fila.
3. **Antes del sync, el master se re-hidrata con `currentStock`
   incluido** para evitar el bug de `oldTotal:null` en
   `setStockThunk`, que causa 409 silencioso en Sharetribe.
4. **UI preventiva**: el tab Precio e inventario avisa que el
   Inventario es sobreescrito si hay variantes activas. El tab
   Variantes marca con un badge visible la fila que corresponde al
   master como "Listing principal".

## Contexto

Caso real reportado 2026-11-17: Traje de baño rojo de dos piezas
(`6adbbafd-9dbd-477b-80a5-227f1f049e76`):

- Master `publicData.attributes = {color:['Blanco'], talla:'XS',…}`.
- `publicData.variantValues = {color:'Blanco', talla:'XS'}`.
- `publicData.variantsMatrix` con 4 filas: `Rojo/XS`, `Rojo/S`,
  `Blanco/XS` (stock=20), `Blanco/S`.
- `currentStock.quantity = 98` (real en Sharetribe).
- `0 siblings` creados. **Nada se sincronizó.**

### Causa raíz 1 — master stock queda huérfano

`syncVariantSiblingsThunk` encuentra correctamente la fila del
master (`masterRowIdx = 2`, `masterKey = "Blanco||XS"`). Intenta
actualizar con `setStockThunk`:

```js
await dispatch(
  setStockThunk({
    listingId: masterListingId,
    oldTotal: typeof masterStock === 'number' ? masterStock : null,
    newTotal: masterRow.stock,
  })
).unwrap();
```

Pero `masterStock` viene de `state.marketplaceData.entities.ownListing`,
que cuando el seller entra al tab Variantes **no siempre trae
`currentStock` incluido**. Entonces `masterStock = undefined` →
`oldTotal: null` → Sharetribe `stock.compareAndSet` responde 409
porque el stock ya existe (98). El `catch` loggea con `log.error`
y continúa. Master nunca se actualiza.

El mismo comentario en `src/containers/EditListingPage/EditListingPage.duck.js:475-479`
reconoce este problema para siblings y agregó `include: currentStock`
a la query de hermanos. **Pero nunca se aplicó al master.**

### Causa raíz 2 — siblings no se crearon

En el caso real, 0 siblings. Hipótesis a confirmar con logs del
browser:
- `createDraft` o `publishDraft` falla por un campo requerido
  faltante en `buildSiblingPayload`.
- O `setStockThunk` del sibling recién creado también cae en el
  mismo problema.

### Causa raíz 3 — UX ambigua

El seller edita Inventario en tab Precio (`98`) sin saber que el
tab Variantes lo pisa. Y en tab Variantes, la fila `Blanco/XS`
parece una variante más, sin indicar que ES el master.

## Scope del fix

| Dimensión | Decisión |
|---|---|
| Tocar `syncVariantSiblingsThunk` | SÍ — re-hidratar master con currentStock antes del sync |
| Tocar `setStockThunk` | NO — su API es correcta |
| Tocar `buildSiblingPayload` | Depende del hallazgo de la Causa Raíz 2 |
| UI preventiva tab Precio | Banner informativo si `isVariantMaster=true` |
| UI badge tab Variantes | "Listing principal" sobre la fila que matchea masterValues |
| Feature flag | NO — este es un bug fix, no un feature |

## Plan de fases

### Fase 0: ADR + LOCKED (este commit)
Documentación y gates. Sin código funcional.

### Fase 1: Debug de los siblings faltantes
Pedir al user los logs del browser del último save. Confirmar
Causa Raíz 2. Si es `buildSiblingPayload` incompleto, ajustar.

### Fase 2: Fix del master stock sync
- En `syncVariantSiblingsThunk`, antes de leer `masterStock`,
  hacer un fetch explícito del master con
  `include: ['currentStock']` para hidratar Redux.
- Fallback defensivo: si tras el fetch `currentStock` sigue sin
  llegar, no llamar `setStockThunk` con `oldTotal:null` cuando el
  master es published (porque siempre tiene stock); mejor hacer
  un `oldTotal` tentativo (`masterRow.stock` previo si lo tenemos
  del input viejo del tab Precio, o reintentar leyendo el listing).
- Ambos path loguean `sync-variants-master-stock-rehydrate-failed`
  con detalles para debugging en Sentry.

### Fase 3: Fix del spawn de siblings
Según hallazgo de Fase 1. Posibles:
- Incluir campos requeridos en `buildSiblingPayload`
- Reintentos con backoff si es race
- Mensaje de error visible al seller si falla el spawn

### Fase 4: UI preventiva
- Tab Precio e inventario: si `isVariantMaster=true`, mostrar
  banner "Si tu producto tiene variantes activas, el inventario
  se gestiona desde el tab Variantes" y deshabilitar el campo
  Inventario.
- Tab Variantes: la fila del matrix que matchea `masterValues`
  aparece con un badge "Listing principal" y una tooltip
  explicando que su stock pisa el del master.

### Fase 5: Smoke tests
- Smoke test de `syncVariantSiblingsThunk` con mock que verifica:
  - master.currentStock se re-hidrata antes del sync
  - masterRow matchea → stock actualizado correctamente
  - siblings creados con stock correcto
  - no se tocan listings ajenos al grupo (anti-Oxford extendido)

### Fase 6: QA manual + docs cierre
Validar con el listing del traje de baño real.

## Reglas "hard"

- **NO tocar `replicateMasterSharedFieldsThunk`**. Está LOCKED por
  ADR-003 y el bug Oxford.
- **NO tocar `setStockThunk`**. API correcta; el problema es el
  caller.
- Todas las llamadas a `setStockThunk` desde `syncVariantSiblingsThunk`
  deben ir precedidas de una verificación de `oldTotal` real.

## Rollback

Si la Fase 2 introduce regresión, revertir el commit. El código
previo deja el master con stock stale pero no corrompe otros
listings.

## Estado por fase

- [x] Fase 0: ADR + LOCKED (este commit)
- [ ] Fase 1: Debug siblings faltantes
- [ ] Fase 2: Fix master stock sync
- [ ] Fase 3: Fix spawn siblings
- [ ] Fase 4: UI preventiva
- [ ] Fase 5: Smoke tests
- [ ] Fase 6: QA + docs cierre
