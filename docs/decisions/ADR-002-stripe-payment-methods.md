# ADR-002 — Métodos de pago alternativos (OXXO / SPEI)

**Fecha**: 2026-11-02
**Status**: Rechazado por bloqueador externo (Sharetribe)
**Re-evaluar**: 2027-02-02 (task #63)

## Contexto

Buyer necesita más opciones que solo TDC. Lo más pedido en MX:

- **OXXO** (pago en tienda de conveniencia con voucher)
- **SPEI** (transferencia bancaria interna)

El objetivo es capturar buyers sin TDC y abaratar costo en tickets grandes
(SPEI vía Stripe cuesta ~$7 flat vs 3.6% + $3 de TDC).

## Reglas de negocio acordadas con earias (quedan documentadas aunque no se
implementen hoy)

| Método | Comisión al seller | Mínimo | Opt-in seller | Economía Xololo (venta $5,000) |
|---|---|---|---|---|
| TDC (default) | 3.6% + IVA | — | Siempre | ~0 (break-even) |
| OXXO | **4% + IVA** 🔼 | — | Sí (seller marca "acepto tiendas") | ~0 (pass-through) |
| SPEI (Stripe) | **2.6% + IVA** 🔽 | **≥ $1,000 MXN** | Siempre | **+$123** (arbitraje a favor) |

Expiración del voucher/CLABE: **48 h**. Pedido NO se materializa al seller
hasta que llegue el webhook `payment_intent.succeeded`.

## Decisión

**No implementar en v1 por bloqueador en Sharetribe.**

## Fundamento (spike 2026-11-02)

El spike confirmó que Sharetribe **no soporta OXXO ni SPEI** en absoluto. No es
cuestión de parsear parámetros — simplemente no existe la acción en el process
definition:

- `stripe-create-payment-intent` → solo card + wallets (Apple/Google Pay)
- `stripe-create-payment-intent-push` → solo push methods europeos (iDEAL,
  Bancontact, giropay, EPS, Przelewy24, Alipay)
- **Nada para OXXO, SPEI, `customer_balance`, `mx_bank_transfer`**

El `payment_method_types` del PaymentIntent lo controla Sharetribe
internamente según qué `action` tenga la transición. No es un parámetro
que el cliente/backend pueda pasar en el request.

Fuentes consultadas:

- https://www.sharetribe.com/docs/concepts/payments/payment-methods-overview/
- https://www.sharetribe.com/docs/concepts/payments/payment-intents/
- https://www.sharetribe.com/api-reference/marketplace.html#initiate-transaction
- https://stripe.com/mx/pricing (pricing confirmado)

## Pricing real Stripe MX (noviembre 2026)

| Método | Fee Stripe |
|---|---|
| TDC | 3.6% + $3 MXN |
| OXXO | **4% + $3 MXN** (más caro que TDC — no barato como se pensaba) |
| SPEI (`mx_bank_transfer`) | **$7 flat** (sin %, sin cap — sorprendentemente barato) |

## Alternativas que descartamos

### A) Stripe Checkout externo (fuera de Sharetribe)

- Buyer elige en Xololo "pagar con OXXO/SPEI"
- Backend crea Stripe Checkout Session directa (no vía Sharetribe)
- Webhook Stripe → nuestro backend confirma pago
- Backend crea manualmente la transaction en Sharetribe sin pasar por el
  payment step (requiere transition especial o custom action)
- **Esfuerzo**: 2-3 semanas
- **Riesgo**: perdemos el Connect automático; payouts al seller se vuelven
  manuales; cambio arquitectónico grande

### B) SPEI directo vía Xololo (sin Stripe)

- Buyer transfiere a CLABE de Xololo (BBVA JMT)
- Conciliación manual o integración bancaria
- **Rompe el modelo Connect**: Xololo se vuelve merchant of record, factura
  todo y paga manualmente al seller
- **Riesgo fiscal + operativo pesado**: comprobantes falsos, cambio de CFDI,
  BBVA API empresarial requiere trámite

### C) Mantener solo TDC + habilitar Google/Apple Pay

- Google/Apple Pay sí los soporta Sharetribe nativo
- Captura buyers móviles con wallet pero no reemplaza OXXO
- **Esfuerzo**: 1-2 días de configuración

## Plan de reactivación

Febrero 2027 (ver task #63):

1. Revisar changelog de Sharetribe desde noviembre 2026.
2. Si agregaron soporte oficial para OXXO/SPEI → implementar con las reglas
   de pricing arriba.
3. Si NO → re-evaluar formalmente la Opción A (Stripe Checkout externo)
   contra el beneficio esperado de capturar buyers sin TDC.

Mientras tanto: solo TDC está disponible en el checkout.
