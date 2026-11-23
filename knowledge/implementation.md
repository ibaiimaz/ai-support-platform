# I007 — Informe de implementación para revisión

Fecha: 2026-11-23. Estado: **Implemented**, sin revisión independiente, baseline ni aceptación funcional.
No se han ejecutado inferencias reales, ingestiones con Ollama ni evals experimentales. No hay commits,
push, despliegue ni cambios en experimentos históricos. No se declara finalización técnica de todos los
criterios mientras permanezcan los bloqueos de verificación global y la revisión independiente pendiente.

## Cambios

- `src/knowledge/domain.ts`, `ports.ts`, `use-cases.ts`: contratos y casos de uso específicos.
- `markdown.ts`, `config.ts`: identidad lógica, hashes de bytes, chunking Unicode por secciones,
  configuración validada independiente.
- `postgres.ts`, `migrations/007-knowledge.sql`, `compose.i007.yaml`: versiones, pgvector exacto,
  migración con checksum, publicación atómica y snapshots de lectura. Imagen de desarrollo fijada
  por tag y digest, no despliegue productivo.
- `ollama.ts`: embeddings locales y generación estructurada sin herramientas, sin reintentos,
  con timeouts y límite de cuerpo. Embeddings enlazados a modelo/digest/dimensiones.
- `composition.ts`, `src/http/knowledge-route.ts`, `src/main.ts`: composición lazy, nueva ruta y
  cierre del pool. La línea que compone clasificación y sus dependencias originales se conserva.
- `cli.ts`: migración e ingestión explícitas, `--check` offline por defecto.
- `evaluation.ts`, `evaluation-main.ts`: baseline secuencial, errores parciales, métricas documentales
  y revisión humana de semántica ligada al hash del informe. Ningún gate de aceptación automático.
- `knowledge/corpus/`: diez documentos ficticios; `evals/knowledge/i007-cases.json`: veinte casos candidatos.
- `test/knowledge/`: contratos, puertos simulados, HTTP, protocolo Ollama simulado, evals y PostgreSQL.
- README, arquitectura, producto, especificación I007 y guía operativa sincronizados.
- `pg` y `@types/pg` fijados a 8.23.1 en package y lockfile. Sin frameworks de agentes ni dependencias RAG.

## Decisiones de implementación

Las decisiones son detalles compatibles con RF/RNF, no nuevos criterios de aceptación.

La identidad documental es un slug en front matter; renombrar archivos no crea otro documento.
La idempotencia depende de bytes originales y de la configuración relevante, nunca de credenciales,
modelo generativo u otras opciones ajenas al embedding/chunking. Los errores no publican staging.
El caso de uso publica dentro del lease de escritor: no se añade una CLI separada que pueda eludirlo.

La búsqueda filtra espacios en un CTE materializado antes de calcular distancias. Coseno exacto,
sin índices ANN. Los lectores conservan REPEATABLE READ durante generación; MVCC permite terminar con
fuentes antiguas después de publicar. La prueba real de base de datos comprueba esa propiedad y la
reversión de una publicación ante un fallo SQL inyectado después de empezar a cambiar el estado.

El generador cita chunkIds, no URLs o títulos inventados. El backend solo devuelve metadatos de los
IDs citados y presentes en el contexto enviado. El aislamiento de roles y la validación JSON son
garantías técnicas; la fundamentación y la resistencia semántica no se afirman sin evals reales.

Los valores por defecto son iniciales, no calibrados. No se consultó Ollama para elegirlos ni se
descargaron modelos. El corpus de evaluación y sus expectativas son candidatos pendientes de revisión.
El runner comprueba que los hashes/configuración del corpus activo correspondan al corpus del dataset,
registra versiones y se detiene si cambian durante el lote. Una interrupción de proceso puede dejar
consumo incierto: no hay ledger formal I007 ni reanudación automática, y no se deduce consumo de la
mera ausencia de un resultado. La referencia de autorización es un control operativo explícito.

## Trazabilidad

| Requisito                    | Evidencia implementada                                                             | Estado / verificación pendiente                                                |
| ---------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| RF-01 Incorporación          | CLI, parser estricto, SHA de bytes, IDs independientes del fichero, límites        | Tests de parser/corpus e ingestión simulada; integración PG                    |
| RF-02 Chunking/embeddings    | Secciones, overlap Unicode, digest y dimensiones, truncate false                   | Tests de chunking y API simulada; compatibilidad del modelo real pendiente     |
| RF-03 Recuperación           | pgvector exacto, versiones activas, espacios aislados, topK/umbral/contexto        | SQL probado con vectores simulados en PostgreSQL; calidad semántica pendiente  |
| RF-04 Consulta               | POST knowledge/ask, validación, ANSWER/INSUFFICIENT_CONTEXT, errores diferenciados | Contratos HTTP deterministas probados                                          |
| RF-05 Fundamentación         | Schema estricto, IDs citados restringidos y fuentes del snapshot                   | Existencia de citas probada; respaldo semántico pendiente de revisión/evals    |
| RF-06 Atomicidad             | Lifecycle, lock por documento, publicación transaccional, snapshots MVCC           | Integración real: lector en curso, exclusión y rollback ante fallo SQL         |
| RF-07 Reingestión            | Fingerprint relevante, skip sin embeddings, regeneración completa                  | Tests de idempotencia y cambio de espacio; sin ingestión Ollama real           |
| RF-08 Instrucciones hostiles | Sistema fijo, documentos en rol usuario, sin herramientas, Ajv                     | Separación estructural probada; eficacia adversarial pendiente                 |
| RF-09 Información            | Corpus ficticio único, logs saneados, contenidos privados opt-in en evals          | Tests de privacidad; autenticación/ACL fuera de alcance, demo local            |
| RNF-01 TypeScript            | Configuración estricta existente                                                   | Compilación comprobada                                                         |
| RNF-02 Tests                 | node:test, proveedores simulados, integración PG explícita                         | Verificaciones descritas abajo                                                 |
| RNF-03 Servicios             | Ollama/PostgreSQL locales, sin servicios de pago                                   | Sin consultas externas de aplicación durante pruebas                           |
| RNF-04 Configuración         | RAG_* validado y documentado                                                       | Tests de límites, configuraciones inválidas y aislamiento                      |
| RNF-05 Inicio offline        | Pool lazy, sin llamadas a modelos al componer                                      | Test sin red; los fallos se devuelven al consultar                             |
| RNF-06 Migraciones           | SQL transaccional y checksum registrado                                            | Aplicación repetida en base temporal probada                                   |
| RNF-07 Documentación         | knowledge/README.md, especificación y seguimiento                                  | Preparada para revisión humana                                                 |
| RNF-08 Logs                  | Solo códigos técnicos, no cuerpos/errores arbitrarios                              | Tests HTTP/evals de privacidad                                                 |
| RNF-09 Regresión             | Clasificación y experimentos originales sin cambios funcionales                    | Regresión HTTP e identidad histórica probadas; corrección R1 documentada abajo |
| RNF-10 Despliegue            | Solo Compose de desarrollo, sin despliegue automático                              | No se ha desplegado                                                            |

Corpus/dataset/ejecutor están implementados. Revisión independiente, revisión humana del dataset,
validación con modelos reales y aprobación de umbrales no están realizadas ni se sustituyen por tests.

## Verificación inicial (anterior a I007-R1)

La integración usa una base temporal local PostgreSQL 16 con pgvector 0.8.1, sin inferencias. Cada
prueba crea y elimina un esquema UUID propio. No se toca una base productiva ni evidencias históricas.
El contenedor temporal se retira al acabar; la imagen local descargada no contiene modelos Ollama.

La primera ejecución del conjunto global dentro del sandbox encontró `listen EPERM` en un test
histórico. Se repite fuera de esa restricción para no atribuir a sandbox otros fallos.

Los cuatro fallos restantes están en controles I006:

1. `cohorts.test.ts`: espera `identityHash: null` en un manifiesto legítimamente cerrado con identidad
   utilizada. Sus archivos y esa expectativa son anteriores a I007 y permanecen intactos.
2. Otro test de cohortes compara hashes congelados de archivos del comportamiento R7.
3. Otro test de cohortes invoca effectiveIdentity y obtiene `Frozen R7 behavior changed`.
4. `hybrid-classification.test.ts` obtiene el mismo rechazo de identidad histórica.

En el inventario de 38 archivos R7, solo difieren `src/main.ts`, `package.json` y `package-lock.json`:
wiring aditivo de la nueva ruta y nuevas dependencias de PostgreSQL. Son cambios necesarios de I007;
no se regeneró el freeze ni se debilitaron sus guards para presentar una verificación satisfactoria.
Los antiguos experimentos se reproducen en su revisión histórica, no fingiendo que el entorno ampliado
es idéntico. Decidir cómo desacoplar esos tests de su estado histórico requiere un trabajo expresamente
acotado posterior; no se arreglan problemas I006 como parte de I007.

Resultado final de `RAG_TEST_DATABASE_URL=… npm run verify`: **360 tests, 356 satisfactorios,
4 fallidos, 0 omitidos**. Los 34 tests/subtests de I007 pasan, incluida la integración PostgreSQL.
Formato, ESLint y compilación estricta pasan; el comando global termina con código 1 por los cuatro
fallos anteriores. Log local de comprobación: `/tmp/i007-final-verify.log` (no evidencia experimental).
`git diff --check` y los tres comandos `--check` offline también pasan: 10 documentos y 20 casos.

Se compararon SHA-256 de 352 archivos protegidos al inicio (clasificación, adaptadores, runners,
datasets y evidencias privadas históricas): sin diferencias. En el inventario R7 la ampliación
cambia únicamente los tres archivos de integración/dependencias indicados, sin regenerar identidades.
No se hizo staging ni commit.

Ninguno de estos controles ha autorizado ni ejecutado una inferencia. El informe de revisión independiente que
pide la especificación corresponde a la etapa posterior indicada por el responsable, no a este informe.

## Límites conocidos

- Un modelo puede inventar hechos o ignorar el sistema aun citando IDs válidos. No hay demostración de
  calidad, resistencia a prompt injection ni representatividad de producción.
- El corpus usa Markdown restringido y límites por puntos Unicode, no tokens; un embedding demasiado
  largo falla explícitamente. No hay OCR, extracción de adjuntos ni parser Markdown completo.
- El proceso mantiene una conexión de lectura durante generación. Pool limitado, sin cola: medir
  capacidad/latencia antes de uso real. No hay deadline global adicional ni reintentos de dependencias.
- El checksum evita confundir configuraciones; no protege contra un administrador que altere base,
  ficheros, tags o registros deliberadamente. Reservar el proveedor y base durante evals.
- Datos de un solo corpus autorizado. No existen autenticación ni permisos documentales por usuario.
- Persistencia privada de evals opcional para revisión sintética; sin ella no se inventan métricas
  semánticas. Una copia externa no se crea automáticamente.
- No hay umbrales de aceptación aprobados ni promoción automática. Revisión independiente y baseline
  real requieren las autorizaciones posteriores que correspondan.

## Revisión correctiva I007-R1

Referencia de revisión: los cuatro hallazgos y requisitos aportados expresamente por el responsable
constituyen el informe de trabajo; el original externo no está guardado en el repositorio. Se
contrastaron con código y tests, sin discrepancias que exigieran cambiar el alcance.

| Hallazgo                   | Corrección                                                                                                  | Evidencia determinista                                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| R1 Compatibilidad I006     | Fixture obtenido del commit inmutable, 38 SHA verificados; expectativa de permiso histórico separada        | Dos suites históricas conservan las aserciones de identidad y una prueba rechaza el árbol actual antes del proveedor             |
| R2 Identidad del generador | Pin único del lote; comprobación antes/después de cada respuesta válida; fallo saneado y parcial INCOMPLETE | Cambios de digest antes/después, entre casos, cambio de modelo y fallo de proveedor sin nuevas comprobaciones posteriores        |
| R3 Exposición efectiva     | Cargas anotadas, observación en la frontera del generador y ASR condicional separado                        | Sin retrieval, carga fuera del límite de contexto, carga enviada, fallo técnico incierto, informes antiguos y denominadores cero |
| R4 Timeout no cooperativo  | Límite efectivo independiente de abort, cancelación best effort y descarte de respuestas tardías            | Cabeceras/cuerpo/cancelación bloqueados; snapshot liberado y conexión devuelta al pool PostgreSQL                                |

Procedencia del fixture: [registro de integridad](../test/fixtures/I006-R7.md). No se cambiaron
manifiestos, hashes, guard de identidad, presupuestos ni evidencias I006. Tampoco ninguno de los
352 archivos protegidos; las adaptaciones son exclusivamente tests fuera de ese inventario.
El árbol I007 sigue siendo rechazado deliberadamente por el evaluador original I006.

El dataset candidato contenido v2 solo añade identificadores y texto de cargas esperadas: reconstruir
la serialización v1 sin esas anotaciones reproduce su SHA original
`95844f64d1eb1d4fedb20f518969a8d9888aa6305796ef172e15f718bba08b7d` en un test. No se cambiaron
preguntas, categorías de casos, estados esperados, hechos ni corpus. No existe dataset I007 congelado
ni ejecución experimental que se esté reescribiendo.

Archivos de esta corrección: domain.ts, ollama.ts, evaluation.ts, evaluation-main.ts en src/knowledge;
evals/knowledge/i007-cases.json; test/fixtures/i006-r7-history.ts y su registro Markdown;
cohorts.test.ts, hybrid-classification.test.ts; tests knowledge de evaluación, timeouts y PostgreSQL;
guía, informe, README y estado documental I007. Los restantes cambios I007 previos siguen pendientes
sin hacer staging ni commits.

Verificación final R1: `RAG_TEST_DATABASE_URL=… npm run verify` termina con código 0:
**371/371 tests y subtests satisfactorios, 0 fallos, 0 omisiones**. Incluye 44 de I007 (35 sin
servicios y 9 de integración PostgreSQL). Las dos suites históricas afectadas pasan **28/28**.
Compilación estricta, lint, formato y `git diff --check` correctos. El validador offline del dataset
pasa con 20 casos v2 y 10 documentos, sin inferencias. Log técnico local:
`/tmp/i007-r1-verify-final.log`; no es un resultado experimental.

Se repitió la comparación SHA-256 de los 352 archivos protegidos: sin diferencias. Los manifiestos
históricos permanecen idénticos y no hay archivos experimentales I007. El contenedor PostgreSQL de
pruebas se retira sin conservar datos ni modificar otros servicios. No hubo staging, commits, push,
descargas de modelos ni inferencias. Los controles originales I006 siguen rechazando el árbol actual.

Esto no constituye aceptación técnica por el responsable ni aceptación funcional. Las limitaciones de comprobación de
tags, reconocimiento literal de cargas y cancelación física se detallan en la guía; no se declaran
resueltas mediante tests semánticos ni nuevas inferencias.
