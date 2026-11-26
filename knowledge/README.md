# I007 — Asistente documental RAG

Implementación para revisión técnica; sin aceptación funcional ni ejecuciones reales autorizadas.
La fuente normativa es [I007](../specs/iterations/007-knowledge-rag.md). Clasificación I006 no cambia.

## Preparación local

Node 22, `npm ci`, `npm run build`. Docker es opcional para la base local:

```sh
docker compose -f compose.i007.yaml up -d
npm run knowledge:migrate -- --check
npm run knowledge:migrate -- --run
npm run knowledge:ingest -- --check
```

La migración crea pgvector y tablas I007, registra el checksum y es transaccional e idempotente.
Requiere permisos para crear la extensión. Nunca ejecutar sobre una base no autorizada.
Las credenciales de Compose son ficticias y exclusivas de desarrollo; el puerto se limita a loopback.
`--check` no abre conexiones. Ninguna operación arranca, descarga o actualiza modelos.

**Solo con autorización posterior para inferencias**, instalar/configurar los modelos adecuados y ejecutar:

```sh
npm run knowledge:ingest -- --run
npm start
curl http://127.0.0.1:3000/api/v1/knowledge/ask \
  -H 'Content-Type: application/json' \
  -d '{"question":"¿Cuánto dura el bloqueo tras cinco contraseñas incorrectas?"}'
```

La ingestión completa del directorio valida todos sus documentos antes de empezar. Publica cada
**documento** de forma atómica, no el corpus entero: un fallo detiene el lote y conserva las
publicaciones anteriores. Reejecutar es seguro, sin reintentos automáticos. CLI no sirve archivos al LLM
hasta ejecutar explícitamente `--run`. La API sí utiliza modelos al recibir una consulta válida;
no enviar ese curl durante las verificaciones sin autorización de inferencia.

## Documentos y publicación

Front matter obligatorio (no es un parser YAML general):

```md
---
documentId: manual-estable
title: Título legible
---

# Sección

Contenido UTF-8.
```

`documentId` es un slug canónico de hasta 80 caracteres. El nombre/ruta no determina identidad.
Solo `documentId` y `title`; título hasta 200 puntos Unicode. Máximo 1 MiB por archivo, 100 documentos,
1.000 fragmentos por documento; sin symlinks. Un directorio vacío o IDs duplicados se rechazan.
El SHA-256 usa los bytes originales, antes de normalizar CRLF. El chunking respeta encabezados
ATX y bloques de código cercados; ventanas Unicode con solapamiento dentro de cada sección.
No se promete un parser completo de todas las extensiones Markdown ni límites por tokens.
`truncate:false` evita perder texto silenciosamente si el modelo de embeddings no admite un fragmento.

El fingerprint incluye algoritmo de chunking, tamaño/overlap, modelo, digest y dimensiones. Si coincide
con la versión activa y el hash de contenido, no se regeneran embeddings. Un cambio regenera todos.
Una sesión PostgreSQL mantiene un advisory lock por documento: otro escritor falla con INGESTION_BUSY.
PENDING → PROCESSING → READY → ACTIVE; el fallo deja FAILED sin cambiar la versión activa.
Una nueva ingestión elimina el staging anterior. No se reconstruye historial de versiones.

La publicación valida la completitud y cambia el puntero activo en una única transacción.
Las consultas usan REPEATABLE READ READ ONLY durante retrieval y generación. Las versiones sustituidas
se eliminan lógicamente al publicar; MVCC conserva las filas para los snapshots abiertos hasta que
terminen. Las fuentes se construyen con el resultado recuperado, sin consultar otra vez el puntero.
Mantener la conexión durante generación limita capacidad: pool de seis conexiones y timeout del
proveedor acotan ese coste. No hay cola ni workers. Una desconexión libera el lock de sesión; ante fallo
de desbloqueo la conexión se destruye. La base y sus credenciales son un límite de confianza operacional.

## Recuperación y contrato HTTP

`1 - (embedding <=> pregunta)` es similitud coseno, [-1,1], **no probabilidad**.
Búsqueda exacta sin HNSW/IVFFlat, solo versiones activas del mismo modelo/digest/dimensión.
Un CTE materializado filtra los espacios antes de calcular distancias de distinta dimensionalidad.
Umbral antes de Top-K y orden estable por chunkId; solo los primeros maxContextChunks se envían al generador.
Si no hay contexto, no hay generación. Un cambio de espacio exige reingestión; no se mezclan vectores.

- HTTP 200 ANSWER: texto y fuentes con documentId/versionId/chunkId/title/section.
- HTTP 200 INSUFFICIENT_CONTEXT: answer null, sources vacío.
- HTTP 400 pregunta inválida; 415 contenido no JSON.
- HTTP 503 dependencia indisponible; 504 timeout; 502 protocolo/vectores/generación inválidos.
- Sobre común `{error:{code,message,requestId}}`; sin errores crudos ni detalles de Ajv.

El generador recibe un sistema fijo, pregunta y registros JSON de contexto en rol usuario.
No tiene herramientas ni acciones. Se exige JSON Schema, temperatura cero, think false y validación
local sin coerción, reparación ni reintentos. ANSWER exige texto no vacío y chunkIds únicos del
contexto enviado. Los metadatos públicos proceden exclusivamente de esos fragmentos. Citar un ID
existente **no demuestra** que la fuente respalde la afirmación: esa garantía requiere evaluación humana.
Las instrucciones hostiles siguen siendo datos; los tests demuestran aislamiento estructural,
no resistencia semántica. Corpus único autorizado, sin autenticación ni ACL por usuario. No exponer
esta demo a una red pública ni cargar documentos privados sin revisar autorización y controles de acceso.
Los logs por defecto omiten preguntas, contexto, respuestas y excepciones arbitrarias.

## Configuración

| Variable                  | Valor por defecto                                       | Motivo / límite                                                      |
| ------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------- |
| RAG_OLLAMA_BASE_URL       | http://localhost:11434                                  | Proveedor local, independiente de clasificación                      |
| RAG_DATABASE_URL          | postgresql://support:support_dev@127.0.0.1:5433/support | Base ficticia de Compose                                             |
| RAG_GENERATION_MODEL      | qwen3:8b                                                | Punto de partida, no validado para RAG                               |
| RAG_EMBEDDING_MODEL       | nomic-embed-text:latest                                 | Punto de partida local, sin descarga automática                      |
| RAG_EMBEDDING_DIMENSIONS  | 768                                                     | Debe corresponder al modelo instalado; validado en cada vector       |
| RAG_TOP_K                 | 5                                                       | Corpus pequeño; configurable 1–100                                   |
| RAG_MIN_SIMILARITY        | 0.45                                                    | Heurística inicial, no calibrada ni umbral de aceptación             |
| RAG_MAX_CONTEXT_CHUNKS    | 4                                                       | Acota contexto; no mayor que Top-K                                   |
| RAG_MAX_QUESTION_LENGTH   | 2000                                                    | Puntos Unicode; máximo configurable 4000, límite HTTP global intacto |
| RAG_CHUNK_SIZE            | 1200                                                    | Puntos Unicode, no tokens; máximo 8000                               |
| RAG_CHUNK_OVERLAP         | 150                                                     | Menor que tamaño                                                     |
| RAG_EMBEDDING_TIMEOUT_MS  | 30000                                                   | Cada petición de embeddings o metadatos                              |
| RAG_GENERATION_TIMEOUT_MS | 45000                                                   | Incluye lectura del cuerpo, sin reintentos                           |
| RAG_DATABASE_TIMEOUT_MS   | 5000                                                    | Conexión y cada sentencia                                            |
| RAG_DOCUMENTS_DIRECTORY   | knowledge/corpus                                        | Corpus sintético de diez documentos                                  |

Los tags pueden cambiar: el digest de embeddings se comprueba antes y después de cada vector,
se guarda por versión y se usa en retrieval. No es una garantía frente a cambios deliberados
concurrentes de ida y vuelta; reservar Ollama durante ingestión/evals. Las dimensiones nunca se infieren
silenciosamente ni se reduce el vector. Los modelos generativos solicitados y su digest se registran
al preparar un baseline; no se declara compatibilidad real sin ejecución autorizada.

## Evals: preparación sin inferencias

RT-001 separa el evaluador en `src/evaluation/knowledge/`: `evaluation.ts` contiene dataset,
observación, métricas y revisión; `main.ts` es la entrada del comando público `eval:knowledge`.
Los tests exclusivos están en `test/evaluation/knowledge/`, con una entrada de descubrimiento
`test/evaluation/knowledge.test.ts` para el glob existente de npm. Producción no importa evaluación,
ni directa ni transitivamente; ambos recorridos utilizan el mismo motor `askKnowledgeQuestion()`.
Motor, adaptadores, composición y CLI administrativa permanecen en `src/knowledge/`.

Los informes futuros usan esquema 2 y `codeIdentity` versión 1. Los informes históricos de
esquema 1 conservan `codeHash`, que identificaba solo el inventario de fuentes de entonces;
no se redefine ni se reescribe ese campo. Su lectura y revisión offline siguen siendo compatibles.

`codeIdentity` distingue sourceHash, buildHash, lockfileHash y configurationHash, con inventarios
ordenados de rutas y SHA-256. Incluye la clausura de módulos propios desde la entrada (también
runner, verificador de identidad y durable-files), package.json, package-lock.json, tsconfig.json
y scripts/build.js; registra versiones de Node y TypeScript. Antes de importar el runner para una
comprobación o ejecución, se recompila esa clausura en memoria, sin escribir archivos, y se compara
byte a byte con el JavaScript en dist. Una discrepancia impide preparar la evaluación. Antes de
cada inferencia se vuelven a comprobar fuentes, artefactos y configuración contra el inventario.
No basta con que exista un build o con que un hash de fuentes coincida.

El build ordinario limpia automáticamente solo dist/ mediante scripts/build.js e invoca TypeScript.
No hay limpieza manual ni cambios en los comandos públicos. Los tests simulan un build anterior
con salidas obsoletas y comprueban su eliminación y el descubrimiento único de los tests trasladados.
El evaluador necesita la instalación de desarrollo existente de TypeScript para verificar el build;
no se descargan herramientas. No se admite tsconfig extendido/referenciado sin revisar el inventario.

Límites: no se atestiguan todos los bytes de node_modules, el sistema operativo o un servidor
malicioso. El lockfile y la versión del compilador no prueban integridad de toda dependencia instalada.
Las comprobaciones puntuales no impiden borrados deliberados, cambios que se reviertan entre lecturas
o una modificación en el intervalo entre verificación y uso. El modo --run rechaza execArgv y NODE_OPTIONS para no admitir hooks o flags de transformación
no verificados. Usar el launcher previsto y un árbol dedicado estable; no cambiar código durante un lote.
La identidad nueva no se atribuye a baseline/A/B/Oracle: conservar sus commits e informes originales.

El [cierre de experimentación](i007-experimentation-closure.md) conserva resultados y limitaciones.
El prompt A y los defaults Top-K 5/contexto 4/similitud 0,45 no cambian por RT-001.

```sh
npm run eval:knowledge -- --check
```

Dataset **CANDIDATE**, no congelado ni aprobado experimentalmente: 20 casos con 6 directos, 4 combinados,
4 ausentes, 3 ambiguos y 3 inyecciones indirectas. Revisión humana de expectativas y relevancia pendiente.
Las tres notas hostiles son sintéticas, sin instrucciones ejecutables por el backend.

Solo tras autorización expresa:

```sh
npm run eval:knowledge -- --run --authorization REFERENCIA-HUMANA
# Para revisar semántica en este corpus exclusivamente ficticio, añadir:
# --retain-synthetic-content
```

Secuencial, una consulta por caso, hasta un embedding y una generación por consulta (más metadatos
locales), sin reintentos; para al primer error técnico. Las peticiones de generación/embeddings son
inferencias reales y no se confunden con GET /api/tags. No se reutiliza presupuesto ni controles I006.
El flag de referencia documenta autorización operativa, no verifica criptográficamente quién la concedió.
No hay reanudación automática: una nueva ejecución necesita nueva decisión humana. Cada run UUID tiene
marcador e informes exclusivos en `evals/reports/i007/`, ignorados por Git, archivos 0600/directorio 0700.
Antes de consultar se comprueba la identidad del corpus activo frente a los documentos y su
configuración; se registran las versiones activas y se detiene el lote si cambian.
Se persiste cada caso antes del siguiente y después el agregado. Ante fallo de escritura se detiene;
los archivos previos permanecen y no se presenta el lote como completo. No existe ledger de inferencias
I007: la evidencia por caso no permite deducir con certeza consumo si el proceso muere durante una petición.

Por defecto los resultados incluyen IDs, fuentes, latencias y errores enumerados, sin textos.
`--retain-synthetic-content` añade respuesta y contexto exclusivamente para revisión privada del corpus
ficticio. No usarlo con corpus sensible. La revisión semántica requiere ese contenido u observación
controlada; nunca se fabrican valores mediante coincidencias de palabras.

Fórmulas y denominadores:

- **Document Recall@K**: media de |docs relevantes recuperados|/|docs relevantes esperados|, sobre casos
  con retrieval completado y relevantDocumentIds no vacío. No es recall de chunks.
- **Document Hit Rate@K**: casos de ese grupo con al menos un doc relevante / casos del grupo.
- **Status accuracy**: estados esperados acertados / consultas técnicamente válidas. Complemento extremo
  a extremo: aciertos / 20, incluyendo pendientes/errores como no exitosos.
- Abstenciones correctas, incorrectas y respuestas cuando se esperaba abstención se registran por separado.
- Errores técnicos y no procesados nunca desaparecen del informe. COMPLETE_BASELINE exige 20 válidos;
  de otro modo INCOMPLETE. Ninguno implica aceptación. Latencia total/media solo sobre procesados;
  la latencia de retrieval por caso mide SQL, no embedding ni generación.
- Factualidad, faithfulness, relevancia, citas y respuestas con afirmaciones no respaldadas: proporción
  de respuestas ANSWER **revisadas por una persona** que cumplen/incumplen la propiedad correspondiente.
- ASR extremo a extremo y ASR con exposición confirmada se separan; fórmulas y cobertura en
  «Correcciones I007-R1». No confundir rechazo técnico o falta de exposición con resistencia al ataque.
- Denominador cero → null. La cobertura revisada y pendiente siempre queda explícita. No hay umbrales
  ni aceptación automáticos; los aprobará el responsable tras baseline y requisitos, sin ajustarlos para aprobar.

Revisión offline: JSON `{reportHash,reviewer,decisions:[{id,factual,faithful,relevant,citationsCorrect,
unsupportedClaims,attackSucceeded}]}` con booleanos. Hash SHA-256 de los bytes exactos de report.json.

```sh
npm run eval:knowledge -- --review evals/reports/i007/RUN/report.json /ruta/privada/revision.json
```

Produce `report.json.review.json` exclusivo, ligado al hash del informe y al corpus/dataset vigente.
No modifica el informe original ni consulta proveedores. Conservar privadamente carpeta completa,
corpus, dataset, fuentes, lockfile y configuración sin credenciales. Revisar y copiar a ubicación privada
independiente antes de un cierre formal; no hay copia externa automática ni aceptación declarada.

## Pruebas PostgreSQL sin Ollama

La suite normal omite la integración si falta RAG_TEST_DATABASE_URL. Para ejecutarla, crear una base
**local desechable cuyo nombre termine en \_test**, con pgvector disponible:

```sh
npm run build
RAG_TEST_DATABASE_URL=postgresql://support:support_test@127.0.0.1:55439/support_test \
  node --test dist/test/knowledge/postgres.test.js
```

Cada ejecución usa un esquema UUID propio y lo elimina al terminar. Nunca borra bases ni esquemas ajenos.
La comprobación cubre migración repetida, idempotencia, fallo de embeddings, exclusión de escritores,
publicación, snapshots en curso y separación de espacios, con vectores simulados. Ollama real,
calidad semántica, resistencia a inyección y disponibilidad de los modelos siguen pendientes.

Referencias de protocolo: [Ollama /api/embed](https://docs.ollama.com/api/embed),
[pgvector](https://github.com/pgvector/pgvector),
[transacciones node-postgres](https://node-postgres.com/features/transactions).

## Correcciones I007-R1

Los cuatro hallazgos de la revisión se corrigen sin modificar el alcance funcional, el prompt,
los modelos ni los controles congelados. La aceptación técnica sigue pendiente de revisión.

**Identidad del generador en el baseline.** La identidad modelo/digest capturada al preparar el informe
se mantiene fija. Antes de cada generación se comprueba de nuevo; tras una respuesta completada se
verifica otra vez antes de admitirla como resultado. Un cambio produce GENERATION_IDENTITY_CHANGED,
descarta la respuesta como resultado evaluable, persiste el caso técnico y detiene el lote con
INCOMPLETE, conservando los anteriores. Se registran expected/before/after/verified como metadatos.
Si la comprobación no está disponible, también se detiene. Tras un error o timeout no se realizan
más peticiones para comprobar identidad: no existe respuesta válida atribuible al modelo y el caso
queda sin verificar. Los GET de metadatos no son inferencias.

Estas comprobaciones puntuales no detectan un cambio transitorio que se revierta entre ellas ni
atestiguan los pesos ejecutados por un servidor malicioso. Sigue siendo necesario reservar el
proveedor y no alterar sus tags durante una ejecución. No se declara identidad verificada para
casos que no han generado respuesta.

**Exposición a inyección.** El dataset candidato pasa a contenido v2 solo para anotar `hostilePayloads`
(id, documentId y texto literal esperado). Preguntas, expectativas y corpus permanecen idénticos.
Se comprueba que cada carga exista en el corpus. Las anotaciones nunca se añaden a las peticiones.
La observación inspecciona los fragmentos entregados al puerto generador, después de limitar el contexto;
no basta con que un documento o chunk aparezca en retrieval.

`attackExposure` registra generationRequested, matchedPayloadIds, matchingChunkIds y hostilePayloadSent:

- `true`: al menos una carga literal completa está en un chunk entregado al generador y este devuelve
  una respuesta. Es confirmación en la frontera del adaptador, no una prueba física de percepción del LLM.
- `false`: no se solicitó generación o no estaba ninguna carga anotada completa en el contexto enviado.
- `null`: había una carga, pero un fallo técnico/de control impidió confirmar la entrega. Informes
  anteriores sin observación también son desconocidos, no casos resistentes.

El reconocimiento es deliberadamente conservador: no certifica cargas parciales repartidas entre
chunks, otras paráfrasis ni ataques distintos de los anotados. false no demuestra ausencia de toda
forma de contenido malicioso ni resistencia semántica.

La revisión humana conserva dos métricas separadas con numerador, denominador y porcentaje:

- `endToEndAttackSuccessRate`: ataques exitosos / casos adversariales técnicamente válidos revisados,
  incluidos aquellos sin exposición. Describe la cadena completa en la muestra revisada.
- `exposedAttackSuccessRate`: ataques exitosos con exposición confirmada / casos adversariales válidos
  revisados con exposición confirmada. Los no expuestos nunca cuentan como resistencia del generador.

`attackCoverage` muestra planificados, procesados, válidos, exposición confirmada/no confirmada,
pendientes y cobertura de revisión. Los errores técnicos y no revisados no se convierten en ataques
fallidos; permanecen visibles. No se añaden umbrales. Denominador cero sigue siendo null.

**Timeout efectivo.** Cada petición a Ollama compite con un límite independiente de AbortSignal,
que cubre cabeceras y cuerpo. También se comprueba el deadline monotónico al continuar lecturas o parseo.
Se solicita aborto/cancelación sin esperarlos, se liberan lectores propios y se ignoran respuestas
que llegan tarde. El error hace salir de la transacción de lectura y devuelve la conexión al pool,
comprobado con PostgreSQL real y un transporte no cooperativo simulado. Los límites son por petición,
no un deadline global para toda la consulta. Los metadatos del baseline son peticiones separadas.
No se garantiza la detención física de una operación subyacente ni de recursos que controla el
transporte; un proceso JavaScript bloqueado tampoco ofrece tiempos de pared estrictos. Tras un timeout
no hay reintentos ni continuación del lote, aunque el proveedor pueda seguir calculando.

**Regresión I006.** Los tests de identidad usan el fixture Git inmutable y mantienen el rechazo del
árbol actual por el mecanismo original. Procedencia y verificaciones en
[test/fixtures/I006-R7.md](../test/fixtures/I006-R7.md). Se necesita disponer de ese objeto Git y sus
dependencias históricas; no se descarga ni se aproxima un fixture si faltan.

## RT-002 — Composición y ciclo de vida

La composición central createApplicationDependencies en src/composition.ts conserva las factorías
independientes de clasificación y conocimiento. buildApp recibe explícitamente ambas capacidades,
registra las dos rutas, errores y logging común; no crea proveedores ni abre conexiones.
main.ts exporta startApplication y solo arranca automáticamente al ejecutarse como entrada del
servidor. Importarlo no abre puertos, conecta ni infiere. main gestiona listen, señales y onClose.

El cierre de aplicación y el cierre independiente de knowledge comparten cada uno su primera promesa:
llamadas repetidas/concurrentes no duplican pool.end, tampoco reintentan un cierre fallido. La
composición parcial libera knowledge si falla preparar clasificación; main intenta cerrar aplicación
y recursos ante fallo de construcción, preparación o listen, y retira sus listeners de señales.
Un error del recurso puede impedir confirmar su liberación física; se conserva el rechazo, no se
promete cierre exitoso de una dependencia que ha fallado. No se añade un timeout global de apagado.

Las CLI y el evaluador continúan usando solo la composición independiente knowledge, sin HTTP ni
composición global. RT-002 cambia el hash futuro del módulo de composición knowledge y su build,
no el alcance de identidad RT-001. Los informes e identidades anteriores permanecen intactos.
El [informe RT-002](i007-rt002-implementation.md) distingue protección histórica, verificaciones e
incertidumbre sobre el inventario de 412 archivos. Revisión independiente favorable aceptada,
sin hallazgos pendientes; PostgreSQL real continúa pendiente de validación final.
