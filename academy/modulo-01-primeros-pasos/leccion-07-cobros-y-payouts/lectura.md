# Lectura complementaria · Lección 7

**Tiempo de lectura**: 6 minutos.

---

## Transparencia radical en los cobros

La razón por la que negocios desconfían de los marketplaces es
porque descubren cargos sorpresa después de la venta. Nosotros
tomamos la decisión opuesta: todos los cargos son visibles antes de
publicar y antes de confirmar una venta.

Si descubres algo que no te cuadra en tu primer depósito, lo más
probable es que esta lectura te lo explique. Si no, abre un ticket
con soporte — y si encontramos algo mal, lo corregimos.

## Los 3 cargos de cada venta — detalle completo

### 1. Cargo administrativo plano: $14 + IVA

Aplica a los **3 planes** (SM, Starter, Empresarial). Es la cuota
plana por procesar la transacción, verificar al cliente, mantener el
pago protegido mientras entregas y darte soporte si algo sale mal.

- Monto fijo: $14 MXN + IVA 16% = **$16.24** por venta.
- No depende del precio: vendas $200 o $20,000, es el mismo cargo.
- No depende del método de envío.
- No depende del método de pago del cliente.

Esto es lo que hace que Xololo tenga sentido económico para ambos
lados: para ti, porque tu % de margen crece conforme sube el ticket;
para nosotros, porque cubrimos el costo real de procesar.

### 2. Procesador Stripe: 3.6% + IVA sobre el total

Es lo que Stripe nos cobra a nosotros por mover el dinero del cliente
a tu cuenta. Lo pasamos tal cual sin ganancia nuestra.

- Tasa: 3.6% + $3 fijos. Nosotros lo exponemos como 3.6% + IVA para
  simplificar.
- Pass-through puro: si Stripe algún día baja su tarifa, tú ves el
  ahorro.

### 3. Comisión por venta — varía por plan

Este es el que depende de tu plan:

**Starter y Empresarial = 0%**. Pagas tu suscripción mensual, y a
cambio las ventas no tienen comisión porcentual. Solo pagas el admin
plano.

**Segunda Mano = tabla marginal 6/4/2 por venta individual**:

| Tramo del precio | Tasa marginal |
|---|---|
| Primeros $50,000 | 6% |
| $50,001 – $100,000 | 4% |
| Sobre $100,000 | 2% |
| + IVA 16% sobre la comisión |

Es escalonada marginal: cada porción del precio dentro de un tramo
paga la tasa de ese tramo (como funciona el ISR). Un bien vendido en
$75,000 paga 6% × $50,000 + 4% × $25,000 = $3,000 + $1,000 = **$4,000
+ IVA** = **$4,640**.

## Retenciones fiscales — cuándo aplican

Dependen del **tipo de persona** fiscal detrás del negocio:

### Segunda Mano (particular ocasional)

**Cero retenciones.** El bien usado vendido por particular está
exento de IVA por el Art. 9 fracción IV de la LIVA, y el régimen de
plataformas digitales (ISR 113-A y LIVA 18-J) no te aplica porque no
eres contribuyente.

Vendes limpio.

### Persona física con actividad empresarial (Starter/Empresarial PF)

Aplican **dos retenciones** sobre el **subtotal** (precio sin IVA):

- **ISR Art. 113-A**: 1% para enajenación de bienes y servicios en
  general. Hay otras tasas para transporte (2.1%) y hospedaje (4%),
  pero la mayoría de negocios Xololo cae en el 1%.
- **IVA Art. 18-J**: 8%, que es la mitad del IVA causado del 16%. Solo
  si el producto es gravado 16%.

Sin RFC: la tasa sube a 20% ISR y 16% IVA. Por eso insistimos tanto
en que subas tu RFC.

### Persona moral (empresa)

Hoy **no aplican** estas retenciones (el régimen 113-A y 18-J está
diseñado para PF). La reforma LIF 2026 agregará ISR 4% + IVA 8% para
PM; lo modelaremos cuando entre en vigor.

### Importante — gate pendiente

Hoy Xololo **no está reteniendo activamente** mientras completamos el
registro como "plataforma tecnológica" ante el SAT. Cuando se active,
verás las retenciones desglosadas en cada venta y las enteramos
directamente al SAT por ti.

Mientras tanto, el negocio es quien reporta y entera. No es ideal, es
transitorio.

## CFDI — detalle por plan

### Starter y Empresarial

**Xololo emite CFDI** por cada venta automáticamente a nombre del
cliente, con tu RFC como emisor. Recibes el CFDI en tu panel para
tu contabilidad.

También emitimos **CFDI por el cargo administrativo Xololo** que te
cobramos, con **nuestro RFC** como emisor y el tuyo como receptor.

### Segunda Mano

**No emitimos CFDI por la venta** del bien usado, porque está exento.
Pero sí emitimos **CFDI por el cargo administrativo + comisión Xololo**
que te cobramos (Xololo es contribuyente de IVA aunque el bien que
vendiste esté exento).

Esto significa que si eres SM, el CFDI que ves en tu panel es solo
por lo que te cobramos nosotros — no es por la venta.

## Depósito — cuándo te llega el dinero

El flujo tiene 4 pasos:

1. **Cliente paga** con TDC vía Stripe.
2. **El dinero queda retenido** en Xololo mientras completas la
   entrega. Esto es el "pago protegido" que da confianza al cliente.
3. **Entrega confirmada** — pasa cuando:
   - El cliente marca "recibí mi pedido" en su app, O
   - Pasan 7 días desde que la paquetería marcó entregado sin reclamo.
4. **Depósito automático a tu cuenta bancaria** — Stripe lo deposita en
   2-3 días hábiles.

El total de tiempo entre venta y dinero en tu cuenta es típicamente
**5-10 días**.

## El requisito crítico: cuenta bancaria configurada

**Si no tienes configurada tu cuenta bancaria en Stripe, el depósito no
se dispara**. La venta se completa normal, el cliente recibe su
producto, pero tu dinero se queda esperando en Xololo. Se te deposita
en cuanto configures la cuenta.

**Dónde**: Mi cuenta → Formas de pago → Cuenta de depósito.

Se te pide:
- CLABE a 18 dígitos de tu cuenta
- Nombre del titular (debe coincidir con tu RFC/INE)
- Comprobante bancario (puede ser carátula del estado de cuenta)

Es el paso **más olvidado** por sellers nuevos. Hazlo hoy, en cuanto
termines esta lectura.

## Qué sigue

En la **Lección 8** vemos qué pasa después de la venta: cómo
responder al cliente, cómo preparar el pedido, cómo generar la guía,
cómo cerrar bien para que te deje reseña y vuelva.

Nos vemos en 25 minutos.
