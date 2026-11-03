# Lección 7 — Slides

---

## Slide 1 · Título

# Cómo cobra Xololo y cómo te pagamos
### Módulo 1 · Lección 7 · 15 min

> *Qué te cobramos, qué recibes, cuándo te pagamos. Sin letras chiquitas.*

---

## Slide 2 · Los 3 cargos de cada venta

### 1. 🏷️ Cargo administrativo plano
**$14 + IVA por venta**. Todos los planes. Procesamiento,
verificación, pago protegido, soporte.

### 2. 💳 Procesador Stripe
**3.6% + IVA sobre el total**. Pass-through — no le ganamos nada.

### 3. 📊 Comisión por venta
- **Starter y Empresarial**: **0%** (incluida en suscripción)
- **Segunda Mano**: 6% / 4% / 2% escalonado + IVA

---

## Slide 3 · Ejemplo venta $5,000 — Starter/Empresarial

```
Precio                      $5,000.00
──────────────────────────────────────
− Cargo admin $14 + IVA        $16.24
− Stripe 3.6% + IVA           $208.80
− Comisión 0%                   $0.00
──────────────────────────────────────
Recibes                     $4,774.96
```

Efectivo total descontado: **~4.5%**

---

## Slide 4 · Ejemplo venta $5,000 — Segunda Mano

```
Precio                      $5,000.00
──────────────────────────────────────
− Cargo admin $14 + IVA        $16.24
− Stripe 3.6% + IVA           $208.80
− Comisión 6% + IVA           $348.00
──────────────────────────────────────
Recibes                     $4,426.96
```

Efectivo total descontado: **~11.5%**

---

## Slide 5 · Retenciones fiscales

| Tipo de negocio | ISR 113-A | IVA 18-J |
|---|---|---|
| **Segunda Mano** (particular ocasional) | ❌ | ❌ |
| **PF empresarial con RFC** | ✅ 1% | ✅ 8% |
| **PF empresarial sin RFC** | ✅ 20% | ✅ 16% |
| **Persona moral** | ❌ (hoy) | ❌ (hoy) |

> Hoy Xololo NO retiene activamente (gate pendiente). Cuando se
> active, verás las retenciones desglosadas.

---

## Slide 6 · CFDI — quién emite y cuándo

| Plan | ¿Emite CFDI por venta? | ¿Emite CFDI por comisión Xololo? |
|---|---|---|
| **Starter** | ✅ Sí, automático | ✅ Sí |
| **Empresarial** | ✅ Sí, automático | ✅ Sí |
| **Segunda Mano** | ❌ No (bien usado exento) | ✅ Sí (por la comisión) |

Si tienes dudas, el equipo de soporte fiscal te ayuda. No es tema de
improvisar.

---

## Slide 7 · Flujo del payout

```
┌─────────────┐    ┌─────────────┐    ┌───────────────┐
│   Cliente   │    │  Dinero     │    │  Entrega      │
│    paga     │ ─▶ │  retenido   │ ─▶ │  confirmada   │
│   (TDC)     │    │   (Xololo)  │    │  (o 7 días)   │
└─────────────┘    └─────────────┘    └───────┬───────┘
                                              │
                                              ▼
                                      ┌───────────────┐
                                      │  Payout       │
                                      │  automático   │
                                      │  2-3 días     │
                                      │  hábiles      │
                                      └───────────────┘
```

---

## Slide 8 · Requisito crítico — cuenta bancaria

**El payout NO se dispara si no tienes cuenta bancaria configurada.**

Ruta: **Mi cuenta → Formas de pago → Cuenta de payout (Stripe)**.

Sin esto:
- La venta se completa normal
- El cliente recibe su producto
- Tu dinero se queda esperando en Xololo
- Se deposita cuando configures la cuenta

> Es el paso que **más gente olvida**. Hazlo hoy.

---

## Slide 9 · Resumen rápido

- **3 cargos**: admin + Stripe + comisión (0% o escalonada)
- **Retenciones**: solo PF empresarial. SM y PM no.
- **CFDI**: automático Starter/Empresarial. SM solo por la comisión.
- **Payout**: 2-3 días post-entrega confirmada. Requiere cuenta
  bancaria.

---

## Slide 10 · Siguiente lección

### ➡️ Lección 8 — Recibe, prepara y entrega al cliente
(25 min) · Qué pasa después de la venta. Mensajes, guías, rastreo,
cómo cerrar bien.
