# Xololo — Runbook de operaciones

**Audiencia:** operadores Xololo con acceso a Render + Stripe + Sharetribe Console.
**Última actualización:** 2026-10-27.

Este runbook es para situaciones **operacionales** (deploys, incidentes, rotación). Para seguridad y vulnerabilidades, ver [SECURITY.md](SECURITY.md). Para logística / Skydropx, ver [LOGISTICS_V1.md](LOGISTICS_V1.md).

---

## 1. Infraestructura

| Capa | Proveedor | Dónde se gestiona |
|---|---|---|
| **Hosting del server** | Render | https://dashboard.render.com |
| **Dominio** | Cloudflare | https://dash.cloudflare.com |
| **CDN** | Cloudflare (frente a Render) | — |
| **Marketplace core** | Sharetribe Flex | https://console.sharetribe.com |
| **Storage (fotos, assets)** | Cloudflare R2 | https://dash.cloudflare.com → R2 |
| **Pagos** | Stripe + Stripe Connect | https://dashboard.stripe.com |
| **Carrier** | Skydropx PRO | https://pro.skydropx.com |
| **Search** | Algolia | https://www.algolia.com/dashboard |
| **IA** | Anthropic (Claude Haiku 5.5, Sonnet 5.5) | https://console.anthropic.com |
| **Email transaccional** | (verificar en server/api-util/notifications/) | — |
| **Observability** | Sentry | https://sentry.io |
| **Repo** | GitHub `earias-git/Xololo` | https://github.com/earias-git/Xololo |

**Importante:** `main` del repo se pushea al remote `xololo`, NUNCA al upstream `origin` (template Sharetribe).

---

## 2. Deploys y rollback

### Deploy normal

Render tiene auto-deploy en push a `main`.

1. Hacer el commit en local, con mensaje descriptivo.
2. `git push xololo main`.
3. Render detecta el push y hace build + deploy (~5-8 min).
4. Verificar en Sentry que no haya spike de errores en los siguientes 15 min.

### Rollback inmediato (si deploy rompe producción)

1. Render → Servicio → Deploys → clic en el deploy anterior conocido como estable.
2. Clic en "Redeploy from this commit".
3. ~3 min en volver a estar arriba.

### Rollback por git (más seguro para cambios de datos)

```bash
git revert <sha-del-commit-malo>
git push xololo main
```

El revert deja trazabilidad del rollback. Preferible al "Redeploy" cuando el commit malo tocó migraciones o esquemas.

### Qué NO hacer

- Nunca `git push --force` a `main`.
- Nunca `git reset --hard` sobre `main` después de pushear.
- Nunca borrar la rama `main` del remote.
- No hacer commits directo en Render (no hay esa opción, pero por si acaso).

---

## 3. Health checks diarios (5 min cada mañana)

Checklist rápido para el operador on-duty:

- [ ] Sentry: ningún issue nuevo level ≥ error en las últimas 24h sin triaje.
- [ ] Render: servicio en Live, memoria <80%, CPU <70%.
- [ ] Stripe: no hay pagos atascados en "requires_action" sin resolver >6h.
- [ ] `/admin/payout-queue`: no hay sellers esperando payout >48h desde el ok.
- [ ] `/admin/legal-moderation`: 0 pendientes >24h.
- [ ] `/admin/shipping-losses?days=7`: `totalLossMxn` < $500. Si pasa, investigar.
- [ ] Skydropx dashboard: saldo de créditos > $1,000 (recargar antes de que llegue a $500).
- [ ] Anthropic console: consumo del mes < 90% del plan.

---

## 4. Incident response — matriz de severidad

| Severidad | Qué cuenta | Tiempo de respuesta | Quién decide |
|---|---|---|---|
| **S0 Catastrófico** | Prod down. Checkouts cobrando mal. Fuga de PII. Fuga de secreto. | Inmediato | CEO |
| **S1 Alto** | 1 feature core caída (envíos, pagos, listings). Pérdida monetaria recurrente. | <1h | On-call + CEO |
| **S2 Medio** | 1 feature secundaria caída. Error visible pero sin pérdida. | <4h | On-call |
| **S3 Bajo** | Bug cosmético, warning en Sentry, lentitud puntual. | <24h | On-call |

### Procedimiento S0/S1

1. **Status inicial** en el canal privado del equipo: "Investigando X desde HH:MM".
2. Checar Sentry + Render logs + Stripe + Sharetribe Console en paralelo.
3. Si el fix inmediato es rollback: ejecutar sección 2 → "Rollback inmediato".
4. Si el fix requiere código: hacer commit en rama, deploy a staging si existe, luego a main.
5. Si involucra dinero (payouts incorrectos, chargebacks masivos): pausar `/admin/payout-queue` manualmente.
6. **Postmortem** en 48h: documento con timeline, causa raíz, acciones correctivas.

### Procedimiento específico — fuga de secreto

Ver [SECURITY.md](SECURITY.md) §2 — rotación de secretos.

### Procedimiento específico — fuga de PII

1. Determinar alcance: qué campos, qué usuarios, cuántos registros.
2. Si incluye correos, direcciones o teléfonos: avisar a los usuarios afectados en <72h (plazo LFPDPPP Art. 20).
3. Preparar reporte INAI si corresponde al umbral.
4. Preservar logs y evidencia por mínimo 180 días.

---

## 5. Observability

### Sentry

Configurado en `server/log.js` + `src/util/log.js` con **PII scrubber** que redacta:
- Claves sensibles (passwords, tokens, direcciones, teléfonos, emails, etc.).
- Patrones de valor (emails, tarjetas, teléfonos MX).
- Cookies.

Para desactivar temporalmente el scrubber (debugging local), comentar `beforeSend` en `log.js`.

### Logs de Render

- `server/*` → stdout → Render Logs.
- Filtrar por tag: `[rate-limit]`, `[shipping-loss]`, `[initiate-privileged]`, `[generate-shipping-guide]`.
- Retención: Render Starter = 7 días, Standard = 30 días.

### Dashboards /admin

| URL | Qué muestra |
|---|---|
| `/admin/payout-queue` | Sellers con dinero retenido + liberación |
| `/admin/legal-moderation` | Listings flaggeados por IA (texto o imagen) |
| `/admin/tax-reviews` | Clasificaciones fiscales pendientes de revisión |
| `/admin/shipping-losses` | Discrepancias entre lo cobrado y lo que Skydropx cobra |
| `/admin/ai-metrics` | Consumo y accuracy de los endpoints IA |
| `/admin/operators` | Gestión de operadores (Super Admin only) |

---

## 6. Rate limits — qué hacer si pegan

Si un seller legítimo recibe 429:

1. Buscar en Render logs: `[rate-limit] bucket=... key=user:<id>` o `key=ip:<ip>`.
2. Si es patrón real (ej. un vendedor que publica 20 listings en 3 min): subir el `max` del bucket específico en `server/api-util/rateLimits.js` y deployar.
3. Si es claramente un bot: dejar el bloqueo e investigar la cuenta en Sharetribe Console.

Buckets configurados: ver [SECURITY.md](SECURITY.md) §4.

---

## 7. Rotación de secretos (resumen rápido)

Procedimiento completo en [SECURITY.md](SECURITY.md) §2. TL;DR:

```
1. openssl rand -hex 32              # generar nuevo
2. Render → copiar actual a *_PREV
3. Render → poner nuevo en *
4. Deploy
5. Esperar TTL (8h / 180 días / 30 min según secret)
6. Eliminar *_PREV
```

Cuándo rotar:
- Trimestral (higiene básica).
- Inmediato: operador fuera, sospecha de leak, pentest encuentra exposición.

---

## 8. Procedimientos de cliente / soporte

### Buyer reclama envío dañado/perdido

1. Checar `tx.protectedData.xololoShipping.rate.insuranceAccepted`.
   - `true` → Xololo abre reclamo a Skydropx. Ver flow en LOGISTICS_V1.md.
   - `false` → responder al buyer con el copy pre-aprobado (ver [SECURITY.md addendum]). Buyer reclama directo al carrier con la evidencia que Xololo le entrega. Cerrar el caso.

### Chargeback bancario

1. Confirmar en Stripe dashboard la razón del chargeback.
2. Reunir evidencia: foto del empaque (R2), guía Skydropx, tracking, timestamps de entrega, SOS consent si aplica.
3. Submit en Stripe antes del deadline (típico 7-10 días).
4. Registrar en el ledger interno.

### Seller suspendido por legalidad

1. `/admin/legal-moderation` → revisar razón detectada por IA.
2. Si se confirma: notificar al seller con el motivo, mantener listado cerrado, retener payout hasta aclarar.
3. Si se desestima: destildar, publicar listing, loggear la decisión.

### Request GDPR / LFPDPPP (buyer pide borrar sus datos)

1. Validar identidad del solicitante (email + reto en la cuenta).
2. En Sharetribe Console → User → "Permanently delete". Esto borra la cuenta y pseudonimiza las transacciones asociadas.
3. R2: borrar fotos subidas por ese user (query por userId en metadata del R2).
4. Confirmar al solicitante en <30 días (plazo LFPDPPP).

---

## 9. Backups y disaster recovery

### 9.1 Qué respaldamos

| Qué | Dónde vive | Frecuencia | Recuperación |
|---|---|---|---|
| **Operators directory** | R2: `operators/directory.json` | Script semanal manual (ver abajo) | Reemplazar archivo en R2 desde backup. |
| **AI metrics** | R2: `ai-metrics/YYYY-MM-DD.json` | Script semanal manual | Idem. |
| **Legal docs sellers** | R2: `legal-docs/...` | Script semanal manual | Idem. |
| **SOS photos** | R2: `sos-photos/...` | No se respalda (volumen alto, no crítico — se usan para reclamos del momento) | — |
| **Sharetribe data** (listings, users, tx) | Sharetribe cloud | Sharetribe maneja + export manual Console | Export JSON desde Console → import. |
| **Repo** | GitHub + mirror local | Push continuo | git clone. |
| **Secretos** | Render env vars | No respaldados — vivir con la lista en 1Password | Re-generar y re-poner. |

### 9.2 Correr el backup R2

```bash
# Export env vars (KEY_ID, R_SECRET, R_ENDPOINT, R_BUCKET)
source .env.production

# Correr el backup
node scripts/backup-r2-critical.js --out ~/backups/xololo

# Verificar el manifest
cat ~/backups/xololo/$(date +%Y-%m-%d)/manifest.json | jq '.summary'
```

El script:
- Lista objetos bajo cada prefijo configurado (`operators/`, `ai-metrics/`, `legal-docs/`).
- Descarga cada objeto a `~/backups/xololo/YYYY-MM-DD/<key>`.
- Genera `manifest.json` con tamaño + sha256 por archivo.
- Exit code 2 si hubo errores.

**Cadencia recomendada:** semanal (lunes). Guardar en laptop del CEO + copia en Google Drive privado. **Nunca commitear** (`backups/` está en `.gitignore`).

### 9.3 Restaurar

Para restaurar un archivo específico (ej. operators/directory.json corrupto):

```bash
# Opción A — subir via AWS CLI compatible
aws s3 cp ~/backups/xololo/2026-10-20/operators/directory.json \
  s3://xololo-prod/operators/directory.json \
  --endpoint-url=$R_ENDPOINT

# Opción B — via Cloudflare dashboard: R2 → bucket → upload file.
```

### 9.4 Health check

```bash
# Desde el browser o curl (requiere operator session cookie)
curl https://xololo.mx/api/admin/system-health | jq
```

Response:

```json
{
  "status": "ok | degraded | down",
  "checkedAt": "2026-10-27T...",
  "checks": [
    { "name": "sharetribe_integration", "status": "ok", "latencyMs": 240 },
    { "name": "r2_operators_directory", "status": "ok", "latencyMs": 180 },
    { "name": "stripe", "status": "ok", "latencyMs": 150 },
    { "name": "skydropx", "status": "ok", "latencyMs": 420 },
    { "name": "anthropic", "status": "ok", "latencyMs": 310 },
    { "name": "algolia", "status": "ok", "latencyMs": 95 }
  ]
}
```

Correr en el health check diario (sección 3). Si cualquier dependencia reporta `fail`, investigar antes de 1h.

### 9.5 Escenarios de desastre

| Escenario | Impacto | Procedimiento |
|---|---|---|
| **R2 bucket corrupto** | operators/, legal-docs/, sos-photos/ perdidos | Restaurar desde último backup semanal. Legal-docs posiblemente irrecuperables si se perdieron >7 días. |
| **Sharetribe account suspendido** | Marketplace down total | Contactar Sharetribe support inmediato. Mientras tanto, página "en mantenimiento" en Render. |
| **Stripe account suspendido** | Pagos down | Contactar Stripe. Migrar a Conekta/PayPal tomaría ~2 semanas. |
| **Render down** | App down | Deploy de emergencia en Railway/Fly (template similar). ~4-8h. |
| **Dominio robado / DNS secuestrado** | Phishing + redirect | Contactar Cloudflare + registrador. Rotar OAuth secrets. Avisar a buyers. |
| **Leak masivo de secretos** | Fraude en vuelo | Rotar TODOS los secretos siguiendo SECURITY.md §2. Pausar payouts hasta investigar. |

---

## 10. Contactos y escalación

| Rol | Persona | Cuándo contactar |
|---|---|---|
| CEO | Enrique Arias | S0, decisiones de producto, proveedores |
| Jurídico | Ernesto Luna | Consultas legales, PROFECO, LFPDPPP |
| Contador | Ernesto (CP) | SAT, CFDI, facturación |
| Skydropx | Danael Galván (81 2435 4882) | Incidentes de carrier |
| Stripe | Soporte dashboard | Chargebacks masivos, revisiones de cuenta |
| Sharetribe | support@sharetribe.com | Caídas de API, bugs del platform |

---

*Mantenido por el equipo de ingeniería. Cambios estructurales (nuevos proveedores, procedimientos nuevos) requieren PR + review del CEO antes de merge.*
