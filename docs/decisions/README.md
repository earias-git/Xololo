# Architecture Decision Records (ADRs)

Decisiones de arquitectura y producto que **no deben modificarse sin
aprobación explícita del usuario**. Cada ADR documenta:

- La decisión en una línea.
- Por qué (contexto + alternativas descartadas).
- Casos de prueba que la verifican (smoke tests).
- Dónde vive el código afectado (con comentarios `XOLOLO LOCKED`).

## Patrón de blindaje contra regresiones

Al tomar una decisión aprobada, se montan 4 capas que se refuerzan
entre sí (si una falla, las otras agarran):

1. **ADR** acá en `docs/decisions/` — documento humano.
2. **Smoke test** en `server/smoke/*.smoke.test.js` — pre-commit automático.
3. **Memoria auto del agente** — el asistente lo lee en futuras sesiones.
4. **Comentario `XOLOLO LOCKED`** en el código al inicio del bloque crítico.

Un agente IA (como Claude Code) debe:
- **Leer el ADR correspondiente** antes de reorganizar código marcado LOCKED.
- Si una propuesta altera la decisión, **PARAR y confirmar con el usuario**.
- Los smoke tests deben quedar verdes después de cualquier cambio.

## ADRs activos

| ID | Decisión | Status |
|---|---|---|
| [ADR-001](ADR-001-search-order.md) | Orden del motor de búsqueda: Algolia → Sharetribe → IA | ACTIVA |

## Formato de un nuevo ADR

```md
# ADR-NNN: título corto

Fecha: YYYY-MM-DD
Status: ACTIVA | SUPERSEDED-BY-NNN | DEPRECATED
Owner: @usuario

## Decisión

Una línea con la decisión.

## Contexto

Qué problema se estaba resolviendo. Qué alternativas se consideraron
y por qué se descartaron.

## Casos de prueba (golden paths)

- Caso 1 → resultado esperado.
- Caso 2 → resultado esperado.

## Blindaje

- Smoke test: `server/smoke/XXX.smoke.test.js`
- Código marcado LOCKED en: `path/to/file.js:LN`
- Memoria del agente: `feedback-XXX.md`

## No modificar sin

- Re-leer este ADR.
- Confirmar explícitamente con el usuario.
- Mantener smoke test verde.
```
