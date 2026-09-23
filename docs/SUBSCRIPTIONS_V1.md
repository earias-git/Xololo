# SUBSCRIPTIONS V1 — Onboarding, cuenta y suscripción de sellers

> Fuente de verdad para el rediseño del signup/onboarding de sellers,
> la reorganización de "Configuración de cuenta", el repositorio de
> documentos legales, y el sistema de suscripción con cobro real.
> Complementa a `LOGISTICS_V1.md` y `DASHBOARDS_V1.md`.
>
> **Estado:** borrador de trabajo — decisiones tomadas 2026-09-22.
> Marcas: 🟢 decidido · 🟡 default propuesto (validar) · 🔴 pendiente definir.

---

## 0. TL;DR

Tres proyectos independientes, con dependencias entre sí:

| Track | Qué es | Riesgo | Depende de |
|-------|--------|--------|------------|
| **A** | Signup simplificado + fusión "Perfil"/"Cuenta" + reloj de progreso | Bajo (UI) | Nada — puede arrancar ya |
| **B** | Repositorio de documentos legales del seller | Medio (nuevo storage) | Lista de documentos confirmada |
| **C** | Suscripción + cobro de onboarding + gating de publicación | Alto (dinero real, Stripe nuevo) | Track A/B como prerequisito de UX |

---

## 1. Track A — Signup y cuenta

### 1.1. Signup simplificado 🟡

**Objetivo del usuario:** 5 campos — email, nombre completo, nombre
comercial, teléfono, password.

**Hallazgo importante:** la composición de campos del signup (cuáles
aparecen, cuáles son obligatorios) **no vive en este repositorio** —
la controla Sharetribe Console (Build → User fields, y Build → Tipos
de usuario → Signup settings de `displayName`/`phoneNumber`). El
código default de `SignupForm.js` ya sólo renderiza:

```
[selector de tipo de usuario, si hay más de uno]
email
nombre (fname) + apellido (lname)
nombre para mostrar (displayName)   ← controlado por Console
password
teléfono (phoneNumber)              ← controlado por Console
[campos custom adicionales configurados en Console]
```

Esto ya es muy cercano a los 5 campos pedidos. Si en producción se ve
más largo que esto, la causa más probable es:
- Un selector de tipo de usuario (Comprador/Vendedor) añadiendo un
  paso extra — 🔴 confirmar si Xololo tiene esto activo.
- Campos custom adicionales configurados en Console (¿bio? ¿dirección
  fiscal? ¿RFC?) — 🔴 pendiente que earias confirme qué ve exactamente
  en el signup real, o que revise Console → Build → User fields.
- `displayName`/`phoneNumber` con validaciones/copys que se sienten
  pesados aunque sean 1 sólo campo cada uno.

**Plan:**
1. earias confirma en Console cuáles campos custom extra están
   activos en signup y los desactiva/oculta si sobran (trabajo de
   Console, no de código).
2. Yo ajusto — vía código — todo lo que sí es código: labels/copys más
   cortos, agrupar nombre+apellido visualmente como "Nombre completo"
   si se prefiere, forzar `displayName` como el campo de "Nombre
   comercial" (label + placeholder + copy explicando qué es), y
   simplificar el flujo de tipo de usuario si aplica.
3. `nombre comercial` = el campo `displayName` ya existente
   (público, se muestra en el storefront) — no es necesario crear un
   campo nuevo, sólo relabelearlo/posicionarlo bien y asegurarnos que
   esté marcado `displayInSignUp: true, required: true` en Console.

### 1.2. Flujo post-verificación de email 🟢

Orden acordado, después de confirmar el email:

```
1. Detalles de pago (cómo recibe SUS ventas — StripePayoutPage/Connect)
2. Formas de pago (tarjetas guardadas del seller como buyer — PaymentMethodsPage)
3. Mi tienda (branding, slug, dirección de origen — ManageStorePage)
4. [NUEVO] Suscripción (Track C)
5. [NUEVO] Documentos legales (Track B)
6. Gestionar cuenta (cancelar cuenta) — AL FINAL, ya no arriba
```

**Nota:** hoy el orden en `ACCOUNT_SETTINGS_PAGES` (routeConfiguration.js)
es `ContactDetails, PasswordChange, StripePayout, PaymentMethods,
ManageStore, ManageAccount`. Se reordena a lo de arriba + 2 pasos
nuevos, y se agrega detección de "onboarding incompleto" para dirigir
al seller nuevo por este flow en su primer login (no forzar a un
seller ya establecido a repetirlo).

### 1.3. Fusión "Configuración de perfil" con "Configuración de cuenta" 🟢

**Hallazgo:** no hay duplicación de CAMPOS — `ProfileSettingsPage`
(displayName, foto, nombre, apellido, bio) y `ContactDetailsPage`
(email, teléfono, password) tienen campos distintos. La duplicación
es de **navegación**: aparecen como 2 entradas separadas en el
dropdown del Topbar (`TopbarDesktop.profileSettingsLink` +
`AccountSettingsPage`), lo cual es confuso para un seller MiPyME que
piensa en "mi cuenta" como una sola cosa.

**Plan:** fusionar en una sola entrada de menú → "Mi cuenta", que
lleva al primer paso del flow de cuenta (`ContactDetailsPage`), y
`ProfileSettingsPage` se convierte en UN PASO MÁS dentro del wizard de
cuenta (junto a Datos de contacto, Mi tienda, etc.) en vez de un botón
de nivel superior separado. Se quita `TopbarDesktop.profileSettingsLink`
del dropdown; su contenido se mueve a un tab dentro de la navegación
de `ACCOUNT_SETTINGS_PAGES` (`UserNav`).

### 1.4. Reloj / indicador de progreso 🟢

Se agrega un componente de progreso (ej. "3 de 6 pasos completos")
visible en la pantalla de Configuración de Cuenta, calculado a partir
de: contacto completo, Stripe Connect conectado, tarjeta de pago
guardada (opcional), tienda configurada (slug + branding + dirección
origen), suscripción activa, documentos legales subidos/aprobados.
Barra de progreso + checklist con links directos a cada paso pendiente.

---

## 2. Track B — Documentos legales del seller

### 2.1. Qué se pide 🟡 (confirmar lista exacta)

Documentos default propuestos (México, persona física/moral vendiendo
en marketplace + requisitos típicos de Stripe Connect):

- **Identificación oficial** (INE o pasaporte) — Stripe también lo
  pide directo en su propio onboarding de Connect, pero puede
  pedirse aparte como respaldo.
- **Comprobante de domicilio** (recibo de luz/agua/teléfono, <3 meses).
- **RFC / Constancia de situación fiscal** (SAT).
- **Comprobante de cuenta bancaria** (CLABE) — Stripe normalmente lo
  captura directo en su flujo de Connect, no como archivo.
- 🔴 earias confirma si hay algo adicional específico de Xololo (ej.
  carta de antecedentes no penales, permiso municipal, etc.)

### 2.2. Storage 🟢

Mismo patrón que las fotos SOS (`server/api/upload-sos-photo.js`):
Cloudflare R2, path `sellers/{sellerId}/legal/{docType}.{ext}`, subida
vía multipart, URLs guardadas en
`user.attributes.profile.metadata.xololoLegalDocs` (recordar: en User,
metadata vive anidado bajo `profile` — bug real que ya encontramos
hoy con `xololoStoreAnalytics`).

```json
{
  "ine": { "url": "...", "uploadedAt": "...", "status": "pending|approved|rejected" },
  "comprobanteDomicilio": { ... },
  "rfc": { ... }
}
```

### 2.3. Revisión 🟡

- v1: earias revisa manualmente desde `/admin` (nueva sub-sección
  "Documentos legales" con status pending/approved/rejected por
  seller) — sin automatización de verificación.
- v2: posible integración con servicio de verificación de identidad
  (Stripe Identity, Metamap, etc.) si el volumen lo justifica.

---

## 3. Track C — Suscripción y cobro

### 3.1. Planes 🟢

| Plan | Precio | Cobro | Renovación |
|------|--------|-------|------------|
| **Anual** | $2,028 MXN (IVA incluido) | Un solo cargo al inscribirse | 🟡 se propone auto-renovación anual vía Stripe Subscription (interval=year) — mismo monto se vuelve a cobrar automáticamente cada aniversario, salvo que el seller cancele antes. **Confirmar con earias.** |
| **Mensual** | $229 MXN/mes (IVA incluido) | Cargo automático recurrente | Cancelable cuando quiera, efectivo al fin del período ya pagado |

El "$169/mes" que aparece en marketing es sólo comparativo (para
mostrar el ahorro del plan anual) — **no es una unidad de cobro real.**

### 3.2. Onboarding fee 🟢

- $499 MXN (IVA incluido), **se cobra una sola vez**, junto con el
  primer pago de cualquiera de los 2 planes (mismo checkout).
- Cubre hasta 3 horas de asesoría con un consultor Xololo.
- Técnicamente: Stripe permite agregar un "invoice item" de una sola
  vez a la primera factura de una subscription — se hace exactamente
  así, un solo Checkout Session que crea la Subscription + agrega el
  item de $499 a la primera invoice.

### 3.3. Gating de publicación 🟢

- El seller **puede configurar** su tienda/productos en todo momento
  (edición, preview) sin restricción — su propia vista autenticada
  (`ManageListingsPage`, `EditListingPage`, preview de su storefront)
  nunca se bloquea.
- **Sin suscripción activa y pagada**, los listings **NO aparecen**:
  - En el buscador/marketplace de xololo.mx (`SearchPage`).
  - En su storefront público (`{slug}.xololo.mx` — `StorefrontPage`),
    ni en `ListingPage` para un buyer que llegue por link directo.
- **Dunning (tarjeta fallida):** no se despublica de inmediato. Stripe
  Smart Retries reintenta el cobro automáticamente; en paralelo Xololo
  manda avisos al seller (email/push/whatsapp, mismo pipeline D.9) en
  cada intento fallido. Sólo después de N avisos / que Stripe marque
  la subscription como `unpaid`/`canceled` se aplica el gate real.
  - 🔴 confirmar cuántos avisos antes de bajar la publicación (propongo
    3: día 1, día 3, día 7 tras el primer fallo — alineado con el
    schedule default de Stripe Smart Retries).

### 3.4. Retroactividad 🔴 pendiente confirmar

Sin respuesta aún. Default propuesto: **sólo sellers nuevos** de aquí
en adelante — los que ya operan (Kike Pruebas, etc.) quedan exentos
por ahora, sin fecha límite definida todavía. **earias confirma.**

### 3.5. Arquitectura técnica 🟡

**Stripe: cuenta separada de la de Connect.** El template ya integra
Stripe Connect (pagos marketplace, gestionado por Sharetribe backend —
no requiere secret key propio en este repo). La suscripción es un
producto DISTINTO: Xololo cobra directo a sus sellers usando **su
propia cuenta Stripe** (Stripe Billing), con:

- `STRIPE_SECRET_KEY` nuevo (env var, cuenta Xololo — nunca la misma
  que la de Connect).
- 2 Products/Prices en Stripe: `xololo-plan-anual` ($2028/año),
  `xololo-plan-mensual` ($229/mes).
- 1 Price adicional para el onboarding ($499, one-time, se agrega
  como invoice item en la primera factura).
- Checkout Session con `mode: 'subscription'` + `line_items` (price
  del plan elegido) + `invoice_creation` con el item de onboarding.
- Webhook nuevo `server/api/webhooks/stripe-billing.js` escuchando:
  `checkout.session.completed` (activar suscripción),
  `invoice.payment_failed` (disparar aviso al seller),
  `customer.subscription.updated` (sync de status: active/past_due/
  unpaid/canceled → aplicar o quitar el gate).
- Estado de suscripción persistido en
  `user.attributes.profile.metadata.xololoSubscription`:
  ```json
  {
    "plan": "annual" | "monthly",
    "status": "active" | "past_due" | "canceled" | "none",
    "stripeCustomerId": "...",
    "stripeSubscriptionId": "...",
    "currentPeriodEnd": "ISO",
    "onboardingFeePaid": true,
    "warningsSent": 0,
    "lastWarningAt": null
  }
  ```
- Enforcement del gate: en `SearchPage`/`StorefrontPage`/`ListingPage`
  (rutas públicas), filtrar/ocultar listings cuyo autor tenga
  `xololoSubscription.status !== 'active'`. Implementación concreta a
  definir (filtro server-side en los endpoints que alimentan estas
  vistas, ej. `seller-by-slug.js`, `featured-stores.js`, y un nuevo
  chequeo en el fetch de listings del buscador).

### 3.6. Notificaciones nuevas (pipeline D.9 existente) 🟡

- `seller.subscription_started` — confirmación de alta.
- `seller.payment_failed_warning` — cada intento fallido (hasta N).
- `seller.subscription_suspended` — al aplicar el gate.
- `seller.subscription_canceled` — cancelación voluntaria.

---

## 4. Roadmap propuesto

| # | Entrega | Track | Depende de |
|---|---------|-------|------------|
| 1 | Fusión nav Perfil/Cuenta + reloj de progreso | A | Nada |
| 2 | Ajustes de copy/labels en signup (lo que sí es código) | A | Confirmación de earias sobre campos reales vistos |
| 3 | Repositorio de documentos legales (upload + admin review) | B | Lista de documentos confirmada |
| 4 | Stripe Billing: products/prices + checkout de suscripción | C | Respuestas §3.4 y confirmación de auto-renovación anual |
| 5 | Webhook Stripe + estado de suscripción + notificaciones | C | #4 |
| 6 | Gating de publicación en Search/Storefront/Listing | C | #5 |
| 7 | Dunning: avisos + suspensión automática tras N intentos | C | #6 |

---

## 5. Preguntas abiertas 🔴

1. **Auto-renovación del plan anual**: ¿el cargo de $2,028 se repite
   automáticamente cada año (Stripe Subscription interval=year), o es
   un acceso de 1 año que el seller debe renovar manualmente?
2. **Retroactividad**: ¿sellers existentes quedan exentos indefinida-
   mente, o se les da una fecha límite para suscribirse también?
3. **Campos reales del signup en producción**: earias — ¿qué ves
   exactamente hoy en `xololo.mx/signup`? (no pude verificarlo yo
   mismo — el sitio está detrás de Basic Auth y no debo escribir esa
   contraseña).
4. **Lista definitiva de documentos legales** — ¿la propuesta en §2.1
   es completa, o falta/sobra algo específico de Xololo?
5. **Número de avisos antes de suspender** por tarjeta fallida — ¿3
   está bien, o prefieres otro número/cadencia?

---

## 6. Cambios a este documento

- **2026-09-22:** creación inicial con las decisiones tomadas en
  conversación (planes, precios, cobro de onboarding, gating con
  dunning). Arquitectura Stripe Billing propuesta pendiente de
  confirmar auto-renovación anual y retroactividad.
