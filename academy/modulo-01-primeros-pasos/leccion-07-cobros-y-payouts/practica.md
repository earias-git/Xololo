# Práctica · Lección 7

**Duración**: 10 minutos.
**Objetivo**: cuenta bancaria configurada + calculadora de payout usada.
**Verificable en**: Mi cuenta → **Formas de pago** → sección "Cuenta
de payout (Stripe)".

---

## Parte 1 · Configura tu cuenta bancaria (crítico, 5 min)

Este es el paso **más olvidado** por sellers nuevos. Sin esto, tu
dinero se queda esperando en Xololo.

### Pasos

1. Ve a **Mi cuenta → Formas de pago → Cuenta de payout (Stripe)**.
2. Haz clic en **"Configurar cuenta"**. Se abre el flujo de Stripe
   Connect en una nueva pestaña.
3. Completa los campos que Stripe te pide:
   - **CLABE a 18 dígitos** de tu cuenta bancaria.
   - **Nombre del titular** — debe coincidir con tu RFC/INE.
   - **Comprobante bancario** — carátula de estado de cuenta en PDF o
     foto nítida.
4. Confirma. Stripe verifica la cuenta en 1-2 días hábiles.

### Verifica

De vuelta en Xololo, en **Formas de pago** debes ver:

- ✅ **Cuenta de payout: Configurada** (verde)
- Si aún aparece **🕐 Pendiente de verificación**, es normal — Stripe
  está revisando. Mientras tanto no bloquea tus ventas, pero los
  payouts se acumulan y se depositan cuando quede verificada.

---

## Parte 2 · Usa la calculadora de payout (5 min)

**Ruta**: Dashboard → **Calculadora de payout** (o abajo del formulario
de "Nuevo anuncio" / "Editar anuncio").

### Ejercicio

Calcula el payout en estos 3 escenarios y anota el resultado para
revisar:

**Escenario A** — Starter / Empresarial, venta de $200
- Precio: $200
- Lo que recibes: _______

**Escenario B** — Starter / Empresarial, venta de $5,000
- Precio: $5,000
- Lo que recibes: _______

**Escenario C** — Segunda Mano, venta de $5,000
- Precio: $5,000
- Lo que recibes: _______

### Respuestas correctas

<details>
<summary>Haz clic cuando ya hayas calculado</summary>

- **A**: $200 − $16.24 (admin) − $8.35 (Stripe) ≈ **$175.41**
- **B**: $5,000 − $16.24 − $208.80 ≈ **$4,774.96**
- **C**: $5,000 − $16.24 − $208.80 − $348.00 (comisión 6%) ≈ **$4,426.96**

</details>

Si tus números coinciden (±$1 por redondeo), entendiste perfectamente
el modelo de cobros. Si no, revisa la lectura complementaria antes de
publicar más anuncios.

---

## Preguntas frecuentes

> *"Mi cuenta Stripe quedó en 'pendiente' hace 3 días, ¿qué hago?"*

Normalmente Stripe tarda 1-2 días hábiles. Si han pasado más de 5
días, abre un ticket con soporte Xololo y lo escalamos a Stripe para
que revisen.

> *"¿Puedo cambiar de cuenta bancaria después?"*

Sí, cuando quieras. Es solo un nuevo flujo en Formas de pago. Los
payouts siguientes van a la cuenta nueva; los que ya se depositaron
quedan donde fueron.

> *"¿Puedo usar una cuenta de un pariente o familiar?"*

**No**. La cuenta debe estar a tu nombre (o a nombre de tu empresa si
eres persona moral). Stripe valida que el titular coincida con tu RFC
o INE. Esto es un requisito regulatorio anti-lavado.

> *"¿Qué pasa si no quiero vender vía TDC y solo acepto efectivo en
> entrega local?"*

Xololo hoy solo soporta pagos con TDC vía Stripe. OXXO/SPEI están
bloqueados por Sharetribe hasta nuevo aviso (ver ADR-002). Si vendes
solo en efectivo cara a cara, Xololo no es la plataforma adecuada —
es un marketplace online.

---

## Siguiente paso

→ **Lección 8 — Recibe, prepara y entrega al cliente** (25 min)
