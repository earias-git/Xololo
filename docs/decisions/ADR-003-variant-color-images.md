# ADR-003: Foto por color en variantes de Moda

Fecha: 2026-11-17
Status: **ACTIVA — implementada, flag OFF en producción**
Owner: @earias
Supersede: n/a
Última revisión: 2026-11-17 (Fase 6 — cierre)

## Decisión

En listings de **categoría `moda`** con eje de variante **`color`**, el
seller puede subir **1 imagen por valor del color** desde el panel
de Variantes del wizard. La imagen se guarda **exclusivamente en el
listing master**, en `publicData.variantValueImages.color.<slug>`.

`ListingPage` del sibling (hermano) hace **lectura pull** del master
para obtener la imagen correspondiente al color del sibling. Si no
existe entrada, cae a las imágenes nativas del sibling / master.

**Direccionalidad estricta**: zero writes cross-listing. El feature
NO toca `replicateMasterSharedFieldsThunk` ni los `publicData` de
los siblings.

## Contexto

- 2026-11-17: el user pidió esta mejora de UX inspirada en el patrón
  Zara/Shein (cambia foto al cambiar color). Caso típico moda.
- El bug reciente `0b100d554` ("Oxford bostoniano" pisado) nació
  justamente de un flujo push master → siblings mal filtrado por
  `variantGroupId`. Diseñar este feature en modo push repetiría el
  riesgo; por eso vamos en modo pull (lectura en runtime en la
  ListingPage del sibling).
- Alternativas descartadas:
  - **Push a siblings** (replicar imagen a cada sibling de ese color):
    repite el patrón del bug Oxford. Requiere tocar
    `replicateMasterSharedFieldsThunk` (LOCKED post commit `0d8e7c0de`).
  - **Foto por combinación** (talla+color): 8 combinaciones = 8
    uploads; UX insostenible para sellers reales.
  - **Galería por color** (N imágenes por color): infla el modelo;
    si el seller necesita más fotos, puede editar el sibling
    individualmente.
  - **Cualquier categoría**: aumenta edge cases (hogar, electrónica
    con "color" no es tan visual). V1 arranca con moda únicamente.

## Scope V1

| Dimensión | Decisión |
|---|---|
| Categorías habilitadas | `publicData.categoryLevel1 === 'moda'` (las 6 sub-categorías) |
| Ejes habilitados | Solo eje `color` |
| Imágenes por valor | 1 |
| Flag ON/OFF | `REACT_APP_FEATURE_VARIANT_COLOR_IMAGES` |
| Rollout inicial | Flag OFF en prod → encender manual tras QA con byGastelum |

## Shape del dato (en el master)

```json
{
  "publicData": {
    "variantValueImages": {
      "color": {
        "rojo": "<sharetribe-image-id>",
        "verde": "<sharetribe-image-id>",
        "blanco-roto": "<sharetribe-image-id>"
      }
    }
  }
}
```

- Nivel `color` es el nombre del eje. Fijo en V1, extensible.
- Keys son **slug** del valor: `slugifyAxisValue("Blanco Roto") === "blanco-roto"`.
- Valores son `imageId` del Sharetribe image record **del master**.

## Código afectado (se marcará `XOLOLO LOCKED`)

- `src/util/variants.js` — helpers puros nuevos
  (`slugifyAxisValue`, `isFashionCategory`, `getColorAxisValues`,
  `getColorImageIdForValue`, `setColorImageId`, `pruneDanglingColorImages`).
- `src/containers/EditListingPage/EditListingWizard/EditListingVariantsPanel/*`
  — slot UI para upload por color (solo si moda + eje color).
- `src/containers/ListingPage/ListingPage.duck.js` — fetch del master
  cuando el listing es sibling.
- `src/containers/ListingPage/*` — galería lee `variantValueImages`
  del master y swap de la primera imagen.

## Smoke test obligatorio

`server/smoke/variantColorImages.smoke.test.js` (se añadirá en Fase 4):

1. Crear master moda con 3 colores.
2. Subir foto al color "rojo" vía el flow del panel.
3. Verificar `master.publicData.variantValueImages.color.rojo` existe.
4. Verificar que **ningún sibling** cambió su `publicData`.
5. Verificar que **un listing ajeno al grupo** (mismo seller, otra
   categoría) **no cambió nada** — reproducción explícita del patrón
   del bug Oxford.

## Reglas "hard" para futuros contribuyentes

- **`variantValueImages` solo se escribe en el master**, nunca en
  siblings. Cualquier PR que escriba este campo en un sibling debe
  actualizar este ADR (cambiando el status) y justificar.
- **No entrar a `REPLICABLE_TABS`**. Si se quiere replicar, abrir
  ADR separado.
- **Lectura siempre vía `getColorImageIdForValue(master, value)`**.
  No leer `publicData.variantValueImages` crudo en componentes.

## Rollback

- Apagar `REACT_APP_FEATURE_VARIANT_COLOR_IMAGES=false` en Render →
  restart automático en ~30s. UI vuelve a estado anterior. Los
  datos quedan quietos en `publicData` (no se borran); si se
  reactiva, se retoman.

## Estado por fase

- [x] Fase 0: ADR + flag + LOCKED notes — commit `743f7e3dd`
- [x] Fase 1: helpers puros + tests unitarios (99/99) — commit `04b1005fb`
- [x] Fase 2: wizard UI con slot por color — commit `2a6ecfdb7`
  - Fix lectura imageId del payload — commit `f171727f4`
- [x] Fase 3: lectura pull en ListingPage — commit `82e66342f`
  - Fix swap galería en master al cambiar color — commit `5c294c644`
- [x] Fase 4: smoke anti-Oxford (7 tests, 26/26 suite) — commit `3413eb94b`
- [x] Fase 5: QA local con chamarra verde — validado 2026-11-17
- [x] Fase 6: docs de cierre — este commit

## Cómo encender en producción

El flag `REACT_APP_FEATURE_VARIANT_COLOR_IMAGES` **está en OFF** por
default en `.env-template`. Para encenderlo en Render (prod):

1. Dashboard de Render → servicio `xololo-marketplace` → Environment.
2. Agregar variable: `REACT_APP_FEATURE_VARIANT_COLOR_IMAGES=true`.
3. Save Changes → Render reinicia el servicio solo (~1 min).
4. Verificar en una pestaña incógnita que:
   - Entrando a un master de moda con variantes color → el selector
     funciona y la galería swap al cambiar color.
   - Entrando a un sibling directo → la galería muestra la foto
     correcta del color del sibling.
   - Un listing moda sin eje color → sin cambios.
   - Un listing fuera de moda → sin cambios.

Para apagarlo: borrar la variable o setear `false` → restart
automático. Los datos `publicData.variantValueImages` ya guardados
permanecen; el feature se reactiva al encender el flag otra vez
(zero pérdida).

## Verificación QA (chamarra verde, 2026-11-17)

Caso real: `/l/chamarra-verde-para-hombre-talla-m-oto-o-invierno/6af2188d-…`

- Seller subió 4 fotos (Verde, Blanco, Rojo, Rosa) desde el wizard
  de Variantes. Todas quedaron attachadas al master.
- Buyer en incógnito: al cambiar el chip de color en la ListingPage
  del master, la galería hace swap a la foto correspondiente.
- Buyer en incógnito: al abrir un sibling directo (ej. via selector
  de tienda), la galería muestra la foto del color del sibling como
  primera.
- `replicateMasterSharedFieldsThunk` **no fue invocado** en ningún
  guardado del panel de variantes (confirmado por ausencia del log
  `replicate-overshoot` y por inspección del thunk, que requiere
  `REPLICABLE_TABS` y esos no se tocaron).
- Los smoke anti-Oxford pasan: 26/26.
