# Xololo — Guía de Seguridad y Operación

**Última actualización:** 2026-10-27
**Audiencia:** operadores Xololo con acceso a producción.

---

## 1. Inventario de secretos

Todos los secretos viven en variables de entorno. Nunca commitear valores reales al repo (incluso en comentarios).

### 1.1 Secretos de infraestructura

| Variable | Dónde se usa | Tamaño mínimo | Impacto si se filtra |
|---|---|---|---|
| `SHARETRIBE_SDK_CLIENT_ID` | Sharetribe Marketplace SDK (público) | — | Bajo (no es secreto). |
| `SHARETRIBE_SDK_CLIENT_SECRET` | Trusted SDK (server-side) | — | **Alto**: permite llamadas privilegiadas. |
| `SHARETRIBE_INTEGRATION_CLIENT_ID` + `SHARETRIBE_INTEGRATION_CLIENT_SECRET` | Integration SDK (server-side) | — | **Crítico**: acceso total a cuentas, listings, transacciones. |
| `KEY_ID` + `R2_*` | Cloudflare R2 (fotos, assets) | — | Alto: lectura/escritura de bucket. |
| `STRIPE_SECRET_KEY` + `STRIPE_PUBLISHABLE_KEY` + `STRIPE_WEBHOOK_SECRET` | Pagos y Connect | — | **Crítico**: cobros, transferencias, refunds. |
| `ANTHROPIC_API_KEY` | Calls a Claude | — | Medio: gasto directo (~$0.01/call). |
| `ALGOLIA_ADMIN_API_KEY` | Index management | — | Alto: borrar/alterar índice. |
| `SKYDROPX_CLIENT_ID` + `SKYDROPX_CLIENT_SECRET` | Cotizaciones y guías | — | Alto: genera cargos reales. |
| `GOOGLE_CLIENT_SECRET` + `FACEBOOK_APP_SECRET` | OAuth login | — | Alto: suplantación. |
| `BASIC_AUTH_PASSWORD` | Protección básica staging | — | Medio: acceso a entorno pre-producción. |

### 1.2 Secretos rotables (admiten rotación sin downtime)

Estos secretos tienen una contraparte `*_SECRET_PREV` que, si está presente, el server la acepta al **verificar** firmas emitidas antes de la rotación. Al **firmar**, siempre usa el actual.

| Variable actual | Variable PREV | TTL de firmas | Uso |
|---|---|---|---|
| `XOLOLO_ADMIN_JWT_SECRET` | `XOLOLO_ADMIN_JWT_SECRET_PREV` | 8h (duración sesión operador) | JWT de sesión `/ops`. |
| `EVENT_TICKET_SECRET` | `EVENT_TICKET_SECRET_PREV` | 180 días | QR tickets de evento. |
| `SHIPPING_RATE_SECRET` | `SHIPPING_RATE_SECRET_PREV` | 30 min | HMAC de rates Skydropx. |
| `OPERATOR_SESSION_SECRET` | (fallback de los anteriores) | — | Fallback secret. |

---

## 2. Procedimiento de rotación de secreto

Aplica igual para `XOLOLO_ADMIN_JWT_SECRET`, `EVENT_TICKET_SECRET` y `SHIPPING_RATE_SECRET`.

### Paso 1: Generar nuevo secreto

```bash
openssl rand -hex 32
```

### Paso 2: Copiar valor actual a la variante PREV

En Render → Environment → agregar `<SECRET>_PREV` con el valor actual.

### Paso 3: Reemplazar actual por el nuevo

Actualizar `<SECRET>` al nuevo valor generado en el paso 1.

### Paso 4: Deploy

El server ahora firma con el nuevo y verifica con nuevo + previo (ambos aceptados).

### Paso 5: Esperar TTL

- `XOLOLO_ADMIN_JWT_SECRET_PREV`: esperar 8h (todas las sesiones nuevas usan el nuevo).
- `EVENT_TICKET_SECRET_PREV`: esperar 180 días (todos los tickets emitidos con PREV ya expiraron).
- `SHIPPING_RATE_SECRET_PREV`: esperar 30 min (todas las firmas ya caducaron).

### Paso 6: Eliminar PREV

Quitar `<SECRET>_PREV` de Render. Deploy.

### Cuándo rotar

- **Trimestral** como higiene básica.
- **Inmediato** si:
  - Un operador deja Xololo.
  - Hay sospecha de leak (log público, commit público, credential dump).
  - Un pentest encuentra exposición.

---

## 3. Estado de vulnerabilidades (snapshot 2026-10-27)

**Antes del fix:** 148 vulnerabilidades (10 Low, 54 Moderate, 79 High, 5 Critical).
**Después del fix:** 51 vulnerabilidades (9 Low, 24 Moderate, 18 High, **0 Critical**).

Las 5 Critical se resolvieron agregando `resolutions` en `package.json`:
- `proxy-addr` ≥ 2.0.8 (afectaba rate limiting por IP spoofing).
- `shell-quote` ≥ 1.11.0 (command injection en herramienta de desarrollo).
- `dompurify` ≥ 3.4.17 (bypass SAFE_FOR_TEMPLATES en jspdf).
- `brace-expansion` ≥ 2.1.5 (DoS por recursión).

Las vulnerabilidades High restantes son en su mayoría transitivas de dev dependencies (webpack-dev-server, jest). Dependabot abrirá PRs semanales (lunes 9 AM MX) para irlas atendiendo.

### Comandos útiles

```bash
# Correr audit local
yarn audit

# Solo criticas
yarn audit --level critical

# Ver cadena de dependencia
yarn why <package-name>

# Forzar resolution (en package.json)
"resolutions": {
  "<package>": "<version>"
}
```

---

## 4. Rate limiting (buckets configurados)

Configuración en `server/api-util/rateLimits.js`.

| Bucket | Ventana | Max requests | Endpoints |
|---|---|---|---|
| `payment` | 1 min | 10 | `/initiate-privileged`, `/transition-privileged` |
| `ai` | 5 min | 20 | `/ai/analyze-listing`, `/ai/suggest-listing-text`, `/seller-tax-ai-classify`, `/seller-listing-legality-check` |
| `auth` | 15 min | 5 | `/admin/auth/login`, `/admin/auth/bootstrap` |
| `ops` | 1 min | 30 | `/admin/*` (todo bajo router.use) |
| `shippingQuote` | 1 min | 30 | `/shipping-quote`, `/public-shipping-quote` |
| `generic` | 1 min | 60 | (reserve para endpoints futuros) |

Clave de rate: `user:<id>` si está autenticado, `ip:<ip>` si no. `trust proxy` activo en `server/index.js` para que `req.ip` venga de `x-forwarded-for` en Render.

### Para subir límites temporalmente

Si un seller legítimo pega con 429, buscar en logs `[rate-limit] bucket=... key=...` para saber qué bucket + clave. Si es patrón sostenido legítimo, subir el `max` del bucket específico y commitear.

---

## 5. HMAC guard de shipping rates

### Qué protege

Un atacante que edite `rate.total` en devtools antes del submit pagaría menos de lo que Skydropx nos cobra. El HMAC lo detecta.

### Flow

1. `getQuotationRates` firma cada rate con `signRate` usando `SHIPPING_RATE_SECRET`.
2. El cliente propaga `signature` + `signatureIssuedAt` tal cual al `/initiate-privileged`.
3. El server re-firma los campos recibidos con `verifyRateSignature` y usa `timingSafeEqual`.
4. Si falla, `throw statusCode=400 reason: signature_mismatch | signature_expired | missing_signature`.
5. TTL 30 minutos para evitar replay con cotizaciones viejas.

### Rollout seguro actual

Si llega un rate SIN signature (cliente viejo que no actualizó), el server deja pasar + log warn. Convertir a hard-fail cuando logs de producción muestren 0 warns por 1-2 semanas.

### Dónde está el código

- `server/api-util/skydropx.js` → `signRate` + `verifyRateSignature`.
- `server/api/initiate-privileged.js` → verifica antes de persistir el rate (v2 skydropxCarrier + legacy carrier).
- Tests: `server/api-util/skydropx.rateSignature.test.js` (10 casos).

---

## 6. Incident response (si crees que hay un leak)

### Si se filtra un secreto

1. **Rotar inmediatamente** el secreto afectado (ver sección 2).
2. Revisar logs de Render de los últimos 90 días por accesos sospechosos a endpoints que usan ese secreto.
3. Si es `STRIPE_SECRET_KEY` o `SHARETRIBE_INTEGRATION_CLIENT_SECRET`: también rotar en el dashboard del proveedor (invalida el viejo).
4. Notificar a Enrique por el canal privado — no por email ni Slack público.

### Si se filtra data de usuario

1. Determinar alcance (qué usuarios, qué campos).
2. Si incluye emails, direcciones o teléfonos: notificar a los afectados en < 72 h (plazo LFPDPPP).
3. Preparar reporte INAI (si aplica el umbral).
4. Preservar logs y evidencia.

### Si hay fraude detectado en tiempo real

1. Suspender la cuenta del atacante vía `/ops/users` → `suspend`.
2. Si hay dinero en tránsito: pausar los payouts del seller afectado desde `/ops/payout-queue`.
3. Documentar en el ticket interno.
4. Si > $5,000 MXN: avisar a Stripe desde el dashboard (riesgo de chargeback masivo).

---

## 7. Dependabot

Config: `.github/dependabot.yml`.

- Scan semanal (lunes 9 AM MX).
- Agrupa minor + patch en 1 PR para no ruido.
- Major updates: PRs individuales (requieren review).
- Ignora `sharetribe-flex-sdk` y `sharetribe-flex-integration-sdk` — se actualizan a mano porque pueden romper transaction processes.

---

## 8. Lo que todavía NO está (pendientes P2+)

- [ ] 2FA opcional en login de buyers/sellers (hoy solo en operadores).
- [ ] Sentry PII filter (ver docs/OPERATIONS.md).
- [ ] WAF/CDN en Render (Cloudflare pro o similar).
- [ ] Pentest externo (recomendado para el año que viene).
- [ ] Backup verificado del Postgres de operators (hoy solo manual).
- [ ] SOC 2 / ISO 27001 — fuera de alcance 2026.

---

*Doc mantenido por el equipo de ingeniería Xololo. Para cambios estructurales (nuevos buckets, nuevos secretos, procedimientos nuevos), abrir PR y pedir review al CEO antes de merge.*
