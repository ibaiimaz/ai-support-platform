# ADR-002: desacoplar el proveedor de LLM

## Estado vigente: I006 revisión 7 — 2026-11-19

Implementación y revisión técnica de R7 **aprobadas**. Cierre de esta fase: **KNOWN_REGRESSION INCOMPLETE**, **INDEPENDENT_HOLDOUT NOT_EXECUTED**. I006 permanece **Implemented**: validación experimental no acreditada, aceptación funcional no concedida y despliegue no autorizado. No se realizarán más experimentos ni modificaciones funcionales en esta fase; todos los permisos de inicialización y ejecución están desactivados.

Diseño aprobado e implementación autorizada de la [arquitectura híbrida](../iterations/006-tool-calling.md#19-revisión-7--diseño-aprobado-implementación-autorizada). Las descripciones de revisiones anteriores que siguen se conservan como antecedentes, no como protocolo actual.

La descripción original determina las referencias elegibles: sin IDs válidos, NO_LOOKUP desde backend y una inferencia final estructurada; con IDs, decisión nativa con enum y validación de pertenencia posterior, consulta opcional y clasificación final (dos inferencias). Máximo una herramienta, sin reintentos, 45/5/90 s; HTTP y rutas I002–I005 intactos. El texto libre de decisión no se utiliza.

Qwen3 8B Q4_K_M es candidato, digest `500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41`, temperatura 0, think false. La composición de evaluación lo prepara explícitamente; `loadConfig` conserva Llama por defecto, sin despliegue ni promoción. La mejora del prompt no está validada experimentalmente; el parcial no permite atribuirle eficacia.

El protocolo conserva dos cohortes separadas y sus manifiestos. KNOWN_REGRESSION terminó con 12/60 casos evaluables, 12/12 clasificaciones finales correctas, 10/10 decisiones deterministas correctas, dos consultas innecesarias y un error MIXED_CONTENT_AND_TOOLS. El holdout no se inicializó ni ejecutó; no hay evidencia adversarial ni pares contrafactuales completos. Estos resultados parciales no se extrapolan. La sección 21 de la especificación I006 registra el cierre y las líneas de mejora diferidas. Se preservan las autorizaciones utilizadas y todas las evidencias históricas, sin reactivar permisos ni promover el candidato.

- Estado: Approved. Decisión y documentación aprobadas por el responsable del proyecto.
- Ámbito: [arquitectura](../architecture.md) e [iteración 001](../iterations/001-classification.md).

## Contexto

Ollama local es el primer proveedor. Los tests deben funcionar sin él y debe ser posible sustituirlo sin modificar el caso de uso.

## Decisión

Definir un único puerto orientado a la tarea de clasificar incidencias. El caso de uso depende de ese puerto; el adaptador Ollama implementa el protocolo, construye mensajes, controla el timeout, valida las respuestas y traduce los fallos a errores técnicos independientes del proveedor.

El dominio define las categorías y el tipo de clasificación sin depender del proveedor. El adaptador construye su JSON Schema desde esa definición común y lo utiliza para structured outputs y validación local, sin conversores genéricos. Las causas técnicas permanecen diferenciadas internamente; su traducción al contrato público corresponde a HTTP según la especificación de la iteración.

La composición se realiza explícitamente al arrancar. No se introduce una interfaz genérica de chat, un framework de agentes ni un contenedor de dependencias. El contrato conceptual y las responsabilidades se mantienen en la arquitectura.

## Consecuencias

El proveedor simulado permite probar el caso de uso y HTTP de forma aislada. Otro proveedor requiere un adaptador y un cambio de composición. Existe un pequeño coste de separación y es necesario conservar una taxonomía de errores común.

## Alternativas

Llamar directamente a Ollama desde la ruta reduce inicialmente archivos, pero mezcla HTTP público y protocolo externo. Una abstracción genérica de LLM añadiría capacidades que esta operación no necesita. Se elige un puerto específico para mantener el alcance reducido.

## Evolución I006

El [ADR-003](ADR-003-separate-lookup-decision-and-classification.md), aprobado el 2026-11-18,
especifica decisión de consulta y clasificación como fases del mismo puerto específico I006,
sin introducir un puerto genérico ni proveedor adicional. `IncidentClassifier` y `OllamaClassifier`
conservan la ruta histórica de I002–I005; la evolución de I006 no reabre sus experimentos.
