# Xololo — Roadmap de seguridad 2027

**Fecha:** 2026-10-27
**Audiencia:** CEO Xololo + decisor presupuestal
**Objeto:** pendientes de seguridad que requieren decisión comercial, vendor externo o proceso administrativo.

Este documento NO es trabajo de código. Son pendientes identificados en el análisis de seguridad del 27 oct 2026 que no podemos resolver internamente sin contratar o invertir.

---

## 1. Pentest externo (prioridad alta — Q1 2027)

### Por qué

Hoy no hemos tenido un review externo de seguridad. El código y la infraestructura están sólidos pero no validados por un tercero. Un pentest encuentra lo que no se nos ocurre buscar.

### Qué buscar en un vendor

- Pentester con experiencia en marketplaces mexicanos / e-commerce / fintech.
- Scope: aplicación web + API + flujos de pago + Stripe Connect.
- Entrega: reporte ejecutivo + reporte técnico + reunión de walkthrough.
- Retest de hallazgos críticos tras fix (incluido o cotizar aparte).

### Vendors recomendados (benchmark MX / LATAM)

| Vendor | Estimado | Entrega | Notas |
|---|---|---|---|
| **Scitum / NIC-México** | $120K-$180K MXN | 2-3 semanas | Local, experiencia pymes. |
| **Hackmetrix** | $100K-$150K MXN | 2 semanas | Chile, remoto. Especializado SaaS. |
| **TrustWave MX** | $250K+ MXN | 3-4 semanas | Enterprise, caro. |
| **Freelancer certificado OSCP/CEH** | $40K-$80K MXN | 2-4 semanas | Más barato, calidad variable. Pedir referencias. |
| **HackerOne / Bugcrowd (bug bounty)** | $0 base + payouts | continuo | Modelo distinto; funciona si tienes volumen suficiente para que les interese. |

### Alcance mínimo recomendado para la 1ra iteración

1. Flujo de registro + login + password reset.
2. Flujo de pago (checkout + Stripe Connect split).
3. Admin console (`/ops/*` + Super Admin).
4. Endpoints IA.
5. Shipping flow (initiate + fulfillment + webhooks Skydropx).

Scope OUT (para después): mobile (no hay), pentest físico, social engineering.

### Timing

- **Antes del pentest:** cerrar los P2 pendientes del análisis interno (ya hicimos los P1 el 27 oct).
- **Ejecutar:** Q1 2027 (ene-mar).
- **Retest:** 2-4 semanas después del fix de criticals.

### Presupuesto sugerido

**$150K MXN** para el pentest + ~$40K para retest + buffer de ~$30K para fixes de criticals = **~$220K MXN total**.

---

## 2. WAF / Cloudflare Pro (prioridad media — Q4 2026)

### Por qué

Hoy Cloudflare está en modo Free. Esto significa:
- Sin WAF (Web Application Firewall) real — reglas básicas automáticas.
- Sin Bot Management.
- Sin análisis de amenazas en tiempo real.
- Sin page rules avanzadas (solo 3).
- Sin Zero Trust (necesitamos para `/ops`).

Si nos atacan con bot activo (scraping masivo, credential stuffing, DDoS L7), hoy solo tenemos el rate limit interno (que es per-process, limitado).

### Qué nos daría Cloudflare Pro

| Feature | Free | Pro | Nos sirve? |
|---|---|---|---|
| WAF managed rules | Básico | OWASP + custom | ✅ Sí |
| Bot Fight Mode | Básico | Super Bot Fight | ✅ Sí |
| Page rules | 3 | 20 | ✅ |
| Image optimization | No | Polish + Mirage | ⚠️ Opcional |
| HTTP/3 | Sí | Sí | — |
| Zero Trust (Access) | No para apps | Primer 50 users gratis | ✅ Para `/ops` |

### Costo

- **Pro plan:** $20 USD/mes por dominio ≈ $360 MXN/mes.
- **Zero Trust Access:** gratis para los primeros 50 users, luego $7 USD/user/mes.

### Recomendación

Pasar a Pro **antes del pentest**: le damos al pentester un entorno realista para que valide la configuración, y nos ahorramos un sinnúmero de bots que podrían falsear hallazgos.

### Setup estimado

- 1 hora de configuración.
- Testing en staging 1 día.
- Deploy a producción 1 hora.

**Esfuerzo total: 2 días. Costo recurrente: ~$400 MXN/mes.**

---

## 3. SOC 2 / ISO 27001 (prioridad baja — 2028)

### Por qué

Solo necesario si:
- Clientes B2B grandes nos lo exijan (hoy no aplica — somos B2C/C2C).
- Vendedores institucionales (ej. convenios con cadenas) lo requieran como vendor.
- Buscamos levantar Serie A con fondos que lo pidan en due diligence.

### Esfuerzo

- **SOC 2 Type I:** 3-4 meses + auditor.
- **SOC 2 Type II:** 12 meses (observa controles en operación).
- **ISO 27001:** 9-12 meses.

### Costo

- Vendor Vanta/Drata para automatizar: ~$30K-50K USD/año.
- Auditor externo: ~$15K-30K USD una vez.
- Trabajo interno: 0.5 FTE durante 6 meses mínimo.

### Recomendación

**No priorizar en 2027.** Volver a evaluar en 2028 si Xololo crece a volumen que justifique B2B institucional.

---

## 4. 2FA para sellers/buyers (decidido 2026-10-27: no tocar aún)

### Decisión del CEO

Posponer hasta tener resultados del pentest. Si el pentest no detecta vectores explotables por account takeover, se puede diferir más.

### Opciones evaluadas (para cuando se retome)

| Opción | Esfuerzo | Beneficio |
|---|---|---|
| A — Step-up TOTP solo operaciones sensibles del seller | 2-3 días | Alto, bajo riesgo |
| B — 2FA global opt-in integrado al login Sharetribe | 4-5 días | Más amplio, más riesgo de regresión |
| C — Email mágico al cambiar password/email | 1 día | Previene takeover básico sin dependencias |

Recomendación cuando se retome: **A** (step-up TOTP) primero. Es la mejor relación esfuerzo/beneficio para proteger lo que más duele (payouts).

---

## 5. Checklist para presupuesto 2027

Pedirle al CFO/CEO que incluya en el presupuesto del año:

- [ ] **$150K MXN** pentest externo Q1 2027.
- [ ] **$5K MXN/año** Cloudflare Pro (upgrade inmediato en Q4 2026).
- [ ] **$30K MXN** buffer para fixes post-pentest.
- [ ] **$40K MXN** retest post-fixes.
- [ ] Diferir SOC 2 / ISO 27001 a 2028.

**Total CAPEX seguridad 2027: ~$220K MXN.**

### ROI argumental

- 1 chargeback bancario mal manejado = $5K-50K MXN de pérdida directa.
- 1 fraude de payout no detectado = $50K-500K MXN.
- 1 leak de PII = multa INAI potencial > $500K MXN + daño reputacional.
- 1 evento de rate limiting ausente en Anthropic = $500 USD/hora (ya cubierto en el fix de hoy, pero si rompemos de nuevo…).

Un solo evento evitado paga el pentest y el WAF del año entero.

---

*Documento preparado post-análisis de seguridad del 27 oct 2026. Si en algún momento del año aparece dinero adicional o un incidente que acelere prioridades, re-evaluar.*
