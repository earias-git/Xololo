# Xololo Academy — contenido

Pre-producción del contenido educativo de Xololo Academy. Formatos
neutros (Markdown + YAML) para que la migración a Moodle (o a la
plataforma que se elija) sea solo cargar y publicar.

## Nomenclatura (autorizada 2026-11-02)

- **Negocio** = el que vende (sustituye *seller*).
- **Cliente** = el que compra (sustituye *buyer*).
- Dirigirse al estudiante en **segunda persona** ("tú", "tu negocio").
- Esta regla aplica SOLO al contenido de Academy. El resto de la
  plataforma mantiene "seller/buyer" hasta nueva autorización.

Ver memoria `academy-nomenclatura` para la regla completa y ejemplos.

## Filosofía Academy (manifiesto)

Academy no solo enseña a usar la plataforma — forma **mejores
empresarios** con cultura **"Cliente primero"**. Orden de prioridades:

1. **Cliente** — merece experiencia segura, honesta, satisfactoria.
2. **Negocio** — construye rentabilidad mediante servicio y confianza.
3. **Consultor** — red territorial que ayuda al negocio.
4. **Xololo** — tecnología, capacitación, infraestructura.

Ciclo de aprendizaje: **Aprender → Practicar → Ejecutar → Medir → Certificar.**

## Estructura por módulo

Cada lección vive en su carpeta y trae 5 archivos:

| Archivo | Para qué sirve | Formato |
|---|---|---|
| `guion.md` | Guion del narrador del video | Markdown con secciones por tiempo |
| `slides.md` | Slides presentables (una por `---`) | Markdown |
| `lectura.md` | Material descargable complementario | Markdown |
| `quiz.yaml` | Banco de preguntas con respuesta correcta | YAML |
| `practica.md` | Ejercicio verificable en Xololo real | Markdown |

## Módulos planeados

| Módulo | Nombre | Lecciones | Status |
|---|---|---|---|
| **1** | Primeros pasos en Xololo | 10 | en pre-producción |
| 2 | Promoción digital en RRSS | 11 | planeado |
| 3 | Atención al cliente y reseñas | ? | planeado |
| 4 | Verified badge y crecimiento | ? | planeado |
| 5 | Empresarial (equipos, permisos) | ? | planeado |

## Flujo de migración a Moodle

1. Pre-producir en Markdown/YAML aquí (hoy).
2. Al tener Moodle operativo, un script o import manual carga:
   - Cada lección como un "Topic" en Moodle
   - `guion.md` → notas del instructor
   - `slides.md` → convertir a PDF o reveal.js
   - `quiz.yaml` → importar al banco de preguntas Moodle (formato GIFT/XML)
   - `practica.md` → actividad externa con checklist manual
3. Grabar los videos de narración separadamente (fuera de este repo).
