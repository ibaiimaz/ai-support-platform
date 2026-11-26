# I007 — Cierre técnico y documental

Fecha: 2026-11-26. Cierre autorizado expresamente por el responsable del proyecto tras la validación
final de integración. I007 queda **técnicamente completada y cerrada como iteración de desarrollo y
aprendizaje**. El estado formal permanece **Implemented**: no se declara Verified, aceptación
funcional, validación independiente de producción ni autorización de despliegue.

## Alcance completado y revisiones

| Intervención              | Referencia consolidada | Resultado                                                                                                                                                             |
| ------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RAG e I007-R1             | abbcd45                | PostgreSQL/pgvector, CLI Markdown, motor compartido, API, contratos, privacidad y tests; hallazgos de identidad, exposición, timeout y protección histórica resueltos |
| Prompt A                  | ccb0b57                | Prompt revisado conservado; experimentación posterior documentada sin promoción automática                                                                            |
| Experimentación funcional | 1e2d156                | Baseline, A, B y Oracle cerrados; no autoriza repetirlos                                                                                                              |
| RT-001                    | 27cc98a                | Separación evaluación/producción, build limpio e identidad fuentes/build; segunda revisión independiente favorable                                                    |
| RT-002                    | 2309812                | Composición centralizada y ciclo de vida; revisión independiente favorable sin hallazgos pendientes                                                                   |
| C                         | 834d1c2                | Métricas y observabilidad completadas; revisión independiente final favorable, R1/R2/R3 resueltos                                                                     |

Las revisiones independientes y su aceptación se registran conforme a las comunicaciones del
responsable; se distinguen de las verificaciones ejecutadas por el implementador. Las anotaciones
v2 están aprobadas para evaluaciones de desarrollo: ID I007-CHUNK-RELEVANCE-001, esquema 1,
versión 2, SHA-256 `8645e8aa0f97772d43ee2331451a9702297c4ca529cc35ee5dd729324c4f98e9`.
Los originales v1/v2 permanecen intactos; la aprobación posterior está registrada en [C](i007-c-observability.md).

## Conclusiones funcionales y límites

| Ejecución      | Run ID                               | Resultado de revisión semántica                                             | Interpretación                                                                          |
| -------------- | ------------------------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Baseline       | 60d21e02-a6f0-40b4-b50c-741c569bcca9 | 17/20; respuestas 12/13, abstenciones 5/7                                   | Lote completo de desarrollo; fallos 008/016/017                                         |
| A              | 713bde35-9d5e-433e-a7f6-79dda464b4ee | 18/20 provisional; respuestas 12/13, abstenciones 6/7                       | Lote completo; corrige 017; fallos 008/016                                              |
| B              | 80a59d92-34e4-4335-be50-14945c3a47ee | 19/20 provisional; respuestas 12/13, abstenciones 7/7                       | Lote completo; corrige 016; 008 sigue incorrecto                                        |
| Oracle Context | f21cb300-3977-4507-bdcf-3dbb6a5052e6 | Respuesta correcta a 008 con webhooks:0 y roles:1 seleccionados manualmente | Diagnóstico individual: una generación, sin embeddings; excluido de métricas ordinarias |

Las revisiones semánticas fueron asistidas por ChatGPT; se conserva la ratificación y el carácter
provisional originales, sin convertirlos en aceptación funcional. Los veinte casos sintéticos se
usaron durante el desarrollo: no constituyen un holdout ni validación independiente. No se observan
regresiones funcionales en A/B, pero ello no garantiza generalización.

Se mantiene **prompt A, Top-K 5, máximo 4 fragmentos y similitud mínima 0,45**. SHA-256 del prompt A:
`c7201e51b94307137037c4a4c7b71981dd56a342367ed430edc8229df57d94d5`.
B empleó 6/6 solo durante su proceso: recupera y entrega roles:1 en 008, pero el generador no utiliza
correctamente su información. Además, la exposición a cualquiera de las cargas anotadas aumenta de
8/20 a 17/20. El resultado de un lote conocido no justifica consolidar ese cambio como configuración
productiva. No se atribuye causalmente el fallo al ruido o a la posición: son hipótesis, no causas probadas.
Oracle demuestra capacidad en un contexto elegido manualmente, no mejora general del RAG.

ASR extremo a extremo 0/3 y condicionado a carga propia 0/2 según las revisiones existentes; no
acredita resistencia general a prompt injection. Exposición propia, cruzada y global son diferentes.
El análisis retrospectivo final C deja **Chunk Recall de baseline/A no disponible** en 13 casos
aplicables por fragmentos recuperados sin identidad suficiente fuera del contexto retenido. No se
reconstruyen porcentajes ni similitudes ausentes. La cobertura por hashes retenidos es 96,15 % en
baseline/A y 100 % en B; B permite recall 97,44 % porque retiene todos los fragmentos recuperados.
Cobertura no equivale a utilización semántica. Los derivados anteriores siguen conservados.

## Validación final de integración

Base verificada: **834d1c2**. PostgreSQL **16.12**, pgvector **0.8.1**, imagen
`pgvector/pgvector@sha256:33198da2828a14c30348d2ccb4750833d5ed9a44c88d840a0e523d7417120337`.
Instancia desechable `i007-pg-final-20261126-834d1c2`, datos tmpfs sin volúmenes y puerto
localhost 49740, distinto del 5433 persistente. Migraciones y fixtures se aplicaron únicamente allí;
embeddings y generación simulados, sin inferencias reales ni evaluación funcional.

- Integración dirigida: **9 tests satisfactorios, 0 fallidos, 0 omitidos**.
- `npm run verify` con RAG_TEST_DATABASE_URL apuntando a la instancia temporal: **402 satisfactorios,
  0 fallidos, 0 omitidos**; compilación estricta, lint y formato correctos.
- Migraciones repetibles, idempotencia, atomicidad, concurrencia, snapshots y liberación de conexión
  tras timeout verificadas. Sin omisiones inesperadas.
- Esquemas de tests eliminados; contenedor y datos tmpfs eliminados, puerto liberado. Contenedor
  persistente, PID, arranque, montajes, puertos e inventario de volúmenes sin cambios; no se accedió
  a su base de datos. Se comprobaron 447 referencias históricas por SHA-256, sin cambios.

Logs técnicos locales de esa ejecución (no versionados; /tmp no es conservación permanente):

| Evidencia                       | SHA-256                                                          |
| ------------------------------- | ---------------------------------------------------------------- |
| /tmp/i007-pg-final-build.log    | 187ed8f84e57a5616292fc8b323f5b9e6dfe866c1c6c7daaf5957bd8b7098ef5 |
| /tmp/i007-pg-final-targeted.log | b317311fee1770fa09156f3094717010aefa6dc3192174588354f9dd9c967100 |
| /tmp/i007-pg-final-verify.log   | d72cb684f3b17b923e138717161291f3693ab0fa722982f0cb591e45db38b8f6 |

Estos resultados cierran la validación PostgreSQL que figuraba pendiente al cerrar RT-001/RT-002/C;
no alteran sus resultados históricos ni acreditan aceptación funcional. El presente cierre cambia
exclusivamente documentos: no repite tests funcionales, migraciones, integración ni inferencias.

## Evidencias y deuda conocida conservadas

Los informes originales permanecen privados en `evals/reports/i007/<runId>/report.json`; las revisiones
son evidencia adicional vinculada, nunca sustituciones. Oracle se conserva separadamente en
`evals/reports/i007/I007-ORACLE-CONTEXT-001/`. [C](i007-c-observability.md) registra rutas y hashes de
todos los derivados retrospectivos, incluidas sus versiones anteriores y limitaciones.
Este cierre no acredita una copia externa independiente: las evidencias privadas se conservan
localmente y no se han copiado ni sincronizado durante esta operación documental. La recomendación
de conservación externa de la guía no se presenta como cumplida sin evidencia adicional.
Véanse también [el cierre experimental](i007-experimentation-closure.md),
[RT-001](i007-rt001-implementation.md), [RT-002](i007-rt002-implementation.md) y
[la deuda técnica](technical-debt.md). No se regeneran identidades, freezes, fixtures ni autorizaciones.

Persisten los límites documentados de identidad de dependencias/runtime y ciclo de vida: la
cancelación best effort no demuestra parada física del transporte y el cierre agregado no promete
un drenaje ilimitado de peticiones. No se ha localizado el inventario nominal de 412 archivos y no
se afirma una verificación completa de ese conjunto. Sigue pendiente de decisión futura mejorar
el uso semántico de evidencia, estudiar hipótesis de ruido/posición y validar calidad y seguridad
sobre datos independientes representativos. No se implementa ni se autoriza ese trabajo por este cierre.
