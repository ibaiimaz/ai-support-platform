# I007 — Especificación funcional y técnica

Versión 1.0 · Aprobada por autorización expresa del responsable el 2026-11-23

Proyecto: AI Support Platform\
Iteración: I007 — Asistente de soporte técnico con RAG\
Estado: Implemented\
Modalidad: Spec-Driven Development (SDD ligero)

Esta especificación incorpora las cuatro decisiones que acabas de aprobar y completa los contratos, reglas de negocio, comportamiento ante errores y criterios de aceptación necesarios para que Codex pueda implementar la iteración con autonomía.

El responsable aprueba la especificación y autoriza la implementación integral el 2026-11-23. Los pasajes de propuesta que siguen se conservan como procedencia; DEC-I007-005–012 quedan aprobadas por esa autorización. No se autorizan inferencias reales, evals experimentales ni aceptación funcional.

## Estado vigente — cierre técnico del 2026-11-26

Implementación RAG, experimentación funcional, RT-001, RT-002 y C completadas. Revisiones
independientes favorables y hallazgos resueltos; anotaciones v2 aprobadas por su identidad y hash
exactos. Desde 834d1c2, la validación final incluye PostgreSQL 16.12/pgvector 0.8.1 desechable:
402 tests satisfactorios, cero fallos y cero omisiones. La instancia persistente no se modifica.

El responsable autoriza el cierre técnico y documental como iteración de desarrollo y aprendizaje.
El estado permanece **Implemented**, sin aceptación funcional, declaración Verified ni despliegue
autorizado. No se modifica ningún requisito, decisión ni umbral por el cierre. Los estados fechados
anteriores se conservan como antecedentes, no como pendientes actuales.

El [registro de cierre](../../knowledge/i007-closure.md) recoge commits, resultados y evidencias:
baseline 17/20; A 18/20 provisional; B 19/20 provisional, sobre los mismos veinte casos de desarrollo.
Oracle resuelve solo 008 con contexto manual y no se incluye en métricas ordinarias. No hay validación
independiente. Se mantienen prompt A y 5/4/0,45, sin consolidar B 6/6; el recall retrospectivo de
baseline/A no está disponible por falta de identidad suficiente de fragmentos no retenidos.

## 1. Objetivo

Incorporar a AI Support Platform un asistente de soporte técnico capaz de responder preguntas utilizando exclusivamente una base de conocimiento documental.

El asistente utilizará Retrieval-Augmented Generation (RAG) para recuperar información relevante y proporcionarla como contexto a un modelo generativo local.

La implementación deberá demostrar:

- Recuperación semántica mediante embeddings.
- Generación de respuestas fundamentadas en documentación.
- Abstención cuando la información sea insuficiente.
- Trazabilidad de las fuentes.
- Ingestión segura y publicación consistente de documentos.
- Separación entre validación técnica y experimental.

### Criterio de éxito

I007 estará funcionalmente completada cuando podamos incorporar documentación, realizar consultas, obtener respuestas respaldadas por fuentes y demostrar mediante evals que el sistema satisface los criterios de calidad establecidos.

No basta con que el endpoint funcione o que los tests unitarios pasen.

## 2. Decisiones aprobadas

| ID           | Decisión                                    | Estado   |
| ------------ | ------------------------------------------- | -------- |
| DEC-I007-001 | PostgreSQL + pgvector                       | Aprobada |
| DEC-I007-002 | Ingestión mediante CLI                      | Aprobada |
| DEC-I007-003 | Versión activa y versión en preparación     | Aprobada |
| DEC-I007-004 | Dataset inicial de aproximadamente 20 casos | Aprobada |

### Decisiones técnicas complementarias aprobadas

| ID           | Decisión      | Propuesta                                           |
| ------------ | ------------- | --------------------------------------------------- |
| DEC-I007-005 | Modelos       | Ollama local para embeddings y generación           |
| DEC-I007-006 | Recuperación  | Búsqueda vectorial exacta, Top-K configurable       |
| DEC-I007-007 | Documentos    | Markdown UTF-8                                      |
| DEC-I007-008 | Chunking      | Basado en estructura Markdown, con límite de tamaño |
| DEC-I007-009 | Actualización | Reingestión completa por documento                  |
| DEC-I007-010 | API           | Endpoint síncrono y JSON estructurado               |
| DEC-I007-011 | Validación    | Esquema estricto y fuentes verificadas              |
| DEC-I007-012 | Tests         | `node:test` y herramientas existentes               |

Las decisiones complementarias quedan aprobadas por la autorización expresa de implementación integral del 2026-11-23.

## 3. Alcance funcional

### RF-01. Incorporación de documentación

El sistema debe incorporar documentos Markdown desde un directorio local mediante un comando CLI.

Cada documento tendrá un identificador estable y metadatos mínimos:

| Campo         | Descripción                   |
| ------------- | ----------------------------- |
| `documentId`  | Identificador lógico estable  |
| `title`       | Título del documento          |
| `versionId`   | Identificador de versión      |
| `contentHash` | Huella del contenido original |
| `status`      | Estado de la versión          |
| `createdAt`   | Fecha de creación             |

El sistema no debe asumir que el nombre del archivo es necesariamente su identidad lógica.

Criterios de aceptación

- Un documento válido puede incorporarse correctamente.
- Un documento vacío o inválido es rechazado.
- La reingestión no produce duplicados activos.
- Un fallo de ingestión no afecta a la versión previamente publicada.
- Los documentos no se publican parcialmente.

### RF-02. Fragmentación y embeddings

Los documentos se dividirán en chunks respetando, cuando sea posible, la estructura de encabezados Markdown.

Cada chunk conservará:

```
interface KnowledgeChunk {
  id: string;
  documentVersionId: string;
  section: string;
  position: number;
  content: string;
  embedding: number[];
}
```

El tamaño de los chunks y el solapamiento serán configurables.

Los embeddings se generarán utilizando un modelo local servido por Ollama.

Se almacenará también la identidad del modelo de embeddings y su dimensionalidad.

Criterios de aceptación

- La fragmentación es determinista para una misma configuración y documento.
- No se generan chunks vacíos.
- Se conserva el orden de los fragmentos.
- Se conservan los metadatos necesarios para la trazabilidad.
- Se rechazan embeddings con dimensionalidad incompatible.
- Los errores del proveedor no producen versiones publicables incompletas.

### RF-03. Persistencia y recuperación

La información se almacenará en PostgreSQL con la extensión pgvector.

La búsqueda semántica utilizará similitud vectorial exacta sobre los chunks pertenecientes a versiones activas.

Parámetros configurables:

- `topK`: número máximo de fragmentos recuperados.
- `minSimilarity`: umbral mínimo de similitud.
- `maxContextChunks`: límite de fragmentos enviados al generador.

Criterios de aceptación

- La recuperación devuelve como máximo `topK` resultados.
- Los resultados se ordenan por similitud.
- No se recuperan fragmentos de versiones en preparación.
- No se mezclan embeddings incompatibles.
- Si no existen resultados válidos, no se invoca al generador.

Decisión técnica: la métrica vectorial concreta y la transformación del score deberán quedar definidas explícitamente por Codex en el diseño, con tests que verifiquen su interpretación. No se tratará una similitud como una probabilidad.

### RF-04. Consulta al asistente

Se incorporará el endpoint:

`POST /api/v1/knowledge/ask`

Petición:

```
{
  "question": "¿Qué debo comprobar ante un error de autenticación?"
}
```

La pregunta deberá ser una cadena no vacía, con longitud máxima configurable.

Respuesta satisfactoria:

```
{
  "status": "ANSWER",
  "answer": "Comprueba las credenciales y el estado de la sesión.",
  "sources": [
    {
      "documentId": "authentication-guide",
      "versionId": "v1",
      "chunkId": "authentication-guide:v1:2",
      "title": "Guía de autenticación",
      "section": "Resolución de incidencias"
    }
  ]
}
```

Respuesta sin contexto suficiente:

```
{
  "status": "INSUFFICIENT_CONTEXT",
  "answer": null,
  "sources": []
}
```

### RF-05. Generación fundamentada

El generador recibirá:

1. Instrucciones de la aplicación.
2. Pregunta del usuario.
3. Fragmentos recuperados, delimitados e identificados.

Deberá responder utilizando exclusivamente información respaldada por esos fragmentos.

El modelo no podrá decidir libremente qué fuentes declarar: únicamente podrá seleccionar identificadores del conjunto recuperado.

La aplicación validará las referencias antes de construir la respuesta HTTP.

Criterios de aceptación

- La respuesta cumple el esquema definido.
- Los identificadores citados pertenecen a fragmentos recuperados.
- Una respuesta `ANSWER` contiene texto no vacío y al menos una fuente válida.
- Una respuesta `INSUFFICIENT_CONTEXT` contiene `answer: null` y `sources: []`.
- Las respuestas con formato incorrecto se rechazan.
- Las referencias inexistentes se rechazan.
- El backend no añade como fuentes documentos que el generador no haya citado.

Limitación reconocida: comprobar que una referencia existe no demuestra que respalde semánticamente la respuesta. Esa propiedad deberá evaluarse experimentalmente.

## 4. Versionado y consistencia

Esta es una de las decisiones arquitectónicas centrales de I007.

Cada documento tendrá un identificador lógico estable y un puntero a su versión activa.

Las nuevas versiones se procesarán de forma independiente.

Ciclo de vida de una versión

PENDING

PROCESSING

READY

ACTIVE

Los errores de procesamiento llevan a FAILED.

### RF-06. Publicación atómica

Una nueva versión únicamente podrá publicarse cuando todos sus chunks y embeddings hayan sido persistidos y validados.

La publicación se realizará mediante una operación transaccional que actualice el puntero a la versión activa.

Invariantes

- Un documento tendrá como máximo una versión activa.
- Las consultas nunca utilizarán versiones incompletas.
- Una actualización fallida no despublicará la versión anterior.
- Una consulta conservará una selección coherente de versiones durante toda su ejecución.
- Las operaciones de publicación concurrentes deberán estar protegidas frente a condiciones de carrera.

Para mantener el alcance reducido, I007 conservará la versión activa y la versión en preparación. Las versiones sustituidas podrán eliminarse según una política sencilla de limpieza, pero nunca mientras puedan ser utilizadas por consultas en curso.

### RF-07. Reingestión

La reingestión completa de un documento deberá ser idempotente.

Si el contenido y la configuración relevante no han cambiado, el sistema evitará crear innecesariamente una nueva versión.

Si han cambiado, generará una versión nueva.

En esta iteración no se reutilizarán embeddings entre versiones: se recalcularán todos los chunks del documento.

Esto simplifica la implementación y mantiene una frontera clara para futuras optimizaciones.

## 5. Seguridad y límites de confianza

Los documentos recuperados se tratarán como datos, nunca como instrucciones con autoridad sobre el asistente.

### RF-08. Protección frente a instrucciones maliciosas

El sistema deberá:

- Delimitar explícitamente los fragmentos recuperados.
- Instruir al modelo para ignorar órdenes operativas presentes en ellos.
- No permitir que los documentos modifiquen el prompt de sistema.
- Validar el contrato de salida.
- No ejecutar acciones solicitadas por el contenido documental.

I007 no tendrá herramientas con efectos externos ni operaciones de escritura disponibles para el generador.

Esto reduce considerablemente la superficie de ataque.

### RF-09. Protección de información

Los logs no incluirán por defecto el contenido completo de preguntas, documentos, fragmentos o respuestas.

Se registrarán metadatos técnicos suficientes para diagnóstico, evitando información sensible.

La documentación inicial será ficticia y no contendrá datos personales reales.

Alcance de autorización: esta iteración trabajará con un único corpus interno autorizado, sin permisos documentales por usuario. No se diseñará una falsa separación de acceso que dependa únicamente del prompt.

## 6. Errores y comportamiento HTTP

La aplicación debe distinguir los errores funcionales de los técnicos.

| Situación                        | HTTP | Comportamiento         |
| -------------------------------- | ---- | ---------------------- |
| Pregunta válida y respondida     | 200  | `ANSWER`               |
| Información insuficiente         | 200  | `INSUFFICIENT_CONTEXT` |
| Pregunta inválida                | 400  | Error de validación    |
| Ollama no disponible             | 503  | Error técnico          |
| Base de datos no disponible      | 503  | Error técnico          |
| Timeout del proveedor            | 504  | Error técnico          |
| Respuesta inválida del generador | 502  | Error de proveedor     |

Los errores HTTP utilizarán el contrato común de la aplicación, si ya existe uno adecuado.

No se devolverán trazas internas ni detalles sensibles.

### Política de reintentos

Para I007 propongo no introducir reintentos automáticos de generación.

Los fallos se registrarán y devolverán de forma controlada.

La ingestión podrá reejecutarse de forma segura gracias a la idempotencia, pero no añadiremos todavía una infraestructura compleja de reintentos, colas o workers.

## 7. Arquitectura hexagonal

La nueva funcionalidad debe integrarse con la arquitectura existente sin modificar innecesariamente los componentes de clasificación.

### Casos de uso

| Caso de uso               | Responsabilidad                        |
| ------------------------- | -------------------------------------- |
| `IngestKnowledgeDocument` | Incorporar y procesar un documento     |
| `PublishKnowledgeVersion` | Publicar una versión validada          |
| `AskKnowledgeQuestion`    | Recuperar contexto y generar respuesta |

### Puertos orientativos

```
interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

interface KnowledgeRepository {
  search(
    embedding: number[],
    options: SearchOptions
  ): Promise<RetrievedChunk[]>;
}

interface AnswerGenerator {
  generate(input: GenerationInput): Promise<GenerationResult>;
}
```

Codex deberá adaptar estos contratos a las convenciones existentes.

No deberá crear abstracciones genéricas adicionales sin una necesidad concreta.

### Adaptadores previstos

- Ollama para embeddings.
- Ollama para generación.
- PostgreSQL + pgvector para persistencia y recuperación.
- CLI para ingestión.
- HTTP para consultas.

### Compatibilidad con I006

I007 será una capacidad independiente.

No deberá modificar la semántica de `POST /api/v1/incidents/classify` ni asumir que la validación experimental de I006 ha sido completada.

Los problemas pendientes de I006 no deben resolverse indirectamente mediante cambios no relacionados en I007.

## 8. Corpus inicial y evals

### Dataset documental

Se preparará un corpus ficticio de aproximadamente 8–12 documentos Markdown.

Los documentos contendrán información suficientemente variada para comprobar:

- Recuperación directa.
- Información distribuida entre varios fragmentos.
- Ausencia de información.
- Preguntas ambiguas.
- Instrucciones maliciosas incrustadas.

### Dataset de evaluación

Se prepararán aproximadamente 20 casos:

| Categoría                       | Casos |
| ------------------------------- | ----- |
| Respuesta directa               | 6     |
| Combinación de fragmentos       | 4     |
| Ausencia de respuesta           | 4     |
| Contexto ambiguo o insuficiente | 3     |
| Prompt injection indirecto      | 3     |
| Total                           | 20    |

Cada caso tendrá, como mínimo:

```
interface RagEvalCase {
  id: string;
  question: string;
  expectedStatus: "ANSWER" | "INSUFFICIENT_CONTEXT";
  relevantDocumentIds: string[];
  expectedFacts: string[];
  forbiddenClaims?: string[];
}
```

El esquema podrá ampliarse cuando resulte necesario para evaluar correctamente la fundamentación y las citas.

### Métricas

Retrieval

- Recall\@K.
- Hit Rate\@K.
- Latencia de recuperación.

Generación

- Corrección factual.
- Faithfulness.
- Relevancia de respuesta.
- Corrección de las citas.

Seguridad y abstención

- Attack Success Rate.
- Abstenciones correctas.
- Abstenciones incorrectas.
- Respuestas emitidas sin evidencia suficiente.

Operación

- Latencia total.
- Errores técnicos.
- Disponibilidad de dependencias.

### Umbrales de aceptación propuestos

Para evitar fijar umbrales arbitrarios sin evidencia, propongo una estrategia en dos etapas:

Etapa 1 — Baseline experimental

Ejecutar el dataset completo, registrar los resultados y analizar los fallos.

Etapa 2 — Aceptación funcional

Definir y aprobar umbrales cuantitativos a partir de los requisitos del caso de uso y de los resultados del baseline.

No se permitirá declarar la aceptación funcional simplemente ajustando los umbrales para que coincidan con el resultado obtenido.

Las ejecuciones reales con Ollama requerirán autorización explícita.

## 9. Requisitos no funcionales

| ID     | Requisito                                          |
| ------ | -------------------------------------------------- |
| RNF-01 | TypeScript estricto y convenciones existentes      |
| RNF-02 | Tests mediante `node:test`                         |
| RNF-03 | Sin servicios externos de pago                     |
| RNF-04 | Configuración mediante variables de entorno        |
| RNF-05 | Inicio controlado cuando Ollama no esté disponible |
| RNF-06 | Migraciones reproducibles de base de datos         |
| RNF-07 | Documentación de instalación y ejecución           |
| RNF-08 | Logs técnicos sin contenido sensible por defecto   |
| RNF-09 | Sin regresiones en endpoints existentes            |
| RNF-10 | Sin despliegue automático                          |

### Configuración

Se deberán poder configurar, como mínimo:

- URL de Ollama.
- Modelo generativo.
- Modelo de embeddings.
- Conexión PostgreSQL.
- Top-K.
- Umbral de similitud.
- Límite de contexto.
- Timeouts.
- Directorio de documentación.

Los valores por defecto deberán documentarse y justificarse.

## 10. Entregables de Codex

La implementación deberá producir:

1. Código de aplicación e infraestructura.
2. Migraciones PostgreSQL y configuración pgvector.
3. CLI de ingestión.
4. Endpoint de consulta.
5. Corpus documental de ejemplo.
6. Tests deterministas.
7. Dataset y ejecutor de evals.
8. Documentación de uso.
9. Informe técnico de implementación.
10. Informe de revisión independiente.

El ejecutor de evals debe permitir preparar y revisar los casos sin lanzar inferencias reales de forma accidental.

### Criterios de finalización técnica

- Compilación correcta.
- Lint y formato correctos.
- Tests deterministas superados.
- Migraciones verificadas.
- Ingestión idempotente.
- Publicación atómica.
- Contratos HTTP validados.
- Ausencia de regresiones conocidas atribuibles a I007.
- Revisión independiente completada.

La finalización técnica no implica aceptación funcional.

## 11. Plan SDD de ejecución

1. Aprobación de especificación

   Revisamos este documento y cerramos los cambios necesarios.

2. Preparación de la implementación

   Codex inspecciona el repositorio, identifica convenciones y prepara un plan técnico breve. Solo deberá solicitar intervención si encuentra incompatibilidades importantes con la especificación.

3. Implementación autónoma

   Codex implementa los requisitos, tests, corpus y ejecutor de evals, sin ejecutar experimentos reales con Ollama.

4. Revisión independiente

   Un segundo proceso de revisión analiza cumplimiento, seguridad, arquitectura, tests y regresiones.

5. Validación experimental

   Con autorización expresa, ejecutamos los evals, analizamos los resultados y decidimos si procede aceptar funcionalmente la iteración.

## 12. Riesgos y decisiones diferidas

| Riesgo                                                 | Tratamiento                                         |
| ------------------------------------------------------ | --------------------------------------------------- |
| El retrieval no encuentra información existente        | Evals de recuperación                               |
| Similitud alta pero contexto insuficiente              | Abstención y evals                                  |
| El modelo inventa referencias                          | Validación de identificadores                       |
| El modelo cita una fuente que no respalda la respuesta | Evals de fundamentación                             |
| Prompt injection documental                            | Separación de instrucciones y pruebas adversariales |
| Actualización documental incompleta                    | Versionado y publicación atómica                    |
| Latencia elevada de Ollama                             | Medición antes de optimizar                         |
| Complejidad arquitectónica excesiva                    | Puertos mínimos y alcance limitado                  |

No implementaremos todavía reranking, búsqueda híbrida, agentes, MCP ni una infraestructura general de procesamiento documental.

## 13. Consideraciones de la propuesta original (antecedente)

La especificación está suficientemente desarrollada para orientar la implementación, pero hay tres decisiones técnicas que merecen especial atención.

Primera: el versionado. Hemos acordado versión activa y versión en preparación. Para que eso funcione correctamente también debemos definir qué ocurre con una versión sustituida mientras hay consultas en curso. La implementación debe garantizar que esas consultas puedan terminar sin perder los fragmentos que estaban utilizando.

Segunda: las citas. El backend podrá verificar que el LLM cita un fragmento existente, pero no podrá garantizar de manera determinista que ese fragmento respalde cada afirmación. Esa diferencia debe quedar reflejada en los evals y en los criterios de aceptación.

Tercera: el baseline. Los aproximadamente 20 casos constituyen un conjunto inicial de aprendizaje y validación, no una prueba estadística definitiva de fiabilidad en producción. Deberemos evitar afirmaciones de calidad que la evidencia no sostenga.

### Estado histórico de I007 — 2026-11-23

Especificación v1.0 aprobada por autorización expresa del responsable. Implementación disponible
para revisión: **Implemented**, sin aceptación técnica independiente ni aceptación funcional.
Experimentos Ollama y evals reales no autorizados ni ejecutados. Las comprobaciones nuevas incluyen
PostgreSQL real con vectores simulados. I007-R1 corrige los hallazgos de identidad, exposición y timeouts; los controles históricos de
I006 se mantienen intactos y se prueban con un fixture inmutable. La aceptación técnica de las
correcciones sigue pendiente de revisión independiente y humana.

El texto de propuesta que sigue es histórico, no una nueva solicitud de aprobación.

Mi propuesta es que revises ahora el documento como una única unidad. Puedes señalar cualquier cambio de alcance, requisito o decisión técnica. Una vez resueltos, lo convertiremos en la versión aprobada y prepararemos una instrucción integral para Codex, evitando volver al ciclo de implementación requisito por requisito.

## 14. Diseño de implementación I007 — 2026-11-23

- Capacidad independiente en `src/knowledge`, con tipos de dominio, puertos específicos, casos de uso y adaptadores. No se cambian clasificadores, prompts ni runners I001–I006. El test de I006 ligado al estado inicial del manifiesto es un antecedente conocido, fuera de este alcance.
- Coseno exacto con pgvector `<=>`, score `1 - distancia`, rango [-1,1]; no es probabilidad. Sin índices aproximados. Filtrar por versión activa, digest/modelo/dimensionalidad del espacio de embeddings y umbral antes de Top-K.
- Documento UTF-8 con front matter obligatorio `documentId` y `title`, independientes del nombre de archivo. SHA-256 de bytes originales y fingerprint de chunking + espacio de embeddings para idempotencia.
- Lease de escritor por documento con advisory lock de sesión; publicación transaccional y consultas REPEATABLE READ READ ONLY durante recuperación/generación. Las versiones sustituidas se eliminan lógicamente al publicar; MVCC conserva sus filas para snapshots en curso hasta terminar. No se consultan punteros activos de nuevo para construir las fuentes. Se documenta el coste de mantener una conexión durante la generación.
- Respuesta interna del generador: ANSWER con texto y lista de chunkIds, o INSUFFICIENT_CONTEXT con null y lista vacía; Ajv sin coerción ni propiedades adicionales, IDs restringidos a contexto enviado y comprobados otra vez en aplicación. Metadatos públicos se copian exclusivamente del snapshot, sin fuentes añadidas por backend.
- Configuración independiente RAG_*, sin cambiar defaults del clasificador. Ollama embeddings `/api/embed` con truncate false y generación `/api/chat` con schema, temperatura 0 y sin herramientas/reintentos. Digest del modelo de embeddings comprobado y dimensiones validadas; ninguna consulta al proveedor al arrancar.
- CLI de ingestión y evals por defecto --check sin red; --run explícito para inferencias futuras. Baseline secuencial y sin aceptación automática; métricas semánticas requieren revisión humana, no coincidencia literal como sustituto de fundamentación. No se ejecutarán esos modos reales durante la implementación.
- Revisión independiente y baseline experimental quedan pendientes; no se inventarán umbrales ni informes de revisión de otro revisor.

## 15. Entrega inicial para revisión (antecedente)

[Informe técnico y trazabilidad RF/RNF](../../knowledge/implementation.md).
[Instalación, contratos, configuración y evals](../../knowledge/README.md).
El corpus y los casos son candidatos sintéticos; revisión humana, revisión técnica independiente,
baseline real y umbrales de aceptación siguen pendientes. Implemented no equivale a Verified.

## 16. Correcciones I007-R1 para revisión (antecedente resuelto)

Autorizadas por el responsable, sin cambios de alcance ni umbrales. La revisión externa se toma de
los cuatro hallazgos reproducidos en su instrucción. Se preservan los artefactos históricos y el
rechazo del árbol modificado por I006; los tests de propiedades congeladas usan una revisión verificable.
El baseline comprueba el digest generativo antes y después de cada respuesta válida y se detiene ante
cambios o imposibilidad de verificar. El dataset candidato v2 añade cargas hostiles explícitas sin
cambiar preguntas ni expectativas: la exposición se observa sobre el contexto realmente entregado
al generador, con ASR extremo a extremo y condicionado a exposición confirmada separados y cobertura
visible. El timeout del transporte es efectivo aunque la cancelación no coopere; no se promete la
detención física del proveedor. Véanse la guía y el informe para pruebas y límites. No hay aceptación
funcional, inferencias autorizadas, despliegue ni cambios de estado a Verified.
