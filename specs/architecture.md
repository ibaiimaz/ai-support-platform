# Arquitectura

## Estado vigente: I006 revisión 7 — 2026-11-19

Implementación y revisión técnica de R7 **aprobadas**. Cierre de esta fase: **KNOWN_REGRESSION INCOMPLETE**, **INDEPENDENT_HOLDOUT NOT_EXECUTED**. I006 permanece **Implemented**: validación experimental no acreditada, aceptación funcional no concedida y despliegue no autorizado. No se realizarán más experimentos ni modificaciones funcionales en esta fase; todos los permisos de inicialización y ejecución están desactivados.

Diseño aprobado e implementación autorizada de la [arquitectura híbrida](iterations/006-tool-calling.md#19-revisión-7--diseño-aprobado-implementación-autorizada). Las descripciones de revisiones anteriores que siguen se conservan como antecedentes, no como protocolo actual.

La descripción original determina las referencias elegibles: sin IDs válidos, NO_LOOKUP desde backend y una inferencia final estructurada; con IDs, decisión nativa con enum y validación de pertenencia posterior, consulta opcional y clasificación final (dos inferencias). Máximo una herramienta, sin reintentos, 45/5/90 s; HTTP y rutas I002–I005 intactos. El texto libre de decisión no se utiliza.

Qwen3 8B Q4_K_M es candidato, digest `500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41`, temperatura 0, think false. La composición de evaluación lo prepara explícitamente; `loadConfig` conserva Llama por defecto, sin despliegue ni promoción. La mejora del prompt no está validada experimentalmente; el parcial no permite atribuirle eficacia.

El protocolo conserva dos cohortes separadas y sus manifiestos. KNOWN_REGRESSION terminó con 12/60 casos evaluables, 12/12 clasificaciones finales correctas, 10/10 decisiones deterministas correctas, dos consultas innecesarias y un error MIXED_CONTENT_AND_TOOLS. El holdout no se inicializó ni ejecutó; no hay evidencia adversarial ni pares contrafactuales completos. Estos resultados parciales no se extrapolan. La sección 21 de la especificación I006 registra el cierre y las líneas de mejora diferidas. Se preservan las autorizaciones utilizadas y todas las evidencias históricas, sin reactivar permisos ni promover el candidato.

## Estado y alcance

Arquitectura implementada para la primera iteración, en estado `Verified` desde el **2026-11-04** tras revisión y aceptación humana. El contrato normativo se mantiene en la [especificación 001](iterations/001-classification.md). La aceptación de la implementación se registra mediante el estado de la iteración.

La composición HTTP fuente incorpora el flujo híbrido de revisión 7, aprobado técnicamente pero sin validación experimental acreditada; no se ha realizado un despliegue. La revisión 6 se implementó y aceptó el 2026-11-18; no sigue pendiente de implementación. Las secciones de I001–I005 y revisión 6 siguientes describen sus antecedentes, con separación definitiva de rutas históricas conforme a AC-24.

## Stack

| Elección                                                | Motivo y coste                                                                                                                                            | Alternativa considerada                                           |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Node.js LTS soportado, TypeScript estricto, ESM y `tsc` | Entorno reproducible y tipos estáticos; los datos externos siguen necesitando validación                                                                  | JavaScript reduce herramientas, pero pierde comprobación estática |
| Fastify                                                 | Validación JSON Schema, logging e integración HTTP con `inject`; exige configurar explícitamente el validador                                             | Express requiere más piezas; `node:http`, más código manual       |
| JSON Schema y Ajv como dependencia directa              | Construir en el adaptador el esquema desde las categorías comunes y usarlo para structured outputs y validación local; mantener alineados tipos y esquema | Zod añade conversión a JSON Schema                                |
| `fetch` y `AbortController` nativos                     | Evitan SDK y cliente HTTP adicionales; requieren gestionar protocolo y cancelación                                                                        | SDK de Ollama, innecesario para una única operación               |
| `node:test` y `node:assert/strict`                      | Sin framework adicional; menos utilidades de mocks                                                                                                        | Vitest ofrece más herramientas con otra dependencia               |

Las versiones concretas están fijadas en el manifiesto y lockfile. Prettier y ESLint son herramientas de desarrollo para aplicar las [convenciones permanentes](../AGENTS.md#legibilidad-y-mantenibilidad), sin dependencias adicionales de ejecución. ESLint utiliza el parser de TypeScript y reglas puntuales de ESLint Stylistic; se evita una configuración extensa y el análisis de tipos duplicado respecto a `tsc`. No se añaden generadores, frameworks SDD, LangChain ni contenedores de dependencias.

## Componentes implementados

```text
src/
  domain/classification.ts
  application/
    classify-incident.ts
    incident-classifier.ts
    classification-errors.ts
  http/
    app.ts
    classify-route.ts
    error-handler.ts
    schemas.ts
  infrastructure/ollama/
    ollama-classifier.ts
    classification-instructions.ts
    inference-descriptor.ts
  evaluation/
    dataset.ts
    types.ts
    run-evaluation.ts
    metrics.ts
    report.ts
    main.ts
  config.ts
  main.ts
test/
  unit/
  http/
  ollama/
  evaluation/
evals/
  datasets/incidents-v1.json
  reports/  # Generados localmente, ignorados por Git
```

- `domain`: categorías permitidas y tipo de clasificación, independientes del proveedor y sin esquemas de protocolo.
- `application`: caso de uso, puerto de clasificación y errores técnicos independientes del transporte.
- `http`: validación de entrada, normalización y traducción de errores al contrato público.
- `infrastructure/ollama`: instrucciones, protocolo del proveedor, descriptor compartido de inferencia (esquema desde las categorías del dominio y opciones), timeout y validación de la respuesta.
- `config.ts`: lectura y validación de entorno al arrancar.
- `main.ts`: composición y apertura del servidor; `app.ts` construye la aplicación sin escuchar en un puerto.

Las dependencias apuntan hacia el contrato de aplicación y el dominio. El caso de uso no importa Fastify ni detalles de Ollama. La composición conecta el adaptador con el puerto sin contenedor de inyección.

## Puerto y flujo

Contrato conceptual: `classify(description: string) → Promise<Classification>`, donde `Classification` contiene exclusivamente la categoría permitida. El puerto declara errores técnicos mediante un código discriminante; no recibe modelo, URL, prompt ni objetos HTTP. El timeout pertenece al adaptador.

Flujo: HTTP valida y normaliza → caso de uso invoca el puerto → adaptador llama a Ollama → adaptador valida sobre y contenido → caso de uso devuelve el resultado → HTTP responde o traduce el error.

Ollama recibe `POST /api/chat`, mensajes `system` y `user` separados, `stream: false`, JSON Schema en `format` y `temperature: 0`. Las instrucciones se mantienen en un módulo propio. La descripción nunca se concatena al mensaje de sistema. No se conserva historial entre peticiones.

El adaptador construye su JSON Schema a partir de la definición común del dominio, sin infraestructura genérica de conversión ni dependencias de Ollama en el dominio. Usa ese esquema para structured outputs y validación local.

El adaptador devuelve solo resultados validados. El caso de uso permanece igual al sustituir el proveedor; véase [ADR-002](adr/ADR-002-provider-abstraction.md). La respuesta es síncrona conforme a [ADR-001](adr/ADR-001-sync-classification.md).

## Evaluación semántica I002

La [iteración I002](iterations/002-classification-evals.md) añade un punto de composición manual en `src/evaluation/main.ts`. El flujo es: validar configuración y dataset → instanciar `OllamaClassifier` → llamar a `classifyIncident` secuencialmente → calcular métricas puras → validar y guardar informe JSON local.

El evaluador depende del caso de uso y del puerto existentes, sin importar HTTP ni abrir un servidor. Los tests pueden inyectar un proveedor simulado; la entrada manual usa el adaptador real. Los errores conocidos se conservan como resultados y permiten continuar; una excepción inesperada detiene la ejecución con informe parcial si la escritura es viable. Los detalles normativos de métricas y finalización permanecen en I002.

`inference-descriptor.ts` expone los mismos valores que ya usaba el adaptador, ahora inmutables y compartidos con los metadatos. La extracción no altera mensajes, prompt ni comportamiento productivo. Hay regresión del payload, del hash del prompt de I001 y de sus casos de error.

No se añaden dependencias. Los informes usan hashes del dataset y prompt, configuración efectiva y referencia opcional de Git; no hay hashes de módulos ni del lockfile. Se excluyen de Git y de formato automático. I002 está `Verified` desde el **2026-11-05**, tras aceptar el dataset v2 y la evaluación real identificada en su especificación. La baseline experimental conserva la vulnerabilidad de prompt injection; su cierre no modifica el clasificador. I003 incorpora infraestructura experimental aprobada, sin modificar la arquitectura hexagonal ni el contrato público; su cierre experimental negativo del 2026-11-06 conserva el prompt productivo original.

## Experimentación de prompts I003

La composición de evaluación puede pasar un texto de sistema registrado al adaptador Ollama. El segundo argumento es opcional y su valor por defecto sigue siendo el prompt original; `src/main.ts` no cambia. El caso de uso y el puerto continúan independientes de prompts y del proveedor.

Los módulos H1/H2/H3/H4 y sus metadatos están en el registro de `src/evaluation/prompts.ts`. El manifiesto JSON relaciona candidatos, datasets, objetivos inducidos, configuración y puertas, sin introducir un framework. Los informes v2 se construyen desde la misma definición de prompt enviada al adaptador. Se conserva lectura/validación de v1; la comparación experimental exige contexto v2 completo y compatible.

Los módulos `analysis.ts`, `comparison.ts` y `decisions.ts` reutilizan las métricas de I002 para desgloses, pares, puertas y desempates. No usan la latencia para decidir ni seleccionan/promueven automáticamente en producción. La revisión humana individual puede vetar cualquier candidato, aunque supere las puertas numéricas.

`experiment.ts`, `experiment-manifest.ts` y `experiment-budget.ts` componen ejecución, autorizaciones, referencia congelada y reservas locales de presupuesto. El protocolo de cada fase incluye la referencia y anotaciones adversariales para impedir cambiar su interpretación después de observar resultados. Una reserva incompleta no se reintenta automáticamente. `code-reference.ts` comparte la referencia Git opcional con I002.

El dataset de validación fue revisado, aprobado y congelado el 2026-11-06. H1/H2/H3 preceden a su preparación; H4 se diseñó tras desarrollo sin consultar su contenido. Aislamiento procedimental. Cierre negativo aprobado: ningún candidato elegible, H5 o promoción. AC-11 se completó ejecutando solo el original en validación; seis runs y **360/480** inferencias totales, 120 no autorizadas. Ambas fases desactivadas y selección vacía. Estado final `Verified` el 2026-11-06, con aceptación humana y comprobaciones finales satisfactorias. El permiso mínimo `validation: "baseline-only"` limita la fase al original aun con selección de candidato; se conservan los booleanos anteriores y el ledger impide repeticiones. No cambia el puerto, el adaptador ni la producción. Detalles en [I003](iterations/003-prompt-robustness.md#21-autorización-excepcional-para-completar-ac-11--2026-11-06).

## Restricciones operativas

Para el endpoint, la especificación 001 es la fuente de límites, variables de entorno, códigos de error y políticas de timeout. I002 reutiliza la configuración del proveedor y define por separado los estados de evaluación y códigos de salida del runner. No hay reintentos, fallback de categoría ni descarga automática de modelos. La API puede arrancar aunque Ollama esté temporalmente inaccesible.

Los logs contienen metadatos técnicos y un identificador de petición, sin cuerpos, prompts, descripciones ni respuestas crudas. Los errores externos no se serializan indiscriminadamente.

## Riesgos documentados

- Prompt injection y ambigüedad: separar roles y restringir el formato no garantiza exactitud semántica.
- La temperatura cero no garantiza resultados idénticos.
- Carga inicial y concurrencia local pueden agotar el timeout; no se ofrece garantía de capacidad bajo carga.
- Abortar HTTP no garantiza que Ollama detenga inmediatamente su cálculo.
- Los caracteres no equivalen a tokens: comprobar el contexto de la combinación modelo/prompt al implementar.
- Registrar las versiones utilizadas de Node, Ollama y modelo para reproducibilidad; revisar también los logs del entorno y de Ollama.

## Referencias técnicas

- [Ollama: structured outputs](https://docs.ollama.com/capabilities/structured-outputs).
- [Ollama: API de chat](https://docs.ollama.com/api/chat).
- [Fastify: validación](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/).
- [Fastify: pruebas](https://fastify.dev/docs/latest/Guides/Testing/).
- [Node.js: APIs globales](https://nodejs.org/api/globals.html).

## Comparación de modelos I004

`src/evaluation/model-comparison/` añade composición, contrato estricto de manifiesto/informe v3, ledger independiente, observación local y CLI de comparación. Reutiliza el caso de uso, adaptador, métricas y análisis; `paired-results.ts` comparte solo el emparejamiento puro por ID. El comparador I003 conserva el rechazo de modelos distintos y sus controles/ledger permanecen intactos.

La configuración I004 se construye localmente desde el manifiesto y el modelo explícito, con 45000 ms; no cambia process.env, defaults productivos (Llama/30000 ms), esquema o prompt. ObserverIO y la factoría de clasificador permiten tests con todos los efectos externos simulados; las autorizaciones reales son false por defecto. Presupuesto separado 3+3+60+60, permisos por fase/modelo, progreso durable y parciales sin reanudación automática. El observador real verifica identidad/residencia y se detiene tras timeout si no puede confirmar inactividad, sin usar residencia como prueba de ausencia de cálculo.

Las muestras RSS/PID/PPID y snapshots de residencia se registran con límites; máximo observado no es pico real. No se expone telemetría interna que el adaptador descarta ni se modifica el puerto para obtenerla. Informes y snapshots propios en `evals/reports/i004/`, sin descripciones completas, ignorados por Git. El método compara sistemas nativos, no pesos aislados; ninguna señal promueve modelos. [I004](iterations/004-local-model-comparison.md) y [guía operativa](../evals/experiments/i004-usage.md) recogen autorización, cobertura y límites. Los modelos se instalaron bajo autorización y compatibilidad y benchmark se completaron el 2026-11-06; auditoría documental el 2026-11-09 confirma 126/126 intentos, cero errores técnicos y todos los permisos desactivados. I004 quedó Verified el 2026-11-09 tras revisión final y copia privada verificada fuera del proyecto, sin promoción ni validación independiente. Los originales permanecen en i004/; comparación e informe humano privados se conservan junto a ese directorio para respetar su lista de archivos permitidos.

## Validación independiente I005

I005 quedó **Verified el 2026-11-10** por aceptación humana expresa, tras dos brazos completos,
auditoría independiente y conservación externa verificada. Reutiliza caso de uso, adaptador y
métricas mediante composición experimental separada, ledger durable y permisos por brazo;
no cambia contratos históricos ni producción (Llama, prompt original, timeout 30 s).
Consumo final 180/180, sin reservas pendientes y permisos efectivos desactivados.
El [registro de cierre](../evals/experiments/i005-usage.md#cierre-formal--2026-11-10) conserva
aceptación, resultados, 15 criterios y referencias privadas sin modificar los seis artefactos
congelados. La mejora observada de Gemma es +13/90, con dos regresiones; dataset sintético,
plantillas nativas distintas y recursos descriptivos limitan su interpretación. Verified no
constituye autorización de despliegue ni selección automática de modelo.

## Composición HTTP I006 implementada — revisión 6

La composición productiva vigente sustituye el flujo HTTP histórico por I006. Las descripciones
y cierres I001–I005 anteriores son antecedentes; sus artefactos, adaptadores y runners se
conservan. La implementación no marca I006 Verified. Las ejecuciones posteriores y sus resultados cerrados se registran en la [guía I006](../evals/experiments/i006-usage.md#ejecuciones-históricas-cerradas); no verifican el diseño posterior de revisión 6.

`main.ts` carga la configuración y llama a `createClassificationDependencies()` en
`src/composition.ts`. La factoría construye `OllamaClassificationLlm` con URL/modelo,
`SyntheticIncidentRepository` sin indisponibilidades simuladas y dos instrucciones explícitas:
`lookup-decision-instructions.ts` y `classification-final-instructions.ts`. El prompt anterior
`tool-calling-instructions.ts` se conserva como artefacto histórico. `buildApp()` y la ruta reciben únicamente dependencias I006,
sin una sobrecarga HTTP histórica. Tras la migración de AC-24 en la fase 8, el caso de uso
acepta exclusivamente `ToolCallingDependencies` y devuelve `ClassificationResult`; ya no
contiene sobrecargas ni detección dinámica del clasificador histórico. La orquestación implementa ahora las dos fases de revisión 6.

I002–I005 comparten `src/evaluation/run-evaluation.ts`, que invoca directamente
`classifier.classify(example.description.trim())`. Se conservan el contexto del método y
la normalización histórica en ese runner. Las cuatro entradas de evaluación, el puerto
`IncidentClassifier`, `OllamaClassifier`, los prompts, esquemas, modelos, temperaturas,
timeouts y políticas de errores, concurrencia y reintentos permanecen sin cambios. HTTP y
el runner I006 siguen utilizando exclusivamente la orquestación `classifyIncident()`.
La reproducción histórica conserva el procedimiento; no garantiza respuestas idénticas
del modelo real ni implica repetir inferencias para verificar esta migración.

El caso de uso coordina hasta dos inferencias y una herramienta, aplica límites constantes
45/5/90 segundos con reloj monotónico y valida respuestas y solicitudes. Los mensajes del
usuario y los resultados de herramienta son datos no confiables; se mantienen separados del
sistema y los resultados se serializan con rol tool. `loadConfig()` conserva su validación
histórica de `OLLAMA_TIMEOUT_MS`, pero solo URL/modelo se usan en la composición I006.

HTTP mantiene entrada, ruta y respuesta exitosa `{category}`. Una abstención normal,
incluida la posterior a NOT_FOUND, da 422 INSUFFICIENT_CONTEXT; después de UNAVAILABLE da
503 CLASSIFICATION_UNAVAILABLE. Ambos resultados de herramienta permiten 200 si finalmente
se clasifica. Fallos de proveedor/protocolo, solicitudes inválidas y deadline global dan
502 PROVIDER_ERROR; errores inesperados dan 500 seguro. Se conserva el sobre I001 y los
códigos de validación/ruta/tamaño/contenido. Los logs contienen solo metadatos y causas
controladas, sin prompts, argumentos, descripciones, respuestas crudas ni excepciones completas.

Las pruebas deterministas de revisión 6 verifican composición, protocolo con fetch simulado,
resultados de herramienta, privacidad y regresiones. La evidencia real posterior incluye un
smoke satisfactorio, un experimento INCOMPLETE y dos diagnósticos cerrados, no una puerta
experimental superada. No se adopta tools + format simultáneo. La cancelación sigue siendo
best effort y no se acredita resistencia semántica general.

## Arquitectura I006 — revisión 6 implementada, evaluación real pendiente

El [ADR-003](adr/ADR-003-separate-lookup-decision-and-classification.md) conserva arquitectura
hexagonal sencilla y composición explícita. No cambia HTTP, categorías, repositorio, herramienta,
transporte, límites ni la ruta histórica de I002–I005.

| Paso                 | Petición y responsabilidad                                                                                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decisión LLM         | Instrucciones de consulta y descripción original; tools nativas, sin format. Validar sobre; devolver llamadas intactas o `no_lookup` si no hay campo nativo de llamadas. Ignorar el texto como clasificación o instrucciones |
| Herramienta opcional | Aplicación valida nombre, argumentos, ID y límites; como máximo una consulta; serializa FOUND/NOT_FOUND/UNAVAILABLE como datos no confiables                                                                                 |
| Clasificación LLM    | Siempre necesaria para completar; instrucciones de clasificación, descripción original y turno/resultado de herramienta cuando exista. Sin tools, con esquema final y validación local estricta                              |

Se reutiliza el mismo `ClassificationLlm.infer()` y su opción `toolsEnabled`. Se amplía
`LlmResponse` con `LookupDecision`/`no_lookup` y se valida según fase. Clasificación o abstención
internas no son admisibles como decisión; `no_lookup` no es resultado final. En la segunda fase
se conservan las solicitudes nativas adicionales para que aplicación las rechace. Una lista
vacía de llamadas sigue siendo solicitud inválida, no `no_lookup`.

La conversación final se construye sin incorporar automáticamente texto del primer asistente.
Si hay herramienta, mantiene el turno nativo de llamadas, el rol tool y la correlación; si no,
solo necesita sistema de clasificación y usuario original. La composición provee instrucciones
explícitas de ambas fases; la identidad experimental registra sus hashes por separado.

Todo recorrido completado utiliza dos inferencias; errores/rechazos o deadline pueden detenerlo
antes. Se mantiene un solo deadline monotónico de 90 s y timeouts efectivos min(45/5 s,
remanente), sin reservas temporales ni reintentos. El resultado público y su mapeo HTTP siguen
siendo los descritos arriba; menor frecuencia esperada de errores de formato no es una garantía.

El runner existente observa fase de decisión y clasificación, con informe v2
y protocolo explícito, mismos denominadores/umbrales y dataset v3 intacto. Una pasada admite como máximo 120 intentos; si los 60 casos alcanzan resultado final consume 120. Los rechazos de política conservan evaluabilidad y penalizaciones, aunque no ejecuten la segunda fase. Manifiesto, identidad, permisos y espacio de evidencias propios, previstos
en la especificación, se reutilizan como mecanismos, no como controles de una ejecución cerrada.
No se crea otro framework, infraestructura asíncrona, base de datos ni runner paralelo.

Los prompts, fuentes y resultados históricos se identifican mediante sus commits e informes
originales. Las autorizaciones anteriores no sirven para revisión 6. El manifiesto nuevo
`i006-decision-classification-manifest.json` está desactivado, con identidad y aprobación nulas.
El espacio privado previsto es `evals/reports/i006-decision-classification/`; no está inicializado.
Los tres diagnósticos históricos se retiran mediante rechazo incondicional de sus entradas,
antes de reservas, acceso al proveedor, repositorio o evidencias. Sus implementaciones originales
se conservan en Git y sus controles privados permanecen intactos. Se reutilizan solo sus
utilidades de transporte protegido, no una orquestación histórica alternativa.

La implementación de revisión 6 fue aceptada por el responsable el **2026-11-18**, tras segunda revisión técnica independiente **APPROVED** y resolución de los hallazgos HIGH/LOW. Esto cierra la implementación, sin superar la puerta experimental ni marcar I006 Verified. Permisos desactivados y evidencias históricas intactas.

## I007 — Capacidad documental independiente

La [especificación I007](iterations/007-knowledge-rag.md) añade `src/knowledge`: dominio y puertos
específicos, casos de uso de ingestión/publicación/consulta, adaptadores Ollama y PostgreSQL/pgvector.
`main.ts` registra la nueva ruta y cierra su pool sin modificar la composición ni la semántica de
clasificación. La construcción es offline: el pool conecta bajo demanda; no se ingiere ni se llama
al proveedor al arrancar. Configuración RAG_* independiente.

Un documento tiene identidad lógica estable, activa y staging. Lock de escritor por documento;
publicación transaccional. Retrieval exacto por coseno en un snapshot REPEATABLE READ READ ONLY
preservado durante generación: MVCC permite terminar consultas anteriores tras reemplazar versiones.
Se evita evaluar distancias entre espacios incompatibles antes de filtrar modelo/digest/dimensiones.
No hay índices ANN, colas, reranking, agentes ni herramientas del generador.

El contexto va en rol usuario; el sistema es fijo. JSON Schema y validación de citas locales no
prueban fundamentación semántica ni resistencia a instrucciones hostiles. La [guía I007](../knowledge/README.md)
explica publicación, privacidad, configuración y revisión humana de evals. Tests deterministas y
PostgreSQL con vectores simulados son evidencia técnica; revisión independiente y baseline real pendientes.
Las dependencias pg y @types/pg cambian package/lockfile: las identidades congeladas históricas no
se regeneran para ocultarlo; sus controles pueden rechazar el entorno ampliado, sin cambiar los
runners, prompts, datos o evidencias originales.
