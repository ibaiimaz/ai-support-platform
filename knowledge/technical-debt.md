# I007 — Deuda técnica diferida

Registro inicial: 2026-11-25. Cierre documental RT-002: 2026-11-26. Estado: **RT-001 cerrado y aceptado técnicamente; RT-002 cerrado y aceptado técnicamente**.
La experimentación funcional está [cerrada](i007-experimentation-closure.md). RT-001 y RT-002
cuentan con una [propuesta separada por intervención](i007-refactoring-analysis.md), con RT-001 aceptado tras segunda revisión independiente y RT-002 cerrado y aceptado técnicamente.
Estos registros no autorizan implementación, cambio de arquitectura ni una nueva iteración.
Se preservan el comportamiento, los contratos y las evidencias actuales.

| ID     | Trabajo diferido                                                                                                        | Situación observada                                                                                                      | Alcance de una futura revisión                                                                                                                  |
| ------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| RT-001 | Separar todo el código exclusivo de evaluación del código de producción, manteniendo un motor RAG compartido.           | Resuelto: evaluador en src/evaluation/knowledge y tests separados; build limpio e identidad de fuentes/build verificada. | Aceptado tras segunda revisión independiente. Mantener límites de identidad; integración PostgreSQL real pendiente de validación final.         |
| RT-002 | Revisar y homogeneizar el registro de rutas knowledge y classify, con composición centralizada e inyección consistente. | Implementado: composición central, ambas rutas en buildApp, arranque separado y cierre idempotente de recursos.          | Revisión independiente favorable aceptada, sin hallazgos pendientes; conservar límites de cierre/inventarios y validación PostgreSQL pendiente. |

RT-001 se implementa después del cierre experimental y bajo autorización específica, con
traslado del evaluador y sus tests, script público conservado, inventario de identidad actualizado
y guarda arquitectónica. No modifica el motor RAG ni las evidencias. Segunda revisión independiente favorable aceptada; R1 y R2 resueltos.
RT-002 se cierra bajo autorización nominal y revisión independiente favorable aceptada el 2026-11-26;
sus resultados y limitaciones se registran en
[el informe RT-002](i007-rt002-implementation.md). No se declara aceptación funcional de I007.

## C — Métricas y observabilidad completadas y aceptadas técnicamente

Registrada el 2026-11-25 tras I007-DIAGNOSTIC-B-001, sin implementación ni autorización de C.
Incorporar las puntuaciones de similitud coseno de los chunks recuperados a los informes de evaluación,
ligadas a chunkId/versionId y posición, con el umbral aplicado y distinción entre recuperado y enviado
al generador. Mantener la definición `1 - distancia coseno` y la privacidad por defecto: esta mejora
no requiere registrar prompts, respuestas crudas ni todos los vectores de consulta automáticamente.

Conservar los scores efectivos de cada ejecución, no reconstruir ni rellenar retroactivamente informes
históricos con puntuaciones de un embedding nuevo. Revisar esquema, compatibilidad y tests antes de
implementar, sin alterar ranking o métricas por el mero hecho de observarlos. RT-002 y RT-001 están
cerrados técnicamente; esta observabilidad es una preparación específica para C.

La mejora se implementa bajo la autorización posterior C del 2026-11-26, sin nuevas inferencias.
Incluye anotaciones propuestas, ranking/scores, cobertura por fragmentos y exposición global/cruzada;
véase [el informe C](i007-c-observability.md). Los informes originales y sus puntuaciones ausentes
no se modifican. La revisión independiente final confirma R1/R2/R3 resueltos y el responsable
aprueba las anotaciones v2 por su identidad y SHA-256 exactos, registrados en el informe C.
C queda completada. Se conserva la limitación de Chunk Recall retrospectivo no disponible para
baseline/A, las similitudes históricas ausentes y el inventario nominal de 412 archivos no localizado.
No hay aceptación funcional ni cierre definitivo de I007.
