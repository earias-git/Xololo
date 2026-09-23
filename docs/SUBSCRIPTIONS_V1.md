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

**Estado: 🟢 implementado** (backend + UI seller + revisión admin +
paso en el reloj de avance). La lista de slots de abajo es la que
quedó cableada en `server/api-util/legalDocSlots.js` /
`src/config/legalDocSlots.js` — sigue sujeta al 🔴 de Facturama: si la
modalidad cambia, sólo hay que editar esos dos archivos (mismo slot
key en ambos) y el resto del flujo (upload, revisión, reloj) no
cambia.

### 2.1. Qué se pide 🟡

Decisión: pedir lo que exige el **SAT** según el tipo de persona
(física vs moral), **excluyendo** lo que Facturama vaya a solicitar
por su cuenta cuando se integre para timbrado CFDI (para no duplicar
captura). Facturama típicamente ya captura RFC + Constancia de
Situación Fiscal + (si el seller quiere auto-timbrar) sus propios
Certificados de Sello Digital — si Xololo timbra CENTRALIZADO con su
propio CSD a nombre de cada seller como emisor, Facturama sólo
necesita RFC + régimen fiscal + código postal fiscal, no certificados
del seller. 🔴 **Confirmar con earias qué modalidad de Facturama se va
a usar** (timbrado centralizado vs que cada seller conecte su propio
CSD) — esto decide si además hace falta pedir `.cer`/`.key` + password
del CSD como documento, o no.

**Lista propuesta (a reserva de la respuesta de arriba):**

**Persona física:**
- Identificación oficial (INE o pasaporte) — respaldo además del que
  pida Stripe Connect en su propio onboarding.
- Comprobante de domicilio (recibo de luz/agua/teléfono, <3 meses).
- RFC / Constancia de Situación Fiscal (SAT) — *omitir si Facturama ya
  lo captura en su propio flujo*.
- CURP (si no viene incluida en la Constancia de Situación Fiscal).

**Persona moral (empresa):**
- Acta constitutiva.
- Poder notarial del representante legal.
- Identificación oficial del representante legal.
- RFC de la empresa / Constancia de Situación Fiscal — *mismo caso,
  omitir si lo captura Facturama*.
- Comprobante de domicilio fiscal.

- 🔴 earias confirma si falta/sobra algo específico de Xololo (ej.
  permiso municipal, carta de antecedentes no penales, etc.)

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
| **Anual** | $2,028 MXN (IVA incluido) | Un solo cargo al inscribirse | 🟢 Se auto-renueva cada año (Stripe Subscription, interval=year) — mismo monto se vuelve a cobrar automáticamente en el aniversario, salvo que el seller pause antes. |
| **Mensual** | $229 MXN/mes (IVA incluido) | Cargo automático recurrente | Se auto-renueva cada mes, mismo mecanismo de pausa |

El "$169/mes" que aparece en marketing es sólo comparativo (para
mostrar el ahorro del plan anual) — **no es una unidad de cobro real.**

### 3.1.1. Avisos de renovación 🟢

Ambos planes se auto-renuevan. Antes de cada renovación (mensual o
anual) se le avisa al seller en una cadencia fija — vía email + push
(mismo pipeline D.9):

- **30 días antes**
- **15 días antes**
- **3 días antes**
- **1 día antes**

Cada aviso incluye el monto que se cobrará y un link directo a
"Pausar mi cuenta" (§3.1.2) por si no desea continuar. Implementación:
job diario (similar a `tacit-acceptance.js` / `monthly-report.js`) que
recorre suscripciones activas, calcula días hasta
`currentPeriodEnd`, y dispara el evento correspondiente si hoy matchea
uno de los 4 hitos (idempotente: un flag `remindersSent: [30,15,3,1]`
en el metadata de la suscripción evita reenvíos si el job corre más
de una vez el mismo día).

### 3.1.2. Pausar cuenta (no cancelar) 🟢

Acción nueva y **distinta** de "Eliminar cuenta" (que ya existe en
`ManageAccountPage` y borra todo permanentemente). "Pausar" vive
dentro de la nueva sección Suscripción:

- El seller marca "Pausar mi cuenta" (o simplemente no responde a los
  avisos de renovación y deja que se cumpla el período).
- Técnicamente: `stripe.subscriptions.update(id, { cancel_at_period_end: true })`
  — Stripe NO vuelve a cobrar en el próximo aniversario; la suscripción
  sigue activa (y los listings siguen publicados) hasta
  `currentPeriodEnd`, momento en que Stripe la cierra sola
  (`customer.subscription.deleted`) y ahí se aplica el gate.
- El seller puede "despausar" (deshacer `cancel_at_period_end`) en
  cualquier momento ANTES de que llegue esa fecha, sin re-onboarding
  ni re-cobro de los $499 (el onboarding fee es una sola vez de por
  vida, no por período).
- Después de pausada/vencida, el seller puede reactivar suscribiéndose
  de nuevo — eso sí dispara un nuevo checkout (pero SIN el cargo de
  onboarding otra vez, ver arriba).

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

### 3.4. Retroactividad 🟢

No aplica: los sellers actuales (Kike Pruebas, etc.) son **cuentas de
prueba** que se van a borrar más adelante antes de lanzar en real, no
sellers reales a los que haya que dar de alta retroactivamente. No se
construye lógica de migración/retroactividad — el sistema de
suscripción aplica desde cero a cada seller que se registre a partir
de que esto se lance.

**Nota de seguridad:** esta sesión NO va a borrar ninguna cuenta o
dato existente por su cuenta — el borrado de las cuentas de prueba
es una acción destructiva que earias hará cuando decida, no algo
que se dispare como parte de este trabajo.

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
| 8 | Avisos de renovación (30/15/3/1 días) — job diario | C | #5 |
| 9 | "Pausar mi cuenta" (cancel_at_period_end) + reactivación | C | #5 |

---

## 5. Preguntas abiertas 🔴

Resueltas: auto-renovación (§3.1, sí ambos planes) y retroactividad
(§3.4, no aplica — sellers actuales son de prueba). Quedan:

1. **Campos reales del signup en producción**: earias — ¿qué ves
   exactamente hoy en `xololo.mx/signup`? (no pude verificarlo yo
   mismo — el sitio está detrás de Basic Auth y no debo escribir esa
   contraseña).
2. **Modalidad de Facturama** (§2.1): ¿timbrado centralizado con CSD
   de Xololo, o cada seller conecta su propio CSD? Decide si hace
   falta pedir certificados `.cer`/`.key` como documento legal o no.
3. **Lista definitiva de documentos legales** — ¿la propuesta en §2.1
   es completa, o falta/sobra algo específico de Xololo?
4. **Número/cadencia de avisos antes de suspender por tarjeta
   fallida** (dunning, distinto de los avisos de renovación de
   §3.1.1) — propuesta default: 3 avisos, alineados a los reintentos
   de Stripe Smart Retries (~día 1, día 3, día 7 tras el primer
   fallo). ¿Está bien, o prefieres otra cadencia?

---

## 6. Cambios a este documento

- **2026-09-22:** creación inicial con las decisiones tomadas en
  conversación (planes, precios, cobro de onboarding, gating con
  dunning). Arquitectura Stripe Billing propuesta pendiente de
  confirmar auto-renovación anual y retroactividad.
- **2026-09-22 (cont.):** confirmado auto-renovación (ambos planes) +
  cadencia de avisos de renovación (30/15/3/1 días) + concepto nuevo
  "pausar cuenta" (distinto de eliminar cuenta) + retroactividad
  resuelta (no aplica, sellers actuales son de prueba) + lista de
  documentos legales split por persona física/moral condicionada a
  la modalidad de integración con Facturama (pendiente confirmar).
