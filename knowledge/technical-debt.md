# I007 — Deuda técnica diferida

Registro: 2026-11-25. Estado: **RT-001 cerrado y aceptado técnicamente; RT-002 pendiente de aprobación**.
La experimentación funcional está [cerrada](i007-experimentation-closure.md). RT-001 y RT-002
cuentan con una [propuesta separada por intervención](i007-refactoring-analysis.md), con RT-001 aceptado tras segunda revisión independiente y RT-002 todavía sin implementar.
Estos registros no autorizan implementación, cambio de arquitectura ni una nueva iteración.
Se preservan el comportamiento, los contratos y las evidencias actuales.

| ID     | Trabajo diferido                                                                                                        | Situación observada                                                                                                      | Alcance de una futura revisión                                                                                                                                         |
| ------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RT-001 | Separar todo el código exclusivo de evaluación del código de producción, manteniendo un motor RAG compartido.           | Resuelto: evaluador en src/evaluation/knowledge y tests separados; build limpio e identidad de fuentes/build verificada. | Aceptado tras segunda revisión independiente. Mantener límites de identidad; integración PostgreSQL real pendiente de validación final.                                |
| RT-002 | Revisar y homogeneizar el registro de rutas knowledge y classify, con composición centralizada e inyección consistente. | buildApp registra classify; main.ts construye aparte las dependencias RAG, registra knowledge y su cierre de pool.       | Proponer un punto de composición explícito y una estrategia coherente de DI y ciclo de vida; conservar contratos HTTP, separación de capacidades y facilidad de tests. |

RT-001 se implementa después del cierre experimental y bajo autorización específica, con
traslado del evaluador y sus tests, script público conservado, inventario de identidad actualizado
y guarda arquitectónica. No modifica el motor RAG ni las evidencias. Segunda revisión independiente favorable aceptada; R1 y R2 resueltos.
RT-002 continúa pendiente y no se incorpora a esta intervención.

## Mejora pendiente para el experimento C — puntuaciones de recuperación

Registrada el 2026-11-25 tras I007-DIAGNOSTIC-B-001, sin implementación ni autorización de C.
Incorporar las puntuaciones de similitud coseno de los chunks recuperados a los informes de evaluación,
ligadas a chunkId/versionId y posición, con el umbral aplicado y distinción entre recuperado y enviado
al generador. Mantener la definición `1 - distancia coseno` y la privacidad por defecto: esta mejora
no requiere registrar prompts, respuestas crudas ni todos los vectores de consulta automáticamente.

Conservar los scores efectivos de cada ejecución, no reconstruir ni rellenar retroactivamente informes
históricos con puntuaciones de un embedding nuevo. Revisar esquema, compatibilidad y tests antes de
implementar, sin alterar ranking o métricas por el mero hecho de observarlos. RT-002 sigue
pendiente y RT-001 está cerrado técnicamente; esta observabilidad es una preparación específica para C.
