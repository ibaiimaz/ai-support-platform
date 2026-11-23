# Producto

## Estado vigente: I006 revisión 7 — 2026-11-19

Implementación y revisión técnica de R7 **aprobadas**. Cierre de esta fase: **KNOWN_REGRESSION INCOMPLETE**, **INDEPENDENT_HOLDOUT NOT_EXECUTED**. I006 permanece **Implemented**: validación experimental no acreditada, aceptación funcional no concedida y despliegue no autorizado. No se realizarán más experimentos ni modificaciones funcionales en esta fase; todos los permisos de inicialización y ejecución están desactivados.

Diseño aprobado e implementación autorizada de la [arquitectura híbrida](iterations/006-tool-calling.md#19-revisión-7--diseño-aprobado-implementación-autorizada). Las descripciones de revisiones anteriores que siguen se conservan como antecedentes, no como protocolo actual.

La descripción original determina las referencias elegibles: sin IDs válidos, NO_LOOKUP desde backend y una inferencia final estructurada; con IDs, decisión nativa con enum y validación de pertenencia posterior, consulta opcional y clasificación final (dos inferencias). Máximo una herramienta, sin reintentos, 45/5/90 s; HTTP y rutas I002–I005 intactos. El texto libre de decisión no se utiliza.

Qwen3 8B Q4_K_M es candidato, digest `500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41`, temperatura 0, think false. La composición de evaluación lo prepara explícitamente; `loadConfig` conserva Llama por defecto, sin despliegue ni promoción. La mejora del prompt no está validada experimentalmente; el parcial no permite atribuirle eficacia.

El protocolo conserva dos cohortes separadas y sus manifiestos. KNOWN_REGRESSION terminó con 12/60 casos evaluables, 12/12 clasificaciones finales correctas, 10/10 decisiones deterministas correctas, dos consultas innecesarias y un error MIXED_CONTENT_AND_TOOLS. El holdout no se inicializó ni ejecutó; no hay evidencia adversarial ni pares contrafactuales completos. Estos resultados parciales no se extrapolan. La sección 21 de la especificación I006 registra el cierre y las líneas de mejora diferidas. Se preservan las autorizaciones utilizadas y todas las evidencias históricas, sin reactivar permisos ni promover el candidato.

## Visión

AI Support Platform es un proyecto educativo para construir un backend que integra LLM de forma incremental, con contratos explícitos, pruebas automatizadas y decisiones documentadas.

## Alcance inicial

Clasificar una descripción de incidencia en una única categoría:

| Categoría  | Significado                                                          |
| ---------- | -------------------------------------------------------------------- |
| `BUG`      | Comportamiento que incumple una funcionalidad o requisito existente. |
| `FEATURE`  | Solicitud de nueva funcionalidad o mejora.                           |
| `QUESTION` | Consulta o petición de información.                                  |

La [iteración 001](iterations/001-classification.md) define las reglas operativas, el contrato HTTP y los criterios verificables. La interfaz inicial es una API REST síncrona. En I001 no había base de datos, colas, autenticación ni frontend; I007 añade persistencia documental independiente.

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
obliga a consultar por mencionar un ID. En aquella revisión completar una incidencia requería dos inferencias y como máximo una herramienta; revisión 7 reduce a una inferencia la ruta sin referencias elegibles. La implementación no acredita calidad semántica ni autoriza inferencias; su implementación fue aceptada por el responsable el 2026-11-18 tras revisión independiente. La puerta experimental permanece pendiente.

## I007 — Consultas a documentación interna

El asistente RAG responde únicamente con contexto recuperado del corpus autorizado, devuelve fuentes
versionadas o se abstiene con INSUFFICIENT_CONTEXT. No incorpora conocimientos externos como sustituto
de evidencia. Un corpus ficticio y evals candidatos permiten preparar revisión posterior; no implican
representatividad de producción ni aceptación funcional. No cambia la clasificación de incidencias.
Véase [I007](iterations/007-knowledge-rag.md) y su [guía](../knowledge/README.md).
