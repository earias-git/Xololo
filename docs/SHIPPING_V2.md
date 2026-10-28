# Xololo — Envíos v2

Fecha: 2026-10-27
Estado: en producción (iteración abierta).
Documento vivo: refleja el estado del código tal como está mergeado en `main`.

Este documento complementa [`docs/LOGISTICS_V1.md`](./LOGISTICS_V1.md). V1
captura la **política de negocio** (domicilios, timeline de 8 estados,
disputas, encuesta post-entrega, matriz de notificaciones, recolección con
código de 6 dígitos). Esos capítulos **no cambian** en v2.

V2 captura todo lo que cambió al implementar v1 contra la realidad: la API
de Skydropx, los acuerdos de la junta 2026-10-26, los findings de la 2ª
reunión 2026-10-27, y los fixes de seguridad / UX que resultaron.

Si una regla contradice a v1, **v2 gana**. Las secciones que no se
mencionan aquí siguen vigentes tal como están en v1.

---

## 0. Lectura rápida — qué cambió desde v1

| Tema | v1 | v2 |
|---|---|---|
| Métodos de envío | Asume paquetería (Skydropx) siempre | **4 métodos configurables por listing** (pickup, local, Skydropx, freight) |
| SOS Protección | Obligatorio ($25 fijo, +14% margen) | **Opt-in (default OFF)** · costo real de Skydropx · margen **12.5%** |
| Fotos SOS | 5 fotos siempre, bloquean la guía | Condicionales: obligatorias si hay seguro, recomendadas si no |
| Foto `03_guia` (etiqueta) | Antes de generar guía | Después: la guía no existe hasta que Skydropx la emita |
| Cotización | Sólo CP origen/destino | **Dirección completa** (`street1`) para evitar zona extendida sorpresa |
| Rates al cliente | JSON crudo | **Firmados con HMAC-SHA256**, TTL 30 min, verify en initiate |
| Pricing al buyer | "Guía + SOS + 14%" visible | **Nunca se muestra el %**: sólo total + línea separada para seguro si lo compró |
| Carriers sin pickup | No distinguidos | **Badge "sólo drop-off"** para J&T y 99minutos (confirmado por Skydropx) |
| Pérdidas de margen | No se detectaban | **`shippingLossMonitor`** compara expected vs. actual con umbral 10% / $50 MXN |
| Rate limit | Ninguno | 6 buckets · **`shippingQuote` 30/min** por usuario o IP |
| Catálogo de prohibidos | — | `src/util/carrierProhibitedCatalog.js` con 13 categorías (perecederos, animales, armas, …) |

---

## 1. Cuatro métodos de envío por listing

### Política

Cada listing elige **cualquier combinación** de los 4 métodos. Es decisión
del seller, no una propiedad del marketplace. El checkout ofrece sólo los
métodos **habilitados en el listing** y **compatibles con el carrito**
(cf. §2).

| key | UI buyer | Costo | Quién cotiza |
|---|---|---|---|
| `pickup` | "Recoger con el vendedor" | $0 | — |
| `localDelivery` | "Entrega local" | Flat del seller, en subunits | Seller |
| `skydropxCarrier` | "Paquetería (Skydropx)" | Variable, por rate | Skydropx |
| `freight` | "Carga especializada" | A convenir | Seller (manual) |

### Shape canónico en `publicData`

```js
publicData.xololoShippingMethods = {
  pickup: { enabled, instructions },
  localDelivery: {
    enabled,
    priceSubunits,
    zoneDescription,
    coverageStates: ['MX-CDMX', 'MX-MOR'],
    coverageMunicipios: { 'MX-CDMX': ['Cuauhtémoc', 'Benito Juárez'] },
  },
  skydropxCarrier: {
    enabled,
    sellerCoversShipping,     // boolean — "Envío gratis" como promo
    weightGrams,
    dimensionLengthCm,
    dimensionWidthCm,
    dimensionHeightCm,
  },
  freight: { enabled },
};
```

Falta de key o array vacío en `coverageMunicipios[estado]` = "todos los
municipios del estado".

### Backwards-compat con legacy

Listings pre-v2 traen flags viejos:
`deliveryOptions: ['pickup', 'shipping']`, `shippingPricingMode: 'flat' | 'carrier'`,
`shippingPriceInSubunitsOneItem`, `pickupEnabled`, `shippingEnabled`.

`deriveFromLegacy()` en [`server/api-util/xololoShippingMethods.js:43`](../server/api-util/xololoShippingMethods.js:43)
(y mirror cliente en `src/util/xololoShippingMethods.js`) convierte legacy →
shape v2 **al leer**. No hay migración destructiva: si un listing viejo no
tiene `xololoShippingMethods` o lo tiene vacío con legacy flags presentes,
derivamos al vuelo.

Fuente de verdad al leer: `getShippingMethodsFromListing(listing)`. Nunca
leer `publicData.xololoShippingMethods` directo.

---

## 2. Compatibilidad multi-producto

- **Mismo seller**: carrito con N productos del mismo seller → una
  transacción, una guía (Skydropx multi-paquete), un timeline. (Igual que v1.)
- **Sellers distintos en un carrito**: sigue **no permitido en v1 ni v2**.
  Buyer hace 2 checkouts. Revisión para v3.
- **Métodos incompatibles entre productos del mismo seller**: el checkout
  **sólo ofrece la intersección** de métodos habilitados en todos los
  listings del carrito. Si no hay intersección, modal preventivo al agregar
  al carrito pide decidir (completar sin ese item, o quitar los anteriores).

### Agregación de parcel para Skydropx

Skydropx `/quotations` acepta un parcel singular. Para carritos multi-item
agregamos con `aggregateParcel()` en [`cartShipping.js`](../server/api-util/cartShipping.js):

```
length = max(length_i)
width  = max(width_i)
height = sum(height_i × qty_i)
weight = sum(weight_i × qty_i)  // en kg
```

Modelo "stacking": asumimos apilado vertical. Es conservador para artesanías
regulares; para irregulares el seller puede iterar en v3 con packages
múltiples. Fallbacks: `FALLBACK_WEIGHT_KG=0.1`, `FALLBACK_DIM_CM=1`.

Si cualquier item del carrito no tiene peso + 3 dimensiones, `aggregateParcel`
lanza — el checkout muestra "no cotizable, revisa las medidas del producto".
Esto impide guías con dimensiones falsas que luego cobran zona extendida.

---

## 3. SOS Protección — ahora opt-in

### Qué cambió respecto a v1

- Default: **OFF**. Buyer elige activarlo en el checkout junto al rate.
- Costo: lo que **Skydropx devuelva** en el response de `/quotations`
  cuando cotizamos con `package_protected: true` + `declared_value`. **Nunca
  calculamos la fórmula localmente**. Si Skydropx no lo expone para un rate
  dado, lo marcamos `insuranceAvailable: false` y el UI oculta la opción con
  seguro para ese rate.
- Margen Xololo: **12.5%** sobre el bruto (guía + SOS si aplica). Antes era
  14%; se unifica con el flujo público de venta de guías (#28).
- Fotos: **condicionales al seguro** (ver §4). Antes bloqueaban siempre.
- UI: **no se muestra "+12.5%"** ni el breakdown al buyer. Sólo el total final
  cotizado por Skydropx + margen.

### Cómo responsabiliza al buyer sin seguro

Al **no** activar el seguro, el buyer firma consentimiento con texto legal
(cf. §9 TOS addendum). En caso de pérdida o daño del paquete:

- Xololo coordina el reclamo con la paquetería pero **no absorbe el valor
  del producto**.
- El seller tiene foto de embalaje y de la guía como evidencia (recomendadas
  aun sin seguro — ver §4).
- Si el buyer alega "no recibí" sigue aplicando §3 de v1 (ventana 48h,
  disputa interna, afirmativa ficta).

### Fórmula implementada

En [`skydropx.js:160` (`applyPricingPolicy`)](../server/api-util/skydropx.js:160):

```js
XOLOLO_MARGIN_PCT = 0.125;  // antes 0.14

base   = rate.total (Skydropx neto, sin seguro)
sos    = Skydropx devuelto (0 si buyer no quiere seguro)
bruto  = base + sos
total  = bruto × 1.125

// Breakdown público para el lineItems:
insuranceTotalPublic = sos × 1.125
shippingFeePublic    = total - insuranceTotalPublic
// Invariante: shippingFeePublic + insuranceTotalPublic === total
```

El rate que vuelve al cliente trae:

```js
{
  id, carrier, carrierCode, service, serviceCode,
  total,                   // precio público final (ya con margen)
  currency, days, pickup, officeDelivery,
  dropoffOnly,             // true para J&T, 99minutos (ver §5)
  pricing,                 // breakdown interno (sin exponer al buyer)
  insurable,
  insuranceCostReal,       // lo que Skydropx cobra por el seguro, 0 si no se pidió
  insuranceAvailable,      // true si Skydropx devolvió costo del seguro para este rate
  insuranceTotalPublic,    // sos × 1.125, para línea separada en breakdown
  shippingFeePublic,       // total - insuranceTotalPublic
  signature,               // HMAC — ver §6
  signatureIssuedAt,
}
```

### Breakdown al buyer

Dos líneas en vez de una (sólo si contrató seguro):

```
Envío por FedEx Economy             $192.80
Compra protegida (hasta $100,000)    $31.25
```

Sin seguro, una sola línea: `Envío por FedEx Economy  $161.55`.

El label mostrado nunca menciona `12.5%` ni "margen".

---

## 4. Fotos SOS — condicionales y con cámara + archivo

### Reglas v2

| Fotos | Con seguro | Sin seguro |
|---|---|---|
| `01_producto` (sin embalar) | obligatoria | **recomendada** |
| `02_embalado` (con material de protección) | obligatoria | **recomendada** |
| `03_guia` (etiqueta pegada al paquete) | obligatoria | opcional |
| `04_medidas` (regla / flexómetro) | obligatoria | opcional |
| `05_peso` (báscula) | obligatoria | opcional |

- **Con seguro**: las 5 bloquean el botón "Generar guía".
- **Sin seguro**: ninguna bloquea, pero la UI insiste con copy
  "te sirven para cualquier disputa con la paquetería o con el banco".

### Fix v1 → v2: la foto 03 ya no se pide antes de que exista la guía

En v1 el flujo bloqueaba generar la guía sin la foto de la etiqueta
pegada. Pero la etiqueta la emite Skydropx **al generar la guía**, así que
era imposible subirla antes.

v2: `03_guia` se solicita **después** de que Skydropx retorna la etiqueta.
El seller imprime, pega, fotografía y sube — en ese orden. El resto de las
fotos (01, 02, 04, 05) se puede subir desde que se confirma el pago.

### Cámara + archivo

El `SosPhotosUploader` ofrece dos botones por slot:

- **"Tomar foto"** — abre la cámara del dispositivo (`<input capture>`).
  Usuario en móvil enfoca y dispara.
- **"Subir archivo"** — picker estándar. Para desktop o fotos ya tomadas.

Ambos van a R2 bajo:

```
orders/{transactionId}/insurance/{01_producto,02_embalado,03_guia,04_medidas,05_peso}.jpg
```

Y quedan disponibles para Stripe Disputes evidence (§3 v1) y reclamos SOS
(§5 v1).

---

## 5. Carriers sin pickup — drop-off only

Según la junta 2026-10-27 §5, Skydropx confirmó que estos carriers **sólo
aceptan drop-off en sucursal** (no agendan recolección):

```
j&t / jt_express / jyt / jt express
99min / 99minutos / 99_min / 99 minutos
```

En [`skydropx.js:145`](../server/api-util/skydropx.js:145) la lista
`CARRIERS_WITHOUT_PICKUP` y el helper `isDropoffOnlyCarrier()` detectan el
match case-insensitive contra `provider_name` y `provider_display_name`,
con y sin espacios / guiones / underscores.

El rate expone:

- `pickup: false` (forzado — ignoramos lo que diga Skydropx para estos
  carriers; su API a veces miente).
- `dropoffOnly: true`.

UI: badge amarillo "Sólo drop-off en sucursal" junto al nombre del carrier,
y el flujo "agendar recolección" se oculta para ese rate. El seller recibe
instrucciones de llevar el paquete a sucursal con la guía impresa.

---

## 6. Firma HMAC de rates — anti-tampering

### Por qué

Antes, el cliente recibía rates como JSON crudo. Un atacante podía abrir
devtools, editar `rate.total` a $1, mandar el checkout, y Xololo cobraba
$1 por envío. Dinero perdido directo porque los lineItems se construían
server-side desde `rate.total`.

### Qué cubre la firma

Payload HMAC-SHA256 sobre:

```
rate.id | quotationId | rate.total | rate.insuranceCostReal
       | rate.shippingFeePublic | rate.insuranceTotalPublic
       | rate.currency | issuedAt
```

Si el cliente altera **cualquiera** de esos campos, la firma no coincide y
`verifyRateSignature()` devuelve `{ valid: false, reason: 'signature_mismatch' }`.

### TTL + rotación

- **TTL**: 30 minutos (`RATE_SIGNATURE_TTL_MS`). Después del TTL,
  `signature_expired`: el buyer re-cotiza. Rate viejo no se puede replay.
- **Secret**: `SHIPPING_RATE_SECRET`. Fallback: `OPERATOR_SESSION_SECRET`
  (compat con despliegues previos). En dev cae a `xololo-dev-only-not-for-prod`
  si no hay ninguno — sólo para no romper el servidor local.
- **Rotación**: durante la ventana de rotación, acepta firmas hechas con
  `SHIPPING_RATE_SECRET_PREV` además de la actual. Ver `getRateVerifySecrets()`
  en [`skydropx.js:77`](../server/api-util/skydropx.js:77). Procedimiento en
  `docs/SECURITY.md` §secret-rotation.

### Dónde verifica

[`server/api/initiate-privileged.js:158`](../server/api/initiate-privileged.js:158)
y `:251` (los dos handlers que inician transacción — carrito single y
multi-item).

Si la firma falla, el initiate se rechaza antes de persistir cualquier cosa
en Sharetribe o pasar por Stripe. El buyer ve "la cotización expiró, por
favor recotiza".

### Tests

`server/api-util/skydropx.rateSignature.test.js` cubre:

- firma válida pasa
- rate con `total` alterado → mismatch
- rate con `signature` ausente → missing
- rate con `issuedAt` fuera de TTL → expired
- rotación: firma hecha con `_PREV` sigue válida

---

## 7. Dirección completa en la cotización — fin de "zona extendida sorpresa"

### Problema v1

Cotizábamos sólo con CP origen/destino. Al generar la guía con dirección
completa, Skydropx a veces añadía recargo de "zona extendida" que no
aparecía en la cotización. Buyer ya había pagado el precio cotizado y el
delta lo absorbía Xololo.

### Fix v2

`getQuotationRates()` acepta `street1` en `from`/`to` y lo manda a Skydropx
al cotizar. Confirmado con Skydropx 2026-10-27: cuando el `/quotations` ve
dirección completa, aplica el ajuste de zona extendida en el mismo rate que
devuelve. No hay sorpresa al generar la guía.

### UX en checkout

El campo "Calle y número" ahora es **requerido** para pedir cotización. Si
el buyer sólo escribe CP, el botón "Ver tarifas" queda deshabilitado con
tooltip "necesitamos tu dirección completa para no sobrecotizar".

### Monitoreo residual

Aun con esto, puede haber discrepancias (seller declaró peso falso, cambio
de tarifa Skydropx entre cotización e initiate, bug nuestro). Ver §8.

---

## 8. Shipping loss monitor

[`server/api-util/shippingLossMonitor.js`](../server/api-util/shippingLossMonitor.js)
compara al crear la guía:

```
expectedSkydropxNet = shippingFeePublic / 1.125
diff                = actualSkydropxCost - expectedSkydropxNet
```

- **Umbral**: 10% O $50 MXN (lo que sea mayor). Debajo, variación normal.
- Encima: emite warning estructurado al log con `transactionId`, carrier,
  service, `expected`, `actual`, `lossMxn`, `detectedAt`.
- Positivo (`actual > expected`): pérdida real → Xololo la absorbe.
- Negativo: ganancia inesperada → log pero sin acción.

### Dónde se dispara

[`server/api/generate-shipping-guide.js`](../server/api/generate-shipping-guide.js)
después de que `createShipment` retorna. `extractActualCost(response)` intenta
leer `master_rate_price` → `rate_price` → `price` → `total_price` → `total`
según variante de la respuesta Skydropx.

### Endpoint de ops

`GET /api/ops/shipping-losses` lista discrepancias detectadas (ver
`docs/OPERATIONS.md` §shipping-losses). Útil para review semanal.

---

## 9. Legal — consentimiento sin seguro

El seguro opt-in requiere consentimiento informado del buyer. En checkout,
si el buyer **no** activa SOS, aparece checkbox obligatorio:

> "Entiendo que viajo sin seguro: Xololo coordina la gestión con la
> paquetería pero no cubre pérdida ni daño del paquete. Acepto esta
> responsabilidad."

El consentimiento se persiste en
`transaction.protectedData.xololoShipping.noInsuranceConsent = true` junto
con el texto exacto que vio el buyer y el timestamp. Esto es evidencia para
PROFECO y Stripe Disputes.

TOS: addendum en `src/containers/TermsOfServicePage/SosConsentAddendum.js`
(mostrado inline en la página de TOS mientras legal termina el documento
final).

Draft legal completo: Google Doc "Xololo — Consentimiento SOS v2" (revisión
jurídico Xololo pendiente).

---

## 10. Catálogo de productos prohibidos para paquetería

[`src/util/carrierProhibitedCatalog.js`](../src/util/carrierProhibitedCatalog.js)
tiene 13 categorías con keywords, match por palabra completa (no sub-string):

- `perishable_fresh_food`, `live_plants_delicate`, `live_animals`
- `flammable_liquids`, `aerosols_pressurized`, `batteries_loose_lithium`
- `firearms_ammo`, `cash_jewelry_unlisted`, `glass_fragile_large`
- `alcohol_regulated`, `medications_otc`, `cosmetics_leaky`, `heavy_bulky`

`evaluateShippingFit({ title, description, aiAnalysis })` devuelve
`{ blocked, warned, suggestedMethods }`. En el publish wizard, si la IA + el
título disparan `blocked`, el método `skydropxCarrier` se oculta y el
seller debe elegir `pickup`, `localDelivery` o `freight`.

El seller puede **override** con captura explícita de categoría si cree que
el catálogo se equivocó — queda en metadata para auditoría.

---

## 11. Rate limiting

[`server/api-util/rateLimits.js`](../server/api-util/rateLimits.js) define 6
buckets (`express-rate-limit` v7):

| Bucket | Límite | Usado por |
|---|---|---|
| `payment` | 10 / min | /initiate, /transition |
| `ai` | 20 / 5min | descripción IA, catalog analyze |
| `auth` | 5 / 15min | login, password reset |
| `ops` | 30 / min | /api/ops/* |
| **`shippingQuote`** | **30 / min** | **/quote-shipping, /quote-cart-shipping** |
| `generic` | 60 / min | fallback |

Key: `user:<id>` si está autenticado, `ip:<x-forwarded-for>` si no. Esto
evita que un buyer anónimo martille `/quote-shipping` para probar carriers
en loop (DoS + costo API Skydropx).

---

## 12. Flujo end-to-end (post-v2)

### Buyer

1. Agrega listings al carrito. Si incompatibles, modal preventivo.
2. En checkout, llena **dirección completa** (street1 requerido).
3. Click "Ver tarifas" → `POST /quote-cart-shipping` (rate-limited).
4. Server:
   - lee listings del carrito, agrega parcel (`aggregateParcel`).
   - llama Skydropx `/quotations` con `package_protected` según el toggle de
     seguro (default OFF).
   - aplica margen 12.5%, calcula `shippingFeePublic` + `insuranceTotalPublic`.
   - firma cada rate con HMAC (TTL 30 min).
   - devuelve rates ordenados por `total` ASC.
5. Buyer elige rate + toggle seguro + (si no seguro) checkbox de consent.
6. Click "Pagar" → `POST /initiate-privileged` con el rate completo y la
   firma.
7. Server verifica firma; si válida, construye lineItems:
   - `line-item/shipping-fee` = `shippingFeePublic`
   - `line-item/shipping-insurance` = `insuranceTotalPublic` (si > 0)
   - `line-item/sat-vat` sobre comisión Xololo (ver `docs/SELLER_CASUAL.md`
     para la lógica IVA / retención ISR en casual_reseller).
8. Stripe cobra. Timeline arranca en "Pago confirmado".

### Seller

9. Sube fotos SOS 01, 02, 04, 05 (obligatorias si hay seguro).
10. Click "Generar guía" → `POST /generate-shipping-guide`:
    - lee `rate.id` + direcciones + parcels de `transaction.protectedData`.
    - llama Skydropx `/shipments` con `insurance: true/false` según lo que
      firmó el buyer.
    - al éxito, `shippingLossMonitor` compara expected vs actual.
    - polea Skydropx hasta que la `label_url` esté lista (hasta 15s).
11. Seller imprime la etiqueta, pega al paquete, toma foto 03, sube.
12. Agenda recolección (o lleva a sucursal si `dropoffOnly`).
13. Carrier recoge → `tracking` arranca → timeline avanza vía webhooks.

### Entrega → Encuesta → Fondos

Igual que v1 §3 y §4: 48h para disputa, afirmativa ficta libera fondos,
reseña se persiste en `publicData.buyerReview`.

---

## 13. Checklist operativo

- [ ] `SHIPPING_RATE_SECRET` configurado en Render prod y staging.
- [ ] `SHIPPING_RATE_SECRET_PREV` sólo durante rotación (<24h ventana).
- [ ] `SKYDROPX_CLIENT_ID` + `SKYDROPX_CLIENT_SECRET` prod.
- [ ] `SKYDROPX_ENV=production` en prod. Sandbox en staging.
- [ ] Rate limiter en `express` montado antes de los routers que usan
      Skydropx.
- [ ] Dashboard de ops carga `/api/ops/shipping-losses` sin error.
- [ ] Alerta Sentry para `shippingLossMonitor` eventos (ya configurada vía
      log scrape).

---

## 14. Backlog v3 (fuera de scope de este doc)

- Multi-seller cart (sigue de v1 §7).
- Preferencias de canal configurables por usuario (v1 §6).
- Packages múltiples por envío (vs. parcel único agregado).
- Devoluciones y reverse logistics.
- Cobertura internacional.
- Umbral SOS configurable por valor del carrito ("obligatorio arriba de
  $5,000 MXN" como propuso Skydropx en 2ª reunión).
- Fulfillment internacional (DHL/FedEx cross-border).

---

## Referencias

- Política de negocio v1 (vigente, no cambia): [`LOGISTICS_V1.md`](./LOGISTICS_V1.md)
- Seguridad / HMAC rotación: [`SECURITY.md`](./SECURITY.md)
- Ops / endpoints de monitoreo: [`OPERATIONS.md`](./OPERATIONS.md)
- Seller casual (IVA, Art. 9 fracc IV LIVA): [`SELLER_CASUAL.md`](./SELLER_CASUAL.md)
- Código:
  - [`server/api-util/skydropx.js`](../server/api-util/skydropx.js)
  - [`server/api-util/xololoShippingMethods.js`](../server/api-util/xololoShippingMethods.js)
  - [`server/api-util/cartShipping.js`](../server/api-util/cartShipping.js)
  - [`server/api-util/shippingLossMonitor.js`](../server/api-util/shippingLossMonitor.js)
  - [`server/api/initiate-privileged.js`](../server/api/initiate-privileged.js)
  - [`server/api/generate-shipping-guide.js`](../server/api/generate-shipping-guide.js)
  - [`src/components/ShippingRateSelector/ShippingRateSelector.js`](../src/components/ShippingRateSelector/ShippingRateSelector.js)
  - [`src/util/carrierProhibitedCatalog.js`](../src/util/carrierProhibitedCatalog.js)
