# ADR-002 — Métodos de pago alternativos (OXXO / SPEI)

**Fecha original**: 2026-11-02
**Última actualización**: 2026-11-03 (respuesta oficial Sharetribe + guía 3rd-party)
**Status**: **CERRADO** — Sharetribe confirmó que no es compatible y no está en roadmap. El camino existe (custom integration bypasseando el payment system de Sharetribe) pero earias cierra el tema hasta que lo reabra explícitamente. No agendar re-evaluación automática.

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

## Respuesta oficial de Sharetribe (2026-11-03)

Email de Aleksi (support-team.sharetribe.com), recibido 2026-11-03:

> *"Unfortunately our Stripe integration is not compatible with OXXO
> and SPEI. Sharetribe's Stripe integration only supports payment
> methods that have immediate payment confirmation (OXXO & SPEI have
> delayed confirmation). In order to support these payment methods,
> you will need to build support for them by building a custom payment
> integration, meaning that you will need to practically bypass the
> default integrated payment system."*

Puntos clave:

- **Confirma el blocker arquitectónico**: la integración Stripe de
  Sharetribe solo acepta métodos con confirmación inmediata.
- **No menciona roadmap**: si estuviera planeado, lo habría dicho. Hay
  que asumir que no viene.
- **Camino oficial**: "custom payment integration, practically
  bypassing the default integrated payment system."

## Guía oficial que Sharetribe nos pasó

Referencia: https://www.sharetribe.com/docs/how-to/payments/how-to-integrate-3rd-party-payment-gateway/

Resumen de lo que define esa guía:

- **Arquitectura**: delegar el pago a un gateway externo (ejemplos que
  menciona: PayPal Commerce Platform, MANGOPAY, Adyen for Platforms).
  Para OXXO/SPEI eso significa Stripe Checkout usado como gateway
  externo, no via Sharetribe.
- **Backend endpoint propio** que llama al gateway, más un webhook
  receiver para notificaciones (status de pago, payouts).
- **Transition process modificado**: nuevo estado `pending-payment`
  entre initiate y paid. El ejemplo de la guía usa expiración de
  15 min — para OXXO necesitaríamos 48 h, no imposible pero fuera de
  lo que la guía ejemplifica.
- **Integración en 2 modos**: privileged transitions (checkout) y
  events (accept/capture/refund).
- **Dinero y custodia**: la guía advierte explícitamente *"you could
  be considered as holding other people's money, which is a heavily
  regulated area"*. Recomienda que el gateway sea quien hace el split
  y los payouts, y que la plataforma no retenga fondos.
- **PCI**: SAQ A Level 4 bajo 20,000 transacciones/año.
- **Lo que la guía NO cubre**: vouchers, bank transfers, OXXO, SPEI,
  CFDI, SAT. Nada específico de México.
- **Lo que la guía SÍ pide**: contactar al gateway primero (Stripe
  Mexico) para confirmar que soporta marketplace splitting + KYC +
  payouts a providers del país; firmar contrato con el gateway;
  consultar con contador y abogado antes de ir a producción.

## Qué significa esto para Xololo si algún día lo retomamos

Lista corta de lo que habría que hacer para OXXO/SPEI con el patrón
oficial de 3rd-party gateway:

1. Agregar nuevo transition `pending-payment` al proceso de compra con
   expiración de 48 h (vs los 15 min del ejemplo).
2. Crear endpoint `server/api/initiate-external-payment.js` que:
   - Llame a Stripe Checkout Session con
     `payment_method_types: ['oxxo', 'customer_balance']`.
   - Dispare el transition `initiate` en Sharetribe con el PaymentIntent
     en metadata.
3. Webhook handler `server/api/stripe-payment-webhook.js`:
   - `payment_intent.succeeded` → `transition/confirm-external-payment`.
   - `payment_intent.payment_failed` o expiry → `transition/cancel`.
4. **Decisión sobre custodia** (más grande que la de dev):
   - Opción M1 — Stripe directo a cuenta del seller con destination
     charge: Stripe docs dicen que destination charges + OXXO/SPEI no
     soportan async en marketplace. No viable.
   - Opción M2 — Xololo merchant of record: dinero cae a cuenta Stripe
     de Xololo, luego pagamos al seller via SPEI/Stripe Transfers.
     Nos vuelve regulated → KYC + licencia bancaria/IFPE o acuerdo
     con un IFPE. Riesgo legal alto.
   - Opción M3 — Stripe Connect pero con separate transfers: Xololo
     cobra como merchant y hace Transfer al seller connected account
     después de confirmar entrega. Dentro de los TOS de Connect
     siempre y cuando el seller tenga Connect account completa. Es el
     patrón que menos friction regulatoria tiene.
5. CFDI: cambia el emisor. Si Xololo es merchant of record, Xololo
   factura al cliente el total y luego recibe factura del seller por
   su parte. Rompe el modelo actual (seller factura al cliente).
   Requiere acuerdo con PAC (ver task #16, #54).
6. UI del checkout: nueva sección "pagar con OXXO/SPEI" fuera del flow
   Sharetribe. Nueva página de confirmación con instrucciones (voucher
   OXXO para imprimir, CLABE efímera para SPEI).
7. Dashboard del seller: estado "pending_payment" visible, no
   materializa pedido hasta confirmación. Timeline distinto al TDC.
8. Operaciones: reconciliación de pagos con pedidos pending, manejo de
   expiraciones, alerta cuando un buyer paga tarde (fuera de ventana).

Estimación muy aproximada si algún día se autoriza: 3-4 semanas de dev
+ 1-2 semanas legal/fiscal + 1 semana operaciones + runway de piloto.

## Reglas de negocio acordadas con earias (quedan documentadas aunque no se
implementen hoy)

| Método | Comisión al seller | Mínimo | Opt-in seller | Economía Xololo (venta $5,000) |
|---|---|---|---|---|
| TDC (default) | 3.6% + IVA | — | Siempre | ~0 (break-even) |
| OXXO | **4% + IVA** 🔼 | — | Sí (seller marca "acepto tiendas") | ~0 (pass-through) |
| SPEI (Stripe) | **2.6% + IVA** 🔽 | **≥ $1,000 MXN** | Siempre | **+$123** (arbitraje a favor) |

Expiración del voucher/CLABE: **48 h**. Pedido NO se materializa al
seller hasta que llegue el webhook `payment_intent.succeeded`.

## Pricing real Stripe MX (noviembre 2026)

| Método | Fee Stripe |
|---|---|
| TDC | 3.6% + $3 MXN |
| OXXO | **4% + $3 MXN** (más caro que TDC — no barato como se pensaba) |
| SPEI (`mx_bank_transfer`) | **$7 flat** (sin %, sin cap — sorprendentemente barato) |

## Cuándo se puede reabrir este ADR

Earias decide. No hay fecha automática. Casos típicos que lo
justificarían:

- Un seller importante nos pide con dolor real (ej: Kike dice "pierdo
  30% de ventas sin SPEI").
- Datos duros de abandono en checkout por falta de método de pago.
- Que Sharetribe anuncie soporte oficial (habría que verificar
  periódicamente el changelog, pero no es automático).
- Alineación con un gran push comercial a mercados sin TDC.

Mientras tanto: **solo TDC está disponible en el checkout**.
