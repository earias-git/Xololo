# DASHBOARDS V1 — Xololo Analytics

> Fuente de verdad para todo lo relacionado a dashboards, tracking de
> eventos, reportes y analytics en Xololo. Complementa a `LOGISTICS_V1.md`.
>
> **Estado:** borrador de trabajo. Cada sección tiene marcas 🟢 (decidido),
> 🟡 (default propuesto, validar), 🔴 (abierto, definir).
>
> **Última edición:** 2026-09-22

---

## 0. TL;DR

Xololo v1 tendrá **cuatro audiencias de analytics**, servidas por
componentes reutilizables sobre el mismo data pipeline:

| # | Audiencia | Ruta | Estado hoy |
|---|-----------|------|------------|
| 1 | **Seller** | `/dashboard` | 🟢 Base funcional en producción (Bloque A) |
| 2 | **Buyer** | `/dashboard/orders` | 🔴 Pendiente diseño y planning |
| 3 | **Ops Xololo** (interno) | `/admin` | 🔴 Pendiente gating y planning |
| 4 | **Public store analytics** | Widget en `{slug}.xololo.mx` | 🔴 Pendiente diseño |

Cada audiencia consume del mismo backend de **tracking de eventos** (§4)
y **queries agregadas** (§5).

---

## 1. Principios de diseño

- **No decidir antes de medir.** Cada widget existe porque responde una
  pregunta que el usuario se hace hoy. Nada de charts "porque quedan
  bien".
- **Data honesta sobre lo que ves.** Si estamos mostrando sólo las
  últimas 500 ventas cargadas, decirlo. Un asterisco es más barato que
  una decisión mal tomada.
- **Fase progresiva.** v1 usa las estructuras más simples (metadata,
  cache in-memory). v2 promueve a DB/agregación cuando el volumen lo
  amerite. Migración con script.
- **Reusabilidad.** El mismo KpiCard, ChartBar, DataTable sirve para
  seller, buyer, ops. Nadie re-implementa.
- **Progresivo, no bloqueante.** El seller puede vender sin dashboards.
  Los dashboards son leverage, no gate.

---

## 2. Fase 1 — SELLER dashboard 🟢

**Objetivo:** el seller entiende su negocio (ventas, productos, tráfico)
sin salir de Xololo.

### 2.1. Ruta y layout 🟢

Ruta `/dashboard` con `LayoutSideNavigation`. Side-nav con secciones:

```
📊 Ventas             ← activo por default
🛍  Productos
📈 Tráfico
📥 Reportes
```

Cada sección es un `<Tab>` que renderiza distinto content en el main
area. Las 3 primeras comparten el filtro de período (top-right, sticky
al scroll en desktop). Reportes tiene su propia UI.

### 2.2. Ventas (§Bloque A — HECHO) 🟢

**Ya funcional en producción:**

- Filtros de período: Este mes / Mes anterior / Últimos 3 meses / Este
  trimestre / Este año / Últimos 12 meses.
- Selector de granularidad: Auto (día si <60d, semana si <180d, mes si
  más) / Día / Semana / Mes.
- **KPI hero (5 cards):**
  - Ventas totales (MXN)
  - Pedidos
  - Ticket promedio
  - Comisión Xololo
  - Neto para ti
- **Gráfica de barras** (Recharts, lazy) con ventas por bucket +
  tooltip custom.
- **Tabla desglose** con totales al pie.

**Ampliaciones planeadas:**

- 🟡 **Rango personalizado** (date pickers "desde" / "hasta") además
  de los presets.
- 🟡 **Comparativa vs período anterior**: cada KPI muestra flecha +
  %vs el período previo del mismo tamaño.
- 🟡 **Alternar gráfica**: switch entre "Ventas MXN", "# pedidos" y
  "Ticket promedio" sobre el mismo bucketing.
- 🔴 **Segmentación por canal de origen**: cuando existan datos de
  tracking (§4), la gráfica se puede filtrar / stackar por source
  (direct / xololo / facebook / etc.).

### 2.3. Productos (§Bloque B) 🔴 planning

Sección con 3 tablas / widgets:

**A. Top products by sales** (bucketing por período seleccionado):
- Columnas: producto (thumbnail + título), unidades vendidas, revenue,
  % del total.
- Ordenamiento: revenue desc (default), unidades, % (togglable).
- Top 10 con "Ver todos" hacia una vista completa paginada.

**B. Top products by views** (requiere tracking — §4):
- Columnas: producto, views, adds-to-cart, ventas, **conversion rate**
  (ventas / views).
- Filtro por source: All / direct / xololo / seller_store / facebook /
  instagram / whatsapp.
- El conversion rate es el más valioso — dice qué producto convierte
  mejor por canal.

**C. Alertas de catálogo:**
- **Low stock** (stock ≤ 3): riesgo de perder ventas por agotamiento.
- **Sin actualizar > 90 días**: candidatos a refresh de fotos/precio.
- **Sin ventas > 60 días con views > 0**: producto tiene tráfico pero
  no convierte — sugiere revisar precio, fotos o descripción.
- **Sin views ni ventas > 30 días**: candidatos a despublicar.

**Endpoints server necesarios:**

- `GET /api/seller-catalog-insights` — devuelve
  `{ topBySales, topByViews, lowStock, stale, deadStock }` en un solo
  round-trip. Cache 5min.

### 2.4. Tráfico (§Bloque C) 🔴 planning

Requiere tracking de eventos activo (§4). Sección con:

**A. Sources overview** (donut / stacked bar):
- Distribución de views totales por source en el período.
- Sources: `direct`, `xololo` (buscador interno), `seller_store`
  (subdominio del seller), `facebook`, `instagram`, `whatsapp`,
  `other`.

**B. Tabla source × KPI:**
- Filas: sources.
- Columnas: views, adds-to-cart, checkouts iniciados, ventas
  confirmadas, conversion %.
- Ordenable por cualquier columna.

**C. Timeline de tráfico:**
- Gráfica de línea con views por bucket, líneas separadas por source.

**D. Top-referring URLs** (v2):
- Si el referrer trae path/query, mostrar top URLs específicas de
  Facebook / Instagram. Ayuda al seller a saber qué post generó
  tráfico.

### 2.5. Reportes (§Bloque D) 🔴 planning

**A. CSV descargable** 🟡 (recomendado para v1):
- Botón "Exportar CSV" en la sección Ventas.
- Contiene: todas las tx del período con columnas expandidas (id, fecha
  pagado, cliente, producto, cantidad, subtotal, envío, comisión,
  neto, estado, tracking).
- Formato español (separador `,`, encoding UTF-8 BOM para Excel MX).

**B. Email mensual automático** 🟡 (recomendado para v1):
- Cron que corre el día 1 de cada mes a las 08:00 CDMX.
- A cada seller con ≥1 venta el mes anterior le envía:
  - Resumen: total, # pedidos, top 3 productos, % vs mes previo.
  - Link al dashboard con filtro pre-seleccionado en "Mes anterior".
- Template dual-brand (mismo que las demás notificaciones).

**C. PDF-ready print** 🔴 (dejar para v2):
- Estilos `@media print` en /dashboard para imprimir como reporte.
- Overkill para v1 — un CSV cubre 90% de los casos.

### 2.6. Roadmap Fase 1 (SELLER)

| Sprint | Entrega |
|--------|---------|
| ✅ hoy | Ventas — base funcional (Bloque A) |
| Sprint 1 | Ampliaciones Ventas: rango custom + comparativa período previo |
| Sprint 2 | Tracking de eventos (§4) — base |
| Sprint 3 | Productos (§2.3): top-sales + low-stock + stale (sin depender de tracking) |
| Sprint 4 | Tráfico (§2.4): sources overview + tabla source×KPI |
| Sprint 5 | Productos con tracking: top-views + conversion |
| Sprint 6 | Reportes: CSV + cron mensual |

---

## 3. Fases 2-4 — resto de audiencias 🔴 planning

### 3.1. BUYER dashboard

Ruta propuesta: `/dashboard/orders` (o mantener `/inbox/orders` y
enriquecerlo — a definir).

**Widgets propuestos** (validar prioridades):
- **En tránsito** (hero): cards horizontales con producto + tracking
  visible + días estimados. Link al carrier.
- **Llegan esta semana**: subset de en-tránsito con ETA ≤ 7 días.
- **Reviews pendientes**: pedidos entregados sin review — recordatorio
  + botón directo al survey.
- **Buy again**: últimas 5 tiendas donde compró + acceso rápido a sus
  productos.
- **Wishlist** (requiere feature aparte de guardar favoritos): productos
  guardados con cambios de precio destacados.
- **Tarjetas guardadas**: gestión de payment methods Stripe.
- **Historial completo** filtrable por seller, fecha, estado.

**Server:** endpoint `/api/buyer-dashboard` similar a
`/api/seller-analytics` pero con `only: 'order'`.

### 3.2. OPS Xololo (interno)

**Gating:** ruta `/admin` protegida por env var `XOLOLO_ADMIN_EMAILS`
(coma-separada). Server-side middleware verifica que el email del user
logueado esté en la lista antes de servir data.

**Secciones propuestas** (validar):
- **Health del marketplace:** GMV mensual, # sellers activos, #
  transacciones, ARR proyectado, funnel view→sale global.
- **Disputas activas:** todas las tx con `xololoDispute` — triage
  interno. Botones para "resolver a favor buyer" / "resolver a favor
  seller" / "pedir info".
- **Sellers destacados:** ranking mensual (revenue), acceso rápido a
  perfiles.
- **Nuevos sellers sin primera venta:** para outreach o coaching.
- **Alertas de plataforma:** órdenes >48h sin guía, guías rechazadas
  por Skydropx, webhook fallando, etc.
- **Payouts:** cuánto se le debe a cada seller (v2, cuando entre
  Stripe Connect real).

### 3.3. Public store analytics

Widget público en la home de la tienda `{slug}.xololo.mx`. Muestra al
buyer casual "prueba social" del seller:

- **Productos vendidos totales** (número entero, formato "1,247
  vendidos").
- **Ventas activas del mes** (opcional — validar si es privado).
- **Rating promedio** + # de reviews (cuando existan).
- **Tiempo promedio de despacho** (ej. "Envía en 1.5 días
  promedio").
- **Sellado "Vendedor verificado Xololo"** cuando el seller cumple X
  criterios (verified headquarter + ≥5 ventas + rating ≥4.5).

**Riesgo a discutir:** compartir métricas públicas puede desincentivar
sellers nuevos (0 vendidos se ve mal). Solución: sólo mostrar cuando el
seller lleva ≥N ventas. `N=5` propuesto.

---

## 4. Tracking de eventos (transversal) 🟡

**Decisión default:** trackear los 5 eventos siguientes desde v1.
Validar en review.

| Evento | Trigger | Data mínima |
|--------|---------|-------------|
| `listing.viewed` | Buyer entra a `/l/:slug/:id` | listingId, source, sessionId, userId? |
| `listing.added_to_cart` | Click en "Agregar al carrito" | listingId, quantity, source de la vista actual |
| `checkout.started` | Buyer llega a `/l/:slug/:id/checkout` | listingId, cartTotal |
| `checkout.completed` | Ya lo tenemos (Sharetribe tx pagada) | (implícito) |
| `listing.shared_external` | Click en botón "Compartir" con canal | listingId, channel (`whatsapp`/`facebook`/`instagram`/`copy_link`) |

### 4.1. Detección de source (client-side)

```
function detectSource() {
  // 1. UTM params ganan siempre.
  const utm = new URLSearchParams(location.search).get('utm_source');
  if (utm) return normalizeUtm(utm);

  // 2. Referrer del browser.
  const ref = document.referrer;
  if (!ref) return 'direct';
  const host = new URL(ref).hostname.toLowerCase();

  if (/facebook\.com|fb\.com|m\.facebook/.test(host)) return 'facebook';
  if (/instagram\.com/.test(host)) return 'instagram';
  if (/whatsapp\.com|wa\.me/.test(host)) return 'whatsapp';
  if (/t\.co|twitter\.com|x\.com/.test(host)) return 'twitter';
  if (/tiktok\.com/.test(host)) return 'tiktok';
  if (/google\.|bing\.|duckduckgo\./.test(host)) return 'search';

  if (host.endsWith('.xololo.mx')) return 'seller_store';
  if (host === 'xololo.mx' || host === 'www.xololo.mx') return 'xololo';

  return 'other';
}
```

### 4.2. Dedupe

- **Session:** cada view/add-to-cart se registra **una vez por sesión**
  por listing. Session key en sessionStorage.
- **Bots:** filtrar user-agents comunes de bots server-side antes de
  contar.
- **Rate limit:** máximo 60 events / min / IP.

### 4.3. Endpoint receiver

```
POST /api/track/event
Body: {
  event: 'listing.viewed' | 'listing.added_to_cart' | ...
  listingId: uuid
  source?: string
  channel?: string  // sólo para shared_external
  sessionId: string
}
→ 200 { ok: true }
→ 429 { error: 'rate_limited' }
```

- Público (buyer no autenticado también trackea).
- Async: al recibir, encola y responde 200 inmediato. El proceso de
  agregación puede retrasarse sin afectar UX.

---

## 5. Storage & queries 🟡

**Decisión default: v1 empieza con metadata del listing, con shape
compatible con futuro schema DB.**

### 5.1. Shape en metadata

Cada listing acumula en `listing.metadata.xololoAnalytics`:

```json
{
  "totals": {
    "views": { "direct": 0, "xololo": 0, "seller_store": 0, "facebook": 0, "instagram": 0, "whatsapp": 0, "twitter": 0, "tiktok": 0, "search": 0, "other": 0 },
    "adds_to_cart": { ... },
    "checkouts_started": { ... },
    "shares": { "whatsapp": 0, "facebook": 0, "instagram": 0, "copy_link": 0 }
  },
  "byDay": {
    "2026-09-22": {
      "views": { "direct": 3, "whatsapp": 5, "facebook": 2 },
      "adds_to_cart": { "whatsapp": 1 },
      "checkouts_started": { "whatsapp": 1 },
      "shares": { "whatsapp": 2 }
    },
    ...
  },
  "updatedAt": "2026-09-22T14:30:00Z"
}
```

- `byDay` mantiene los últimos **90 días** — cada write recorta lo
  viejo. Reduce el tamaño a algo razonable en metadata (~30KB max por
  listing con tráfico alto).
- `totals` es acumulado histórico (persiste más allá de 90d).

### 5.2. Escritura

- Un job **agregador** corre cada 5 min: lee la queue de eventos y
  hace un `updateMetadata` por listing con lo acumulado del período
  (evita golpear Integration API por cada view).
- Queue en memoria del proceso — se pierde si el server reinicia.
  Aceptable para v1 (worst case: perdemos 5 min de tracking).
- v2: queue durable (Redis / SQS / DB row).

### 5.3. Queries agregadas (para dashboards)

- **Top products by views/sales:** query paginada a
  `sdk.listings.query({ authorId, sort: '...' })` — pero Marketplace
  API **no permite sort por metadata**. Necesitaremos leer los
  listings del seller y ordenar client/server-side sobre el subset.
  Cap de 500 listings por request (perPage=100 × 5 páginas).
- **Sources overview:** sumar los `totals.views.{source}` de todos los
  listings del seller. Cache 5 min.
- **Bucketing por período:** para cada listing, sumar los días del
  rango en `byDay`. Iterar días × sources.

### 5.4. Migración futura a DB

v2 migra a Postgres con schema:

```sql
create table listing_events (
  id bigserial primary key,
  listing_id uuid not null,
  event varchar(32) not null,
  source varchar(16),
  channel varchar(16),
  session_id varchar(64),
  user_id uuid,
  occurred_at timestamptz not null default now()
);

create index on listing_events (listing_id, occurred_at desc);
create index on listing_events (event, occurred_at desc);
```

Script de migración: iterar `byDay` de todos los listings y hacer
`insert into listing_events` con eventos sintéticos (uno por (día,
event, source) con `count`). No es perfecto pero preserva agregados.

---

## 6. Reports & exports 🟡

### 6.1. CSV descargable (v1)

**Sección "Reportes" en /dashboard:**
- Botón "Descargar CSV del período".
- Formato: UTF-8 con BOM (`﻿`) para que Excel MX abra bien.
- Columnas:
  ```
  id, fecha_pago, cliente, producto, cantidad, subtotal_mxn,
  envio_mxn, comision_xololo_mxn, neto_seller_mxn, estado,
  tracking, source_de_origen
  ```

**Server:** endpoint `GET /api/seller-analytics/export?from&to&format=csv`
que devuelve `Content-Type: text/csv` con `Content-Disposition:
attachment`.

### 6.2. Email mensual (v1)

- Cron nuevo en `server/jobs/monthly-report.js`.
- Corre día 1 de cada mes 08:00 CDMX (`0 8 1 * *`).
- Para cada seller con ≥1 venta el mes anterior:
  - Genera el resumen con `seller-analytics` filtrado al mes previo.
  - Renderiza template dual-brand (`renderEmailHtml`) con:
    - Ventas totales, # pedidos.
    - Comparativa vs 2 meses antes.
    - Top 3 productos.
    - CTA "Ver dashboard completo".
- Dispara vía Resend (mismo pipeline que las notifs D.9).

### 6.3. PDF-ready (v2)

Skip por ahora. Si algún día lo necesitamos, `@media print` en el CSS
del dashboard + botón "Imprimir".

---

## 7. Gating y permisos

| Ruta | Auth requerido | Rol | Notas |
|------|----------------|-----|-------|
| `/dashboard` | Sí | Seller (any) | Todos ven sus propios datos |
| `/dashboard/orders` | Sí | Buyer (any) | Todos ven sus propios pedidos |
| `/admin` | Sí | Ops Xololo | Gate por email en `XOLOLO_ADMIN_EMAILS` |
| Widget público store | No | — | Solo métricas no sensibles |

**Endpoints server:**
- `/api/seller-analytics`, `/api/seller-catalog-insights`,
  `/api/seller-analytics/export`: user logueado, sólo devuelven data del
  user que llama.
- `/api/admin/*`: gate server-side por email admin.
- `/api/track/event`: público, rate-limited.

---

## 8. Componentes reutilizables

Para que las 4 audiencias no se hagan a mano, extraer a
`src/components/`:

| Componente | Uso |
|------------|-----|
| `KpiCard` | Card de KPI (label + valor + hint + tone) |
| `PeriodFilter` | Chips presets + selector granularidad |
| `MetricChart` | Bar/line chart Recharts con tooltip custom |
| `DataTable` | Tabla con sort, filas resaltables, totals row |
| `SourcePill` | Chip para mostrar source con icono y color consistente |
| `EmptyState` | Vacío consistente (icono + mensaje) |

---

## 9. Roadmap consolidado (v1)

| # | Sprint | Bloque | Notas |
|---|--------|--------|-------|
| 1 | ✅ hoy | Seller · Ventas base | En prod |
| 2 | próx. | Seller · Ampliaciones Ventas | Rango custom + comparativa |
| 3 | | Tracking · Infra base | Endpoint + hook + storage metadata |
| 4 | | Seller · Productos (sin tracking) | Top-sales + low-stock + stale |
| 5 | | Seller · Productos (con tracking) | Top-views + conversion |
| 6 | | Seller · Tráfico | Sources overview + tabla + timeline |
| 7 | | Reportes · CSV + email mensual | Cron + export endpoint |
| 8 | | Buyer dashboard | Widgets en /dashboard/orders |
| 9 | | Ops Xololo `/admin` | Gate + health del marketplace + disputas |
| 10 | | Public store widget | En {slug}.xololo.mx |

---

## 10. Preguntas abiertas 🔴

1. **UTMs propios** — ¿generamos links con UTMs desde el botón de
   compartir del seller para atribución precisa (ej. `?utm_source=whatsapp&utm_medium=share&utm_campaign=jarron_negro`)?
   Recomendado sí.

2. **Wishlist / favoritos** — es feature aparte del dashboard. ¿Entra
   en v1 o v2?

3. **Seller de múltiples tiendas** — un user puede tener varios
   listings pero ¿varias tiendas/subdominios distintos? Actualmente
   1:1. Confirmar.

4. **Comparativas históricas** — ¿hasta cuánto atrás? Hoy tenemos
   límite de 24 meses en `seller-analytics`. ¿Suficiente?

5. **Currency** — todo MXN por ahora. Si en algún momento entra otra
   moneda, agregar conversion y decir en qué moneda se muestra cada
   KPI.

6. **Fraud analytics** — # de intentos de pago fallidos por listing,
   sellers con % anormalmente alto de disputas, etc. Interesante para
   ops pero muy avanzado. v2+.

7. **Sellers con Google Analytics propio** — ¿damos la opción de que
   inyecten su GA tag en su subdominio? Complementa nuestros dashboards
   con su vista.

---

## 11. Cambios a este documento

- **2026-09-22:** creación inicial. Bloque A (Seller · Ventas base) ya
  desplegado.
