# Taxonomía del Sector Verde — draft para validación con OPF

Fecha: 2026-11-18
Status: **BORRADOR — pendiente validar con sellers OPF**
Owner: @earias
Relacionado: [ADR-006](decisions/ADR-006-categorization-and-communities.md)

## Propósito

Este documento define la propuesta inicial de taxonomía primaria,
servicios, facetas y tratamiento fiscal para el Sector Verde,
siguiendo el modelo de 3 capas del ADR-006.

**No es implementación; es alineamiento**. Se comparte con:
- Sellers piloto de OPF (viveros, floristas, arboricultores) para
  validar nombres y jerarquía.
- Contador especializado agrícola para confirmar fiscal.
- Asesor estratégico para validar cobertura.

## Capa 1 — Categoría primaria

El Sector Verde cruza **dos ramas** de la taxonomía primaria de
Xololo:

### Rama Hogar (uso ornamental / decorativo)

```
hogar.jardineria
├── plantas-de-interior
│   ├── follaje              (pothos, filodendros, zamioculca)
│   ├── floracion            (anturios, orquídeas de interior)
│   ├── suculentas-y-cactus
│   ├── palmeras-de-interior
│   └── bonsai
├── plantas-de-exterior
│   ├── arboles-ornamentales
│   ├── arbustos-ornamentales
│   ├── trepadoras
│   ├── cubresuelos-y-pasto
│   └── setos-y-coniferas
├── flores-de-corte
│   ├── temporada
│   ├── rosas
│   └── exoticas
├── semillas-ornamentales
├── insumos-para-jardineria   (no-agricolas)
│   ├── sustratos-y-tierra    (para maceta decorativa)
│   ├── abonos-y-fertilizantes-ornamentales
│   ├── control-de-plagas-domestico
│   └── riego-para-jardin
└── accesorios-de-jardin
    ├── macetas-y-floreros
    ├── herramientas-de-jardin
    ├── iluminacion-de-jardin
    └── decoracion
```

### Rama Alimentos / Agricultura (uso productivo / comestible)

```
alimentos.agricultura
├── frutas-frescas
├── verduras-y-hortalizas
├── hierbas-aromaticas-frescas
├── plantulas-comestibles         (de cultivo: tomate, chile, lechuga)
├── plantulas-y-arboles-frutales  (para huerto productivo)
└── semillas-agricolas            (certificadas para cultivo)

alimentos.insumos-agricolas
├── fertilizantes-agricolas       (tasa 0% Art. 2-A)
├── plaguicidas-y-herbicidas-agricolas
├── sustratos-agricolas
├── mallas-y-plasticos
└── maquinaria-y-herramientas-agricolas
```

### Rama Servicios (nueva o ampliación de la existente)

```
servicios.jardineria
├── mantenimiento-regular         (poda rutinaria, riego, abono)
├── diseño-de-jardines            (paisajismo residencial)
├── instalacion-de-jardin         (siembra, nivelación, riego por goteo)
└── restauracion-de-jardines

servicios.arboricultura
├── poda-de-arboles
├── derribo-controlado
├── evaluacion-fitosanitaria
├── trasplante-de-arboles
└── chipping-y-triturado

servicios.floristeria
├── arreglos-y-bouquets
├── decoracion-de-eventos
├── arreglos-recurrentes          (oficinas, hoteles)
└── talleres-de-floristeria

servicios.agricultura-y-horticultura
├── consultoria-tecnica-agricola
├── analisis-de-suelo
├── control-de-plagas-profesional
├── instalacion-de-invernaderos
└── capacitacion-y-cursos
```

## Capa 2 — Facetas del Sector Verde

Todas opcionales salvo `fiscal`. Un listing puede combinar
cualquiera. Ver [ADR-006](decisions/ADR-006-categorization-and-communities.md#capa-2--facetas)
para el shape completo.

### Facetas comunes (productos y servicios)

| Faceta | Valores | Aplica a |
|---|---|---|
| `sector` | verde, agricola | Todos |
| `uso` | ornamental, comestible, medicinal, industrial | Productos principalmente |
| `canal` | menudeo, mayoreo, ambos | Productos |
| `origen` | cultivo-propio, reventa, importado | Productos |
| `fiscal` | tasa-16, tasa-0-art-2a, exento-art-9, exento-9-iv-usado | **Obligatoria** |

### Facetas específicas de plantas

| Faceta | Valores | Para qué |
|---|---|---|
| `clima` | interior, exterior-templado, exterior-calido, exterior-frio | Buyer filtra según su zona |
| `cuidado` | bajo, medio, alto | Novato vs. jardinero experto |
| `cultivo` | organico, convencional, hidroponico | Programa Alimentos Orgánicos |
| `valor_agregado` | ninguno, maceta, arreglo, sembrada-en-sitio | **Base de la sugerencia fiscal** |
| `tamaño_envase` | bolsa-negra, maceta-pequena, maceta-mediana, maceta-grande, árbol | Logística y precio |

### Facetas específicas de servicios del sector verde

| Faceta | Valores |
|---|---|
| `modalidad` | presencial, remoto, mixto |
| `cobertura` | hasta-10km, hasta-25km, hasta-50km, regional, nacional |
| `frecuencia` | unico, semanal, quincenal, mensual, trimestral |
| `escala` | residencial, comercial, industrial, municipal |
| `certificaciones` | podador-certificado, isa-arborist, perito-agricola, organico-certificado, paisajismo-mx |

### Facetas de entrega (ya existen en Shipping V2)

| Faceta | Valores |
|---|---|
| `entrega` | recoger-en-vivero, entrega-local-fija, skydropx, flete-personalizado |

## Capa 3 — Comunidad OPF

Primera comunidad sectorial oficial. Pertenencia del seller.

```
community {
  id:    "opf"
  type:  "sectorial"
  name:  "OPF – Sector Verde"
  slug:  "opf"
  description:
    "Comunidad fundacional de Xololo con 13 años de trayectoria.
     Agrupa viveros, productores, floristas, paisajistas y
     comerciantes del sector verde en México."
  branding: {
    logoUrl: (TODO: subir logo histórico OPF)
    heroUrl: (TODO: foto representativa)
    primaryColor: (TODO: color institucional OPF)
    bylaws:
      "OPF nació en 2013 como red del Prof. ... para conectar
       productores del sector verde con compradores institucionales
       y particulares. En 2026 se integra a Xololo como primera
       vertical comercial."
  }
  admins: [ (TODO: definir admins iniciales — @earias + Prof. ...) ]
  membership: "open"            // abierta sin aprobación previa
  requires_certification: false  // no requiere credenciales para V1
}
```

**URL**: `https://xololo.mx/comunidad/opf`

## Fiscal — tabla operativa (pendiente validar con contador)

### Regla simplificada para el seller

**Planta sin valor agregado** (bolsa negra, directa del productor,
sin maceta decorativa ni arreglo ni servicio de siembra):
→ **Exenta Art. 9 fracc. IV LIVA** (default sugerido)

**Planta con valor agregado** (maceta decorativa, arreglo,
sembrada en el jardín del buyer):
→ **16%** (default sugerido)

**Alimentos frescos no procesados** (hortalizas, hierbas
aromáticas, frutas de temporada):
→ **Tasa 0% Art. 2-A fracc. I inciso a) y b)** (default sugerido)

**Semillas certificadas para la agricultura**:
→ **Tasa 0% Art. 2-A fracc. I inciso g)** (default sugerido)

**Fertilizantes, plaguicidas y herbicidas agrícolas**:
→ **Tasa 0% Art. 2-A fracc. I inciso f)** (default sugerido)

**Invernaderos hidropónicos y equipos integrados**:
→ **Tasa 0% Art. 2-A fracc. I inciso g)** (default sugerido)

**Servicios de jardinería, arboricultura, floristería**:
→ **16%** (default; no hay excepción en Art. 2-A)

**Macetas, decoración, herramientas**:
→ **16%** (default)

### Disclaimer obligatorio en UI

Cuando el seller selecciona cualquier opción distinta a 16%, el
wizard muestra:

> La clasificación fiscal es responsabilidad del vendedor. Xololo
> registra tu declaración pero no asesora fiscalmente. En caso de
> revisión del SAT, debes poder sustentar que tu producto o
> servicio cumple con los requisitos del artículo que elegiste.
> Consulta a tu contador si tienes duda.

Y en el listing publicado, al buyer:

> Este producto se vende sin IVA porque el vendedor declaró
> [tasa 0% Art. 2-A] / [exento Art. 9]. Tu factura CFDI reflejará
> ese tratamiento.

### Preguntas pendientes para contador

1. ¿Las plantas ornamentales vendidas por productor directo
   (persona física régimen agrícola) caen en Art. 9 fracc. IV o
   siguen a 16%? Hay jurisprudencia dividida.
2. ¿Qué pasa cuando un vivero vende plantas con maceta de barro
   que él mismo produjo? ¿Es "valor agregado" fiscal o es un
   bundle de 2 productos (planta + maceta) con tratamientos
   distintos?
3. ¿Los servicios de siembra en el jardín del buyer son
   construcción (potencialmente otro régimen) o servicio
   profesional a 16%?
4. ¿Las semillas ornamentales (vs. agrícolas) caen en qué
   categoría? El inciso g) dice "destinadas a la agricultura" —
   ¿qué pasa con las de ornato?
5. ¿Qué documentación debe conservar el vendedor para sustentar
   el Art. 9 fracc. IV en caso de revisión?
6. ¿La plataforma (Xololo) tiene alguna obligación de retención
   o información cuando el seller declara exento?

## Qué sigue

1. Compartir este documento con 3-5 sellers de OPF para validar:
   - Nombres de categorías (¿"plantas de interior" o "plantas
     caseras" es más común en el habla del sector?).
   - Jerarquía (¿falta algo? ¿sobra?).
   - Facetas que proponemos (¿son las que realmente filtra un
     buyer del sector?).
2. Enviar las 6 preguntas fiscales a contador especializado.
3. Definir los admins iniciales de la Comunidad OPF.
4. Reunir los activos de branding (logo histórico OPF, fotos).
5. Cuando esté validado, actualizar este documento con status
   "ACTIVO" y pasar a Fase 4 (implementación backend).

## Estado por fase

- [x] Borrador inicial (este commit)
- [ ] Validación con sellers OPF
- [ ] Validación fiscal con contador
- [ ] Branding assets reunidos
- [ ] Admins OPF confirmados
- [ ] Documento cerrado → pasa a implementación
