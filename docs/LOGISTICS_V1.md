# Xololo — Política logística v1

Fecha de aprobación: 2026-09-19
Estado: aprobado por producto, pendiente de revisión legal.

Este documento captura las decisiones operativas y comerciales que
gobiernan el bloque de envíos, pagos por entrega, disputas y
notificaciones en Xololo. Cada sección incluye:

- **Política**: la regla de negocio como debe entenderse por producto,
  operaciones, marketing y legal.
- **Implementación**: cómo se aterriza en código / infraestructura.
- **Comunicación**: qué mensajes debe ver el buyer, el seller y el
  público en marketing.

Cualquier cambio a este documento requiere aprobación explícita de
producto + operaciones. El código debe reflejar SIEMPRE lo que está
escrito aquí.

---

## 1. Domicilios del seller

### Política

Todo seller requiere **tres domicilios** al onboardear su tienda,
capturados en el orden siguiente:

1. **Domicilio legal** — debe coincidir con la constancia de
   situación fiscal del SAT. Se usa para facturación electrónica y
   comprobantes fiscales digitales por Internet (CFDI).
2. **Domicilio comercial** — dirección física donde opera la tienda
   frente al público. Se muestra en el storefront (footer + botón
   "Ver ubicación en Google Maps"). Puede ser el mismo que el legal.
3. **Domicilio de recolección** — dirección donde el courier
   (Skydropx) pasa a recoger los paquetes. Debe incluir un campo
   adicional **"Referencias para el chofer"** con indicaciones
   específicas (portón, timbre, horario, etc.).

### UX

- Los 3 se capturan en `/account/store` como secciones sucesivas
  bajo el bloque "Datos legales y ubicación".
- Sobre "Domicilio comercial" y "Domicilio de recolección" hay un
  checkbox individual "✓ Usar el mismo que el legal" que
  auto-rellena todos los campos en cascada al marcarse.
- El campo "Referencias para el chofer" (textarea 2 líneas) es
  obligatorio dentro del bloque de recolección.
- Cada dirección captura: calle y número, colonia, código postal,
  ciudad / municipio, estado.

### Implementación

- Rename del campo actual `address` en `publicData` → `legalAddress`
  (migración one-shot vía Integration API).
- Nuevos campos en `publicData`:
  `commercialAddress`, `pickupAddress`, `pickupReferences`.
- Al llamar a Skydropx para crear guía, se envía como origen la
  dirección de **recolección** (no la legal ni la comercial).

---

## 2. Timeline de estados de la orden

### Política

El buyer y el seller ven una línea del tiempo con **8 estados**
que refleja el ciclo completo de vida del pedido, alineado con las
mejores prácticas de logística moderna:

1. **Pago confirmado** — Stripe cobró exitosamente.
2. **Proveedor preparando** — el seller confirmó que empezó a empacar.
3. **Guía generada** — Skydropx emitió la etiqueta y el seller la
   imprimió.
4. **Recolectado** — el courier recogió físicamente el paquete.
5. **En tránsito** — el paquete circula por la red del courier.
6. **En reparto** — el chofer local salió con la ruta del día.
7. **Entregado** — comprobante de entrega (POD) confirmado.
8. **Encuesta abierta** — post-entrega, dentro de la ventana de 48h
   para responder o dejar afirmativa ficta.

### UX

- **Desktop**: los 8 estados se ven expandidos por default, con
  fecha/hora + detalle debajo de cada uno.
- **Mobile**: los primeros 3 estados relevantes se ven expandidos,
  el resto está colapsado con "Ver detalle" para evitar saturación.
- Codificación visual estándar: verde ✓ = completado, azul ● = en
  curso, gris ○ = pendiente.
- Cada estado muestra: nombre, timestamp, sub-detalle (ej. ciudad
  donde ocurrió), y en algunos casos una acción CTA (ej. "Reportar
  problema" en Entregado).

### Implementación

- Componente `OrderTimeline` reusable, alimentado por:
  - transiciones de Sharetribe (`transaction.attributes.transitions`)
  - eventos de Skydropx recibidos por webhook y persistidos en
    `transaction.protectedData.xololoShipping.trackingEvents`
- Se muestra en `OrderDetailsPage` (buyer) y `TransactionPage`
  (seller).

---

## 3. Disputas de entrega ("courier dice entregado, buyer dice no")

### Política

Cuando el POD del courier marca "Entregado", el buyer tiene
**48 horas** para reportar "No recibí mi paquete":

- Si **NO reporta** en 48h → **afirmativa ficta**: los fondos se
  liberan automáticamente al seller. La transacción registra
  `acceptance: 'tacit'` con timestamp como evidencia.
- Si **reporta** dentro de las 48h → los fondos se **congelan** y
  Xololo abre un caso de disputa que debe resolverse en <72h con
  base en:
  - POD del courier (foto, firma, geolocalización)
  - Fotos SOS del seller (producto, embalaje, guía)
  - Comunicación entre partes en el chat interno
  - Historial de disputas del buyer y del seller
- Resolución posible:
  1. **A favor del buyer**: refund total desde los fondos
     congelados. Seller no cobra. Marca en el historial del seller.
  2. **A favor del seller**: fondos se liberan. Marca en el
     historial del buyer.
  3. **50/50**: refund parcial. Solo en casos ambiguos con
     evidencia mixta.

### Comunicación

- Buyer al ser marcado entregado: notificación push + email + WA
  con CTA "¿Recibiste tu paquete? Todo bien / Reportar problema".
- Seller al abrirse disputa: notificación push + email + WA con
  "Un buyer reportó no haber recibido tu pedido — tenemos 72h para
  resolver, revisa tu evidencia".
- Xololo internamente: dashboard de disputas abiertas con
  triage por antigüedad + valor + historial.

### Implementación

- Nueva transacción state: `awaiting-review` post-entrega.
- Cron cada hora: si `awaiting-review > 48h` → transición
  automática `transition/complete` con
  `metadata.acceptanceProof = { type: 'tacit', deliveredAt, expiresAt }`.
- Endpoint `POST /api/orders/:id/report-not-received` que
  transiciona a `disputed`, congela el payout Stripe y notifica.

---

## 4. Encuesta post-entrega

### Política

Al entregarse (o al accionar "Todo bien" el buyer), se abre una
encuesta corta con:

- Botón **"Todo bien"** — un click confirma recibido conforme.
- **Estrellas 1-5** — rating al vendedor.
- **Comentario opcional** — caja de texto libre, hasta 500
  caracteres. Alimenta las reseñas públicas del storefront.

Si el buyer marca **"Algo mal"** en lugar de "Todo bien", se abre
automáticamente disputa (ver sección 3): fondos congelados, se
solicita evidencia (fotos, video del producto), se notifica al
seller y Xololo revisa en <72h.

Si el buyer no responde en 48h → afirmativa ficta libera los fondos.

### Comunicación

- Términos y condiciones deben incluir explícitamente:

  > *"Al no responder la encuesta de satisfacción dentro de las 48
  > horas posteriores a la entrega confirmada, el comprador acepta
  > implícitamente el producto o servicio como conforme, liberando
  > los fondos al vendedor. Esta aceptación tácita constituye
  > evidencia contractual válida para efectos de disputas ante
  > procesadores de pago (incluyendo Stripe) o autoridades."*

- Correo de encuesta a las 0h + push a las 12h + WA a las 36h como
  recordatorios antes del corte de las 48h.

### Implementación

- Widget `PostDeliverySurvey` en `OrderDetailsPage` del buyer.
- Reseñas se guardan en `transaction.publicData.buyerReview` y
  agregadas al `storefront.reviews` del seller.
- El "contrato de aceptación" se persiste en
  `transaction.metadata.acceptanceProof` como snapshot
  cifrable/exportable para Stripe Evidence API.

---

## 5. SOS Protección obligatorio

### Política

**Todos** los envíos por paquetería llevan **SOS Protección** de
Skydropx. No es opcional.

- Costo Skydropx: **$25 MXN fijo por envío**.
- Cobertura: **hasta $100,000 MXN por paquete** contra pérdida,
  daño, robo, accidente.
- Fórmula de precio al público:

  ```
  Precio final = (guía Skydropx + $25 SOS) × 1.14
  ```

  El 14% es el margen de utilidad de Xololo sobre el bruto
  Skydropx (guía + seguro).

**Ejemplo (Estafeta Terrestre CDMX → Xalapa, paquete 500g):**

| Concepto | Monto MXN |
|---|---|
| Guía Estafeta Terrestre | $144.13 |
| SOS Protección | $25.00 |
| Subtotal Skydropx | $169.13 |
| Utilidad Xololo (14%) | $23.68 |
| **Total al público** | **$192.81** |

### Quién paga

- **Buyer** por default: aparece como una sola línea en el
  breakdown del checkout ("Envío por [carrier]: $192.81 — incluye
  compra protegida hasta $100,000"). No se desglosan los $25 ni el
  14% al buyer, solo el precio final con el mensaje de valor.
- **Seller** si activa la promoción **"Envío incluido"** en su
  listing: absorbe el precio público completo ($192.81), Xololo
  sigue cobrando su 14%. El buyer ve "**Envío gratis 🎁 — incluye
  compra protegida**".

### Requisito para que el seguro aplique

El seller **debe subir 5 fotografías** en el flujo de fulfillment
antes de que se genere la guía. Los primeros 3 son evidencia
general de contenido y embalaje; los últimos 2 son los específicos
que Skydropx exige para reclamos por sobrepesos y daños durante
transporte:

1. **Producto sin embalar** — mostrando el artículo tal cual es.
2. **Producto embalado** — con el material de protección final
   (cajas, bubble wrap, cinta, etc.).
3. **Guía adherida al paquete** — donde se lee claramente el
   tracking number.
4. **Paquete con regla/flexómetro** mostrando **ancho, alto y
   largo** de manera clara en el embalaje final. Es la evidencia
   base para reclamos donde el courier alegue medidas mayores a
   las declaradas o daños derivados de mala clasificación.
5. **Paquete en báscula** con el peso legible en pantalla, en su
   embalaje final. Evidencia clave para reclamos por sobrepeso o
   pérdida.

Sin las 5 fotos, la aseguradora Skydropx **puede rechazar
reclamos** — especialmente los de sobrepeso, que son los más
comunes. La UI del seller **bloquea** el botón "Generar guía"
hasta que las 5 estén cargadas.

Todas se guardan en R2 bajo
`orders/{transactionId}/insurance/{01_producto,02_embalado,03_guia,04_medidas,05_peso}.jpg`
y quedan disponibles para Stripe Disputes evidence y reclamos SOS.

**Guía visual para el seller** (v1 debe incluir):

- Ejemplos "buena vs mala" foto para cada uno de los 5 slots.
- Instrucciones específicas: "la regla o flexómetro debe verse en
  la misma toma que el paquete", "el peso en pantalla debe estar
  legible", etc.
- Micro-cursillo (~3 min) antes de publicar el primer producto
  con estas técnicas.

### Proceso de indemnización (Skydropx)

*Referencia visual:*
- Proceso: [docs/assets/logistics/skydropx-proceso-indemnizacion.jpg](./assets/logistics/skydropx-proceso-indemnizacion.jpg)
- Fotos: [docs/assets/logistics/skydropx-fotos-evidencia.jpg](./assets/logistics/skydropx-fotos-evidencia.jpg)

Cuando ocurre una incidencia (pérdida, daño, robo, sobrepeso), el
proceso de reclamo tiene ventana estricta de **48 horas hábiles**
desde el momento en que se detecta el problema:

**Flujo:**

1. **Inicio de operaciones** — la guía viaja normal.
2. **Generación de guía** con las 5 fotos cargadas (requisito
   arriba).
3. **Incidencia detectada** → Xololo (en nombre del seller) tiene
   48h para levantar el reporte en Skydropx con:
   - Tracking number
   - Carrier
   - Valor declarado
   - Contenido del paquete
   - Las 5 fotos del paso anterior
4. Skydropx revisa evidencia (~24-72h).
5. Al autorizarse: cliente envía **factura o nota de venta del
   producto** + imagen extra si se requiere.
6. Skydropx paga en máx **5 días hábiles** posteriores a la
   autorización.
7. Notificación por correo al liberarse el pago.

**Responsabilidades operativas en Xololo:**

- El sistema debe capturar automáticamente al generar la guía:
  `contenido` (del listing) y `valor_declarado` (del precio de
  venta). No confiar en que el seller lo escriba manualmente.
- Al detectarse una incidencia (via webhook Skydropx o reporte
  del buyer), el sistema abre un caso interno con todos los
  metadatos + fotos y le muestra a Xololo un botón "Levantar
  reclamo en Skydropx" pre-poblado. Cronómetro de 48h visible.
- Al autorizarse, el sistema pide al seller subir la factura/nota
  de venta digital para adjuntar al pago.

### Comunicación (marketing + checkout + onboarding)

**Marketing / landing:**
- Banner "**Compra protegida hasta $100,000 MXN**" en home,
  storefront de sellers, y en checkout.

**Checkout (buyer):**
- Al elegir paquetería, aparece bajo el precio: "*Incluye compra
  protegida hasta $100,000 MXN — si tu paquete se pierde o daña,
  te devolvemos tu dinero.*"

**Onboarding del seller:**
- Guía visual paso a paso con las 3 fotos como plantilla de
  ejemplo (buenas y malas prácticas de foto).
- Cursillo micro (~3 min) sobre embalaje adecuado antes de
  publicar el primer producto.

### Implementación

- El costo SOS + 14% se calcula en `getQuotationRates()` server-side
  antes de devolver rates al cliente.
- Widget `SosPhotosUploader` en `TransactionPage` del seller que
  gatea la generación de guía.
- Persistencia:
  `transaction.protectedData.sosInsurance = { activated, urls: [], activatedAt }`.

---

## 6. Notificaciones cross-canal

### Política

Cada evento del ciclo de vida de la orden dispara notificaciones a
buyer y/o seller a través de canales seleccionados según su
criticidad:

- **Email**: TODOS los eventos (archivo permanente).
- **Push (web + PWA)**: eventos time-sensitive del día que requieren
  acción o awareness inmediata.
- **WhatsApp Business**: solo eventos críticos de dinero o urgencia
  (WA cobra ~$0.05 USD por mensaje marketing en MX; se reserva para
  alto valor).

### Matriz canal × evento

| Evento | Buyer | Seller | Email | Push | WhatsApp |
|---|---|---|:-:|:-:|:-:|
| Pago confirmado | ✓ | ✓ | ✓ | ✓ | ✓ |
| Guía generada | ✓ | | ✓ | ✓ | |
| Guía pendiente de imprimir | | ✓ | ✓ | ✓ | |
| Recolectado | ✓ | ✓ | ✓ | ✓ | |
| En tránsito | ✓ | | ✓ | | |
| En reparto (hoy) | ✓ | | ✓ | ✓ | ✓ |
| Entregado | ✓ | ✓ | ✓ | ✓ | ✓ |
| Encuesta abierta | ✓ | | ✓ | ✓ | |
| Encuesta expirada (afirm. ficta) | | ✓ | ✓ | | ✓ |
| Disputa abierta | ✓ | ✓ | ✓ | ✓ | ✓ |
| Disputa resuelta | ✓ | ✓ | ✓ | ✓ | ✓ |
| Refund emitido | ✓ | | ✓ | ✓ | ✓ |
| Primera venta (bienvenida) | | ✓ | ✓ | ✓ | ✓ |

### Stack

**In-house sencillo** (v1). Sin dependencias externas:
- `server/api-util/notifications/` con módulos `email.js`
  (Sharetribe transactional email), `push.js` (web-push npm), `wa.js`
  (Meta WhatsApp Cloud API).
- Dispatcher central: `sendEventNotifications(event, actors, payload)`.
- Templates por evento centralizados en `notifications/templates.js`.

Migración futura a Novu / Knock si el volumen justifica templates
visuales, digests, o A/B testing.

---

## 7. Multi-producto

### Política

- **Mismo seller**: OK, un carrito con N productos del mismo seller
  se procesa como una sola transacción, una sola guía (Skydropx
  soporta multi-paquete en una etiqueta), un solo timeline.
- **Sellers distintos en un carrito**: **NO PERMITIDO en v1**. Si el
  buyer quiere productos de 2 tiendas hace 2 checkouts separados.

Razones:
- Cada seller tiene su origen (CP recolección) distinto → guías
  distintas.
- Cada seller tiene sus propios términos de envío gratis, política
  de devolución, timing.
- Simplifica dramáticamente el modelo de datos y UI.

Se reevalúa multi-seller para v2 con métricas reales de uso.

---

## 8. Recolección local con código de 6 dígitos

### Política

Cuando el buyer elige `deliveryMethod: pickup` (o cuando el seller
usa chofer propio para entrega hyperlocal), se genera un **código
de 6 dígitos** al momento del pago.

- Buyer recibe el código en:
  - Email de confirmación
  - Push notification
  - Página de la orden
- Seller lo ve **gated**: primero debe hacer click en "Iniciar
  entrega" y capturar datos del chofer + hora estimada. Ahí se le
  revela el código.
- Al momento físico de la entrega, seller/chofer teclea el código
  que el buyer le muestra → si coincide → marca como entregado.
- 3 intentos fallidos bloquean el código y se dispara alerta
  interna a Xololo (posible fraude).

### Casos de uso

- Recolección del buyer en el domicilio del seller ("Paso a
  recoger a la tienda").
- Seller con chofer propio (motorizado, camioneta) para entrega
  local.
- Acuerdos ad-hoc entre buyer y seller (mensajería local,
  tianguis, punto neutral).

Referencias UX de "top logistics apps": Uber Direct, Rappi Pro,
iVoy, 99minutos.

### Implementación

- Al pagar con `pickup`: server genera código random con
  `crypto.randomInt(100000, 999999)` y lo guarda en
  `transaction.protectedData.pickupCode = { code, revealedAt, verifiedAt, attempts: 0 }`.
- Widget `PickupCodeReveal` en TransactionPage del seller con state
  machine: `pending` → `preparing` (post click Iniciar) →
  `revealed` (código visible) → `verified` (código correcto tecleado).
- Endpoint `POST /api/orders/:id/verify-pickup-code` con validación
  + rate limit + audit log.

---

## Resumen operativo

Este documento debe pasar por revisión legal antes de v1 launch.
Puntos críticos para legal:

1. Cláusula de afirmativa ficta (sección 4) — necesita redacción
   final para T&C.
2. Política de disputa y refund parcial (sección 3) — alineación
   con Ley Federal de Protección al Consumidor.
3. Documentación de "compra protegida hasta $100,000" (sección 5)
   — no puede sobre-prometer, verificar con Skydropx la letra chica
   del SOS.
4. Retención de fotos y datos personales del buyer (dirección,
   nombre) por período mínimo legal fiscal (5 años en México)
   antes de purga.

## Próximas versiones

Cambios candidatos para v2 con base en métricas reales:

- Multi-seller cart (sección 7)
- Preferencias de canal configurables por usuario (sección 6)
- Suscripción a Novu/Knock si el volumen crece >10k notificaciones/mes
- Umbral SOS configurable (obligar solo >$X para pedidos chicos y
  reducir costo)
- Devoluciones y reverse logistics (fuera de scope v1)
- Cobertura internacional (fuera de scope v1)
