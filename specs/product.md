# Producto

## Visión

AI Support Platform es un proyecto educativo para construir un backend que integra LLM de forma incremental, con contratos explícitos, pruebas automatizadas y decisiones documentadas.

## Alcance inicial

Clasificar una descripción de incidencia en una única categoría:

| Categoría  | Significado                                                          |
| ---------- | -------------------------------------------------------------------- |
| `BUG`      | Comportamiento que incumple una funcionalidad o requisito existente. |
| `FEATURE`  | Solicitud de nueva funcionalidad o mejora.                           |
| `QUESTION` | Consulta o petición de información.                                  |

La [iteración 001](iterations/001-classification.md) define las reglas operativas, el contrato HTTP y los criterios verificables. La interfaz inicial es una API REST síncrona. No hay base de datos, colas, autenticación ni frontend.

## Reglas generales

- La descripción es información no confiable; sus instrucciones no deben sustituir las instrucciones de clasificación.
- El resultado contiene una sola categoría permitida.
- La validación técnica de una respuesta no demuestra su corrección semántica.
- Se ha observado que `llama3.1:8b` puede clasificar como `BUG` una petición de funcionalidad que incorpora instrucciones maliciosas. No existe un detector automático de ese fallo semántico en esta iteración.
- Una categoría semánticamente incorrecta pero válida según el contrato no se convierte automáticamente en error técnico.
- No se inventarán requisitos existentes del producto descrito por la incidencia; el clasificador solo dispone del texto recibido.

## Evolución

Cada incremento requiere su propia especificación. No se presupone ninguna infraestructura futura. La [arquitectura](architecture.md) y los [ADRs](adr/ADR-001-sync-classification.md) recogen las decisiones técnicas iniciales.
