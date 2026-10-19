# SELLER CASUAL — Modelo fiscal y de producto para venta de segunda mano

> Fuente de verdad para el seller "casual" (particular que vende sus
> cosas usadas ocasionalmente) y para el tratamiento fiscal de artículos
> de segunda mano, independientemente de quién los venda.
> Complementa a `SUBSCRIPTIONS_V1.md` (track A/C de onboarding) y a la
> clasificación fiscal por listing (gate antifraude task #39).
>
> **Estado:** vivo — commits 2ef36a61..b082f3dfd (oct 2026).
> Marcas: 🟢 decidido/implementado · 🟡 implementado pero sujeto a
> validación con CP · 🔴 pendiente.

---

## 0. TL;DR

Xololo distingue **dos modos de operación del seller** y una **condición
por listing**. La combinación de ambos decide el tratamiento fiscal
real que se le aplica al bien y la UX que ve el usuario.

| Dimensión | Valores | Dónde vive |
|-----------|---------|-----------|
| `sellerMode` | `store` (default) · `casual_reseller` | `profile.publicData.sellerMode` |
| `personType` | `physical_business` · `individual` · `moral` | `profile.protectedData.xololoTaxProfile.personType` |
| `hasRfc` | `true` · `false` | `profile.protectedData.xololoTaxProfile.hasRfc` |
| `condition` (por listing) | `new` · `used` | `listing.publicData.condition` |
| `taxClassification` (opcional, por listing) | Art. 9/15/2-A o actividad 113-A | `listing.publicData.taxClassification` |

**Regla fiscal clave (apegada a lo legal, acordada con el usuario):**

> Un bien **usado** vendido por un **particular** (`condition='used' +
> personType='individual'`) **no causa IVA** (Art. 9 fracc. IV LIVA) y
> **no entra en LISR 113-A** porque no hay actividad empresarial.
> Cualquier otra combinación — nuevo, o usado por PF empresarial o PM —
> paga IVA y causa retención si aplica.

La **comisión Xololo** (serv. administrativos) sigue siendo del
producto, no del seller: una tabla **marginal** 9/6/3% por tramos de
precio del listing. Siempre causa IVA porque Xololo es contribuyente
del IVA aunque el bien vendido esté exento.

---

## 1. Modos de seller

### 1.1. `store` 🟢

El seller default. Tiene tienda (storefront público en `/u/:id`),
catálogo recurrente, puede vender nuevo y usado. Paga suscripción
mensual para mantener la tienda activa.

Checklist de onboarding bloqueante para publicar: `profile`,
`contact`, `payouts`, `store`, `subscription`. (Legal docs es
no-bloqueante — se piden para liberar el primer payout, no para
publicar; task #27.)

### 1.2. `casual_reseller` 🟢

Particular que vende sus cosas usadas ocasionalmente. **Sin
storefront**, **sin suscripción**, **sin catálogo de tienda**.
Conserva la protección Xololo del pago hasta recibir el producto y
los filtros antifraude.

Fiscal: Xololo lo trata como `personType='individual'` **por
definición** — es el único shape consistente con Art. 9 IV LIVA
("vendedor particular que vende sus propios bienes usados de forma
ocasional. Pierde la exención si es empresa o si lo hace de forma
habitual.").

Checklist de onboarding recortado: `profile`, `contact`, `payouts`,
`legalDocs`. **No** requiere `store` ni `subscription` para publicar
(`src/hooks/useOnboardingStatus.js`).

**Promesa de producto:**

- Publica sin pagar.
- Recibe el 100% del precio del bien usado, menos la comisión Xololo.
- Nunca va a /manage-store ni a /subscription (guards por URL directa
  en `ManageStorePage` y `SubscriptionPage` redirigen a `/account`).
- Perfil público `/u/:id` muestra una pill verde **"Vendedor casual"**
  en vez del branding de tienda.
- Al crear un listing, el form abre con `condition='used'`
  pre-seleccionado y el preview aplica Art. 9 IV LIVA desde el primer
  tecleo.

**Riesgo residual (del seller, no de Xololo):** si vende
habitualmente, el SAT puede reclasificarlo como empresario y
exigirle RFC + declaraciones. El form del perfil fiscal se lo
advierte explícitamente al marcar el modo.

### 1.3. Dualidad legal: segunda mano NO es exclusiva del casual

Un seller `store` puede listar artículos usados también. En ese caso
el régimen fiscal depende de su `personType`:

| sellerMode | personType | condition | Resultado fiscal |
|------------|-----------|-----------|------------------|
| casual_reseller | individual (forzado) | used | **Exento Art. 9 IV** |
| store | individual | used | **Exento Art. 9 IV** |
| store | physical_business | used | **Gravado 16% + ISR 113-A** |
| store | moral | used | **Gravado 16% + ISR Xololo no retiene** |
| cualquiera | cualquiera | new | Tratamiento normal del producto |

El preview emite una **nota educativa** (`getUsedGoodsNotice`) que
explica *por qué* en cada caso (`src/util/xololoSellerMode.js`).

---

## 2. Perfil fiscal del seller

### 2.1. Shape persistido 🟢

```js
// profile.protectedData.xololoTaxProfile
{
  personType: 'individual' | 'physical_business' | 'moral',
  hasRfc: boolean,
  declaredAt: ISO string,     // firma bajo protesta de decir verdad
}
```

- Se declara una sola vez en Account Settings con el `TaxProfileForm`
  (`src/containers/ManageAccountPage/TaxProfileForm/`).
- Default conservador cuando el seller aún no declaró:
  `DEFAULT_TAX_PROFILE` = `{personType: physical_business, hasRfc: true}`
  — se le retiene algo al seller en lugar de prometer de más y luego
  sacar el billete.
- Al elegir modo `casual_reseller`, el formulario fuerza
  `personType=individual` + `hasRfc=false` y oculta el radio de
  `personType` (es irrelevante).

### 2.2. Interpretación legal estricta 🟡

Los tres `personType`:

- **`individual`** — particular ocasional (Art. 9 IV LIVA). **NO** es
  contribuyente LISR 113-A. No se le retiene ISR por plataforma. Sí
  se le retiene IVA si vende producto gravado.
- **`physical_business`** — PF con actividad empresarial (RESICO o
  Régimen General). Aplica tabla **LISR 113-A** por actividad:
  1% enajenación/servicios (default), 2.1% transporte, 4% hospedaje.
  Sin RFC → 20% ISR + 16% IVA (100% del causado).
- **`moral`** — SA/SAPI/SC/AC. LISR 113-A **no aplica** hoy (es
  régimen de personas físicas). Reforma LIF 2026 agregará ISR 4% +
  IVA 8%; pendiente modelar cuando entre.

Pruebas: `src/util/xololoPayout.test.js` cubre las 5 combinaciones
de retención ISR y la retención IVA.

---

## 3. Clasificación fiscal por listing (gate antifraude #39)

Independiente de los modos del seller: cualquier listing puede
declarar un régimen fiscal **especial** (Art. 9/15/2-A LIVA o
actividad 113-A distinta) desde el `TaxClassificationField` del form
de Pricing. 13 clasificaciones agrupadas:

| Grupo | Códigos |
|-------|---------|
| Exentos LIVA Art. 9 (bienes) | `exento_9_iv`, `exento_9_iii` |
| Tasa 0% LIVA Art. 2-A (bienes) | `tasa_cero_2a_i_a/b/d/f/i/j` |
| Exentos LIVA Art. 15 (servicios) | `exento_15_iv/xiv/xvi` |
| Actividad distinta LISR 113-A | `actividad_transporte`, `actividad_hospedaje` |

**Shape persistido** en `listing.publicData.taxClassification`:

```js
{
  code: 'exento_9_iv',
  declaredAt: ISO string,       // firma del seller
  reviewStatus: 'pending' | 'approved' | 'rejected',
  reviewedBy: string | null,    // operator@xololo.mx
  reviewedAt: ISO string | null,
  reviewNote: string | null,
}
```

**Gate antifraude:** `resolveTaxOverride` sólo devuelve el override
real cuando `reviewStatus === 'approved'`. Mientras tanto el motor
de cobro usa el default conservador (16% + enajenación), pero el
preview puede mostrar al seller cómo quedaría si fuera aprobado —
sólo educativo, no se cobra así.

**Cola de revisión** en `/ops/tax-reviews` (`TaxReviewsView` del
OpsConsolePage). Endpoints:

- `GET /api/admin/tax-reviews` — lista los listings pendientes +
  rechazados (incluye seller, email y catálogo legal).
- `POST /api/admin/tax-reviews/review` — aprueba o rechaza con nota.

Cache 2 min en el list. Pasa por `requireAdmin` como el resto de
endpoints `/api/admin/*`.

### 3.1. Precedencia de override en el preview 🟢

El form evalúa en este orden y le pasa al preview sólo UNO:

1. **Manual, aprobado** — `taxClassification.code` con
   `reviewStatus='approved'` → aplica el override declarado.
2. **Automático (usado + particular)** — si no hay manual aprobado
   pero `condition='used'` + `personType='individual'`, aplica
   `EXENTO_9_IV` por `resolveUsedGoodsOverride`. No requiere revisión
   humana porque la combinación es verificable (perfil firmado +
   checkbox del form).
3. **Default de la categoría** — `getTaxDefaultsForCategory` en
   `src/util/xololoTaxCategories.js`.

Para el preview "en vivo" (educativo) mientras el seller teclea, el
form también muestra el override manual **sin esperar la revisión**
— pero el motor de cobro real sigue respetando el gate.

---

## 4. Comisión Xololo — tramos marginales

### 4.1. Definición 🟢

Por **precio del listing**, no por seller. Un mismo seller puede
tener listings cayendo en distintos niveles.

| Tramo del precio | Tasa marginal |
|------------------|---------------|
| Primeros $50,000 | 9% |
| Siguientes $50,000 (hasta $100,000) | 6% |
| Excedente sobre $100,000 | 3% |

La base se calcula como escalonado marginal (cada porción del precio
dentro de un tramo paga la tasa de ese tramo, como ISR). Al cargo se
le suma IVA 16% porque Xololo es contribuyente de IVA aunque el bien
vendido esté exento.

**Expuesto como:** `COMMISSION_TIERS` y `computeMarginalCommission`
en `src/util/xololoPayout.js`. El breakdown por tramo se incluye en
el retorno de `computePayoutBreakdown` como `xololoAdminBreakdown` +
`xololoAdminEffectivePct`, listo para educar al seller si el preview
lo quiere renderizar.

### 4.2. Tabla rápida de tasa efectiva

| Precio del listing | Base (sin IVA) | + IVA | Efectiva |
|---|---|---|---|
| $500 | $45.00 | $52.20 | 9.00% |
| $25,000 | $2,250 | $2,610 | 9.00% |
| $75,000 | $6,000 | $6,960 | **8.00%** |
| $150,000 | $9,000 | $10,440 | **6.00%** |
| $350,000 | $15,000 | $17,400 | **4.29%** |
| $1,000,000 | $34,500 | $40,020 | **3.45%** |

### 4.3. Rationale 🟢

- **Plana por tramos** (versión anterior, retirada) producía un
  salto absurdo en la frontera: $50,001 pagaba menos total que
  $50,000. Marginal elimina el salto: subir el precio **siempre**
  sube la comisión en pesos.
- La curva baja al subir el ticket para que Xololo capture valor en
  ventas chicas sin ser prohibitivo en tickets altos.
- La asíntota es 3%, no 0% — el servicio administrativo tiene un
  costo marginal real por transacción (Facturapi, soporte,
  antifraude).

### 4.4. Comisión Xololo con bien exento 🟡

Validado con el usuario (2026-10-19): aunque el bien vendido quede
exento por Art. 9 IV LIVA (particular + usado), la comisión Xololo
sigue causando IVA 16%. Xololo es contribuyente de IVA facturando
un servicio propio; emite CFDI con IVA desglosado al seller
particular (que no puede acreditarlo pero es el tratamiento legal
correcto). Esto cuadra con el modelo de factura simplificada que
cualquier proveedor emite a un consumidor final.

---

## 5. Flujo end-to-end del seller casual

### 5.1. Signup 🟢

Nueva pregunta "¿Cómo vas a usar Xololo?" con 3 opciones:

1. "Elijo más tarde" — sellerMode queda en default (`store`).
2. "Voy a vender como negocio" — `sellerMode=store`.
3. "Sólo quiero vender mis cosas usadas ocasionalmente" —
   `sellerMode=casual_reseller`, el handler pre-firma
   `xololoTaxProfile = {personType: individual, hasRfc: false,
   declaredAt: now}`.

Implementado en `SignupForm.js` + `AuthenticationPage.helpers.js`.
Tests en `AuthenticationPage.helpers.test.js`.

### 5.2. Primer listing 🟢

- `RequireSellerOnboarding` no lo redirige (no exige subscription ni
  store).
- Form de Pricing abre con `condition='used'` pre-seleccionado.
- Preview aplica Art. 9 IV LIVA en vivo: IVA $0, ret ISR $0, sólo
  comisión Xololo.

### 5.3. Visibilidad 🟢

- Account Settings nav: sin tabs "Mi tienda" ni "Suscripción".
- URL directa: `/manage-store` y `/subscription` redirigen a
  `/account`.
- Perfil público `/u/:id`: pill verde "Vendedor casual" + explicación.

### 5.3b. Documentos legales recortados 🟢

Para el casual, el catálogo de `/account/legal-docs` sólo pide 3
subidas:

- **Identificación oficial — frente** (INE o pasaporte).
- **Identificación oficial — reverso** (código QR/firma).
- **Comprobante de domicilio** — localización en caso de dispute.

La INE se pide en dos lados porque el reverso tiene el QR/CIC que
permite validación oficial del documento ante el INE; para
seguridad razonable, antifraude pide ambas caras.

Se omiten explícitamente:

- **Constancia de Situación Fiscal (SAT)** — el casual tiene
  `hasRfc=false` por definición (Art. 9 IV LIVA requiere ausencia
  de actividad empresarial); no puede entregar la constancia.
- **CURP** — ya aparece en la identificación oficial; pedirla por
  separado es fricción sin valor.

Implementación: `casualOk: false` en los slots omitidos (ver
`src/config/legalDocSlots.js` y su mirror en server). El filtro
`slotsForPersonType(personType, sellerMode)` las excluye cuando
`sellerMode='casual_reseller'`.

El picker inicial "Persona física / Persona moral" se salta para el
casual: `useEffect` auto-fija `personType='fisica'` al cargar la
página porque el casual es particular por definición.

Impacto en Xololo Verified: `sellerVerified.computeVerifiedFromUser`
también acepta sellerMode. Para casual se omite el criterio de
suscripción activa y el requisito de slug — basta con payouts
configurados + nombre + los dos docs aprobados.

### 5.4. Preview para un bien usado $1,500 por particular

```
Subtotal (sin IVA)                              $1,500.00
IVA Exento (Art. 9 IV LIVA)                         $0.00
────────────────────────────────────────────────────────
Precio total del producto                       $1,500.00
− Motor de cobro (3.6% + IVA)                    −$62.64
− Serv admin Xololo (9% + IVA · marginal)       −$156.60
− Retención ISR (particular, no 113-A)              $0.00
− Retención IVA (bien exento)                       $0.00
────────────────────────────────────────────────────────
Seller recibe                                   $1,280.76
```

---

## 6. Cobertura de tests

| Archivo | Casos | Qué protege |
|---------|------:|-------------|
| `xololoPayout.test.js` | 20 | Tabla marginal (sin cliff, asíntota 3%). IVA GRAVADO/EXENTO/TASA_CERO. Retención ISR 0/1/2.1/4/20% según personType × hasRfc × actividad. Gate `applyWithholdings`. |
| `xololoSellerMode.test.js` | 15 | `resolveUsedGoodsOverride` sólo activa Art. 9 IV con USED+INDIVIDUAL; `getUsedGoodsNotice` emite kind correcto. |
| `xololoTaxProfile.test.js` | 7 | Default conservador PF empresarial + hasRfc. Hidratación parcial, timestamps ISO. |
| `xololoTaxClassification.test.js` | 7 | Catálogo bien formado. `CLASSIFICATION_GROUPS` cubre cada código exactamente una vez. `resolveTaxOverride` sólo pasa con `approved`. |
| `AuthenticationPage.helpers.test.js` | 5 | Signup NO añade data casual sin pedirla; SÍ persiste `publicData.sellerMode` + perfil fiscal particular firmado cuando casual. |
| `legalDocSlots.test.js` | 7 | Catálogo store/casual: casual sólo pide INE + comprobante; constancia + CURP se excluyen; moral+casual (improbable) sigue entregando docs de PM. |

**Total: 61 tests pasando** (`yarn test`).

---

## 7. Pendientes conocidos 🔴

- **Checkout del buyer** no respeta `publicData.condition` +
  `publicData.taxClassification` + `seller.sellerMode` al cobrar
  real — hoy sólo el preview del seller lo refleja. Hay que llevarlo
  al motor de cobro cuando llegue Facturapi (task #16).
- **Reforma LIF 2026** para persona moral: cuando entre, PM pasa a
  ISR 4% + IVA 8% retenidos por plataforma. Pendiente modelar.
- **Guard de reclasificación** del casual: si el seller publica más
  de N listings en un período, mostrar aviso para migrarlo a
  `physical_business`. Hoy sólo advertimos en el form.
- **Tests de `useOnboardingStatus` casual** y de los guards de
  `ManageStorePage`/`SubscriptionPage` con React Testing Library.
- **Tests de endpoints** `/api/admin/tax-reviews` (list + review)
  con mock del Integration SDK.

---

## 8. Changelog

- **2026-10-19 (b082f3dfd)** — 54 tests cubriendo el stack fiscal.
- **2026-10-19 (5bcbb4c34)** — Fase 2b: signup diferenciado, guards
  URL, badge público.
- **2026-10-19 (51c544b71)** — Fase 2 producto: bypass suscripción,
  nav depurado, `condition='used'` default para casual.
- **2026-10-19 (e436ae8a2)** — Comisión Xololo con tramos marginales.
- **2026-10-19 (e575903ff)** — Comisión por tramos de precio
  (no por seller).
- **2026-10-19 (9d1f20607)** — Modo seller casual + Art. 9 IV LIVA
  automático para usado + particular.
- **2026-10-18 (eb1469bcb)** — `/ops/tax-reviews` para revisar
  clasificaciones pendientes.
- **2026-10-18 (3f093a004)** — Perfil fiscal del seller en Settings.
- **2026-10-18 (366d2bc8c)** — Clasificación fiscal especial por
  listing (gate antifraude #39).
