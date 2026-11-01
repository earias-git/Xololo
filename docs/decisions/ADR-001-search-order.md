# ADR-001: Orden del motor de búsqueda

Fecha: 2026-11-01
Status: **ACTIVA**
Owner: @earias
Supersede: n/a

## Decisión

El flujo de `/api/search` es, en orden estricto:

1. **Algolia** (siempre, barato, cubre ~90%).
2. **Sharetribe `listings.query({ keywords: q })`** si Algolia dio ≤ 2 hits
   Y la query es SIMPLE (1-2 palabras literales, sin palabras-intento).
3. **IA (Haiku `interpretQuery`)** SOLO si:
   - Query es compleja (3+ palabras con `para`, `con`, `cerca`, `regalo`,
     `busco`, `quiero`, `necesito`), **O**
   - Palabra única inusual (regionalismo) sin match literal en top-hit.
   - **Y Sharetribe no rescató resultados previamente.**
4. Last-resort Sharetribe si todo lo anterior falla.
5. Enriquecer `coverUrl` faltante con `isdk.listings.show` batch (hasta 20).

**Decisión clave**: para query simple de 1-2 palabras literales
(`cerdo`, `mezcal`, `velero`), **IA nunca se dispara**. El flujo
cuesta **$0 de tokens**.

## Contexto

- 2026-11-01: el usuario reportó que buscar `cerdo` devolvía resultados
  irrelevantes (traje de baño, jarrón, orquídeas). El listing "T-Bone de
  cerdo" existía pero no estaba indexado en Algolia.
- El fix previo (commit `33615d770`) había puesto el fallback de
  Sharetribe **después** de la IA — con lo que IA consumía tokens para
  interpretar una palabra literal que podía encontrarse barato en la BD.
- Alternativas descartadas:
  - **Sólo Algolia + IA sin BD**: perdemos listings no indexados.
  - **Sólo BD sin Algolia**: Algolia resuelve ~90% en 50ms y filtra
    `state:published` + `NOT moderation:block` sin trabajo adicional.
  - **IA siempre**: inflama costos sin ganancia marginal para queries
    simples.

El usuario explicitó: *"debemos cuidar el gasto de tokens"*.

## Casos de prueba (golden paths)

Verificados en `server/smoke/search.smoke.test.js`:

- `cerdo` → encuentra "T-Bone de cerdo" con `usedAi: false`.
- `mezcal` → encuentra "Mezcal artesanal" con `usedAi: false`.
- `mar` → covers reales en todos los hits (no "Sin imagen").
- `algo para regalo artesanal` → `usedAi: true` (query compleja — vale
  la pena IA).

## Blindaje

- **Smoke test**: [`server/smoke/search.smoke.test.js`](../../server/smoke/search.smoke.test.js)
- **Código marcado LOCKED** en: [`server/api/search.js`](../../server/api/search.js) · bloque principal del handler
- **Memoria del agente**: `feedback-search-order.md`
- **Commits de referencia**:
  - `ed88318f7` — reorden Algolia → BD → IA (este orden).
  - `33615d770` — fix previo (ya corregido por el anterior).

## No modificar sin

- Re-leer este ADR y la [memoria asociada].
- Confirmar explícitamente con el usuario que la nueva reorganización
  es intencional, no una "optimización" sin consentimiento.
- Correr el smoke test — debe quedar verde.
- Si la nueva propuesta cambia el orden, actualizar este ADR con un
  SUPERSEDED-BY-NNN y crear el ADR-NNN correspondiente.
