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
- Una clasificación exitosa contiene una sola categoría permitida; I006 contempla además abstención controlada según su especificación.
- La validación técnica de una respuesta no demuestra su corrección semántica.
- Se ha observado que `llama3.1:8b` puede clasificar como `BUG` una petición de funcionalidad que incorpora instrucciones maliciosas. No existe un detector automático de ese fallo semántico en esta iteración.
- Una categoría semánticamente incorrecta pero válida según el contrato no se convierte automáticamente en error técnico.
- No se inventarán requisitos existentes del producto descrito por la incidencia. I001 usa el texto recibido; I006 puede añadir información recuperada por una herramienta autorizada, tratada como datos no confiables.

## Evolución

Cada incremento requiere su propia especificación. No se presupone ninguna infraestructura futura. La [arquitectura](architecture.md) y los [ADRs](adr/ADR-001-sync-classification.md) recogen las decisiones técnicas iniciales.

La [revisión 6 de I006](iterations/006-tool-calling.md), aprobada e implementada con pruebas deterministas el 2026-11-18, separa decisión de consulta y clasificación final. No cambia las categorías ni
obliga a consultar por mencionar un ID. Completar una incidencia requiere dos inferencias y
como máximo una herramienta. La implementación no acredita calidad semántica ni autoriza inferencias; su implementación fue aceptada por el responsable el 2026-11-18 tras revisión independiente. La puerta experimental permanece pendiente.
