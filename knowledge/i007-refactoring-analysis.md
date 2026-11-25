# I007 — Análisis de RT-001 y RT-002

Fecha: 2026-11-25. **Propuesta, no implementada ni aprobada para ejecución.**
Fuentes: especificación I007, arquitectura y ADR-002/003; inspección del código real.
Mantener contratos públicos, prompt A, defaults 5/4/0,45 y comportamiento de clasificación.
No se proponen cambios de recuperación, métricas o aceptación experimental.

## Estructura y dependencias actuales

```text
src/
  main.ts                         arranque + composición + registro RAG + cierre
  composition.ts                  factoría de clasificación
  config.ts                       configuración de clasificación
  http/
    app.ts                        Fastify + logs/errores + registro classify
    classify-route.ts             adaptador HTTP de clasificación
    knowledge-route.ts            adaptador HTTP de consulta RAG
    error-handler.ts, schemas.ts   infraestructura HTTP compartida
  knowledge/
    domain.ts, ports.ts           contratos propios de conocimiento
    use-cases.ts                  consulta, ingestión y publicación
    markdown.ts                   parseo, chunking, lectura del corpus y hash
    config.ts                     configuración RAG
    ollama.ts                     embeddings/generación, prompts, identidad y timeout
    postgres.ts                   repositorio y migración
    composition.ts                pool, proveedor, dependencias y close
    cli.ts                        ingestión/migración manual
    evaluation.ts                 dataset, observación, métricas, revisión y lote
    evaluation-main.ts            CLI, composición del lote, evidencias e identidades
  evaluation/durable-files.ts     persistencia usada por la CLI de evaluación
```

| Módulo               | Uso real                                                                       | Dependencias principales                                           |
| -------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| domain.ts / ports.ts | Compartido por consulta, ingestión, adaptadores y evaluación                   | Tipos propios; sin HTTP, pg u Ollama                               |
| use-cases.ts         | Motor compartido; HTTP usa askKnowledgeQuestion; CLI usa ingestión/publicación | Puertos, dominio, Ajv y markdown                                   |
| markdown.ts          | Ingestión y validación de corpus; hash también usado en evaluación/repositorio | Dominio y APIs Node de archivos/crypto                             |
| config.ts            | HTTP, CLI y evaluador                                                          | process.env validado; sin conexiones                               |
| ollama.ts            | Proveedor real compartido                                                      | Puertos/dominio, config, esquema de use-cases, Ajv y fetch         |
| postgres.ts          | Repositorio compartido; migrateKnowledge solo en CLI                           | pg, dominio/puertos, hash y SQL                                    |
| composition.ts       | Composición de HTTP, CLI y evaluador                                           | Config, pg, adaptadores; devuelve dependencias, pool y close       |
| cli.ts               | Operación administrativa, no endpoint                                          | Composición, corpus, ingestión y migración                         |
| evaluation.ts        | Exclusivo de evaluación                                                        | Motor, tipos, Ajv y reloj; wrappers de identidad/exposición        |
| evaluation-main.ts   | Exclusivo de evaluación                                                        | Composición, SQL de identidad, corpus, métricas, archivos durables |

Producción no importa actualmente evaluation.ts ni evaluation-main.ts. El problema principal RT-001
es la ubicación mezclada y la frontera poco visible, no una dependencia runtime de HTTP hacia evals.
El callback opcional observeRetrieval del motor es observación neutral; los tipos de dataset,
retención de respuestas, exposición adversarial y métricas solo viven en evaluación. La identidad
EmbeddingSpace es necesaria en producción para compatibilidad de vectores; no debe extraerse.
GenerationIdentity y generationIdentity() son capacidades neutrales usadas por evaluación/diagnóstico,
no fórmulas o criterios de evaluación. No trasladarlos fuera del proveedor a costa de duplicar protocolo.

El adaptador importa generationSchema desde use-cases.ts; markdown agrupa hash y lectura de disco.
Son acoplamientos existentes, no bloqueos de estas dos tareas. No añadir extracciones oportunistas
ni dividir toda la capacidad en nuevas capas por el mero movimiento del evaluador.

## RT-001 — Separación mínima de evaluación

Estructura propuesta:

```text
src/knowledge/                    motor y adaptadores actuales, sin módulos de evaluación
  domain.ts, ports.ts, use-cases.ts, markdown.ts
  config.ts, ollama.ts, postgres.ts, composition.ts, cli.ts
src/evaluation/knowledge/
  evaluation.ts                   trasladado desde src/knowledge/evaluation.ts
  main.ts                         trasladado desde src/knowledge/evaluation-main.ts
```

Dependencia permitida: evaluación → knowledge. Prohibida: knowledge/HTTP → evaluación.
Ambos caminos invocan el mismo askKnowledgeQuestion y los mismos adaptadores; no crear un motor
RAG de evaluación. Las comprobaciones de identidad del generador, observación de exposición,
retención sintética, revisión humana, métricas y persistencia permanecen en el evaluador.
Ingestión/migración no son experimentación: conservar su CLI en knowledge y sus permisos manuales.
No mover durable-files ni crear una biblioteca común nueva por este cambio.

Archivos afectados previstos:

- Mover los dos módulos anteriores y ajustar imports relativos (incluido durable-files).
- package.json: conservar el nombre eval:knowledge, apuntando al nuevo main compilado.
- test/knowledge/evaluation.test.ts: actualizar importaciones; opcionalmente mover a
  test/evaluation/knowledge.test.ts solo si ayuda, sin necesidad de reorganizar todos los tests.
- knowledge/README.md y documentación técnica vigente: nuevo punto de entrada; preservar comandos
  históricos como tales. Actualizar arquitectura cuando se autorice, sin reescribir resultados.
- Nuevos tests deterministas de frontera de imports, entrypoint offline y equivalencia de métricas.

La CLI calcula codeHash con diez rutas hardcoded bajo src/knowledge. Hay que actualizar explícitamente
su inventario al mover módulos, incluyendo evaluación y motor realmente ejecutados. La identidad nueva
cambiará por rutas/imports aunque la semántica sea igual. No mantener un hash antiguo artificial ni
regenerar hashes de informes previos. Documentar el nuevo inventario para ejecuciones futuras.
El prompt original exportado se conserva: no eliminarlo como supuesto código exclusivo de evaluación.

Regresión propuesta: dataset/fixtures fijos + proveedores simulados, igualdad de respuestas, selección y
orden de contextos, citas, errores, timeouts, métricas, revisión y parciales. Probar --check sin red,
retención privada opt-in y guardas de identidad antes/después del generador. Añadir prueba que impida
imports directos o transitivos de evaluación desde módulos runtime de knowledge/HTTP/composición.
No ejecutar --run ni reconstruir informes históricos. No añadir scores ni otras métricas.

## RT-002 — Recorridos actuales

Clasificación:

```text
npm start → dist/src/main.js
  loadConfig()
  createClassificationDependencies(config) [src/composition.ts]
    OllamaClassificationLlm + SyntheticIncidentRepository + instrucciones explícitas
  buildApp(classification, true) [src/http/app.ts]
    Fastify + política logs + registerErrors
    registerClassifyRoute(app, classification)
      POST /api/v1/incidents/classify → classifyIncident()
```

Conocimiento, en el mismo main después de buildApp:

```text
loadRagConfig()
createKnowledgeDependencies(ragConfig) [src/knowledge/composition.ts]
  Pool lazy + OllamaKnowledge + PostgresKnowledgeRepository
registerKnowledgeRoute(app, knowledge.dependencies, maxQuestionLength)
  POST /api/v1/knowledge/ask → askKnowledgeQuestion()
app.addHook(onClose, knowledge.close)
app.listen(127.0.0.1:3000) + manejadores SIGINT/SIGTERM
```

Asimetrías: buildApp no representa la aplicación completa; main registra una ruta y no la otra;
los tests de knowledge montan Fastify/errores manualmente o añaden su ruta a buildApp(classification).
Clasificación recibe fetch opcional en su factoría; knowledge no ofrece ese parámetro, aunque
OllamaKnowledge sí lo admite. Esto no impide inyectar los puertos simulados en ambos adaptadores HTTP.
No hace falta unificar proveedores ni añadir fetch inyectable para homogeneizar las rutas.
Knowledge tiene recurso con cierre; clasificación no lo tiene. La homogeneidad debe respetar esta
diferencia, no inventar recursos simétricos. main mezcla composición, registro y arranque; si falla
la preparación/listen después de crear recursos, el catch actual no garantiza su cierre explícito.
Es una oportunidad de ciclo de vida a cubrir con tests, no una fuga física demostrada en estas ejecuciones.

## RT-002 — Propuesta homogénea

Conservar factorías por capacidad; añadir una única composición de aplicación a src/composition.ts
(p. ej. createApplicationDependencies), sin contenedor DI. Devuelve dependencias clasificadas por
capacidad y un close agregado. createClassificationDependencies mantiene su export para consumidores
actuales y tests; createKnowledgeDependencies sigue reutilizable por las CLI sin crear HTTP.

buildApp recibe explícitamente:

```text
{ classification, knowledge: { dependencies, maxQuestionLength } }
```

Registra siempre ambas rutas, errores y logging común, sin instanciar proveedores ni conectar a DB.
Los tests HTTP pasan ambos conjuntos de puertos simulados. No usar rutas opcionales ocultas ni
sobrecargas transitorias para conservar una app incompleta como API principal.

main carga ambas configuraciones, llama a la composición central, crea buildApp y asocia una sola vez
su close al onClose. Solo main hace listen e instala señales. Ante fallo de preparación/listen, cerrar
los recursos ya creados; definir close idempotente para evitar doble pool.end entre catch y onClose.
Si la composición falla a mitad, debe cerrar lo creado antes de propagar el error saneado.
No introducir arranque de modelos, health checks con inferencias ni nuevas configuraciones.

Direcciones: main → composición → adaptadores; HTTP → casos de uso → puertos. Dominio/aplicación no
importan Fastify, pg ni el punto de composición. El composition root es la excepción deliberada que
conoce implementaciones. Mantener contextos separados de clasificación y conocimiento, sin un puerto
LLM genérico, eventos, repositorios base ni framework de agentes. Esto respeta DDD/hexagonal pragmático.

Archivos afectados previstos:

- src/main.ts, src/composition.ts y src/http/app.ts.
- Tests que construyen buildApp (inventariar con rg antes de implementar): test/http/*,
  test/unit/production-composition.test.ts, test/robustness/composition.test.ts,
  test/knowledge/http.test.ts y otros consumidores encontrados.
- test/model-comparison/execution.test.ts y test/robustness/composition.test.ts contienen aserciones
  textuales sobre main.ts que quedarán obsoletas. Sustituirlas por garantías equivalentes de composición,
  sin eliminar comprobaciones históricas de prompt/payload/timeout/temperatura.
- Tests nuevos o ampliados de composición conjunta y cierre/arranque fallido; specs/architecture.md
  y knowledge/README.md con el recorrido real final, previa autorización del alcance histórico.
- No requiere cambiar rutas, schemas, mapeos de errores, casos de uso ni adaptadores para homogeneizar.

Regresión propuesta: ambas rutas en una misma app inyectada, sin listen ni Ollama; mismos estados,
cuerpos, errores, requestId, límites y privacidad. No abrir conexiones al construir la app; usar cierre
simulado y comprobar una sola liberación en éxito, fallo de listen, cierre repetido y preparación parcial.
Comprobar que no hay efectos de arranque al importar buildApp y que las CLI siguen sin importar HTTP.
Mantener todos los tests históricos relevantes con proveedores simulados.

## Protección histórica y secuencia

1. Autorizar RT-001 y verificarla de manera independiente antes de RT-002.
2. RT-002 requiere aprobación específica de los archivos históricos afectados. No empezar a modificar
   main/composition/app o tests históricos bajo una autorización limitada a mover evaluación.
3. Capturar inventario SHA-256 antes/después de informes, corpus/dataset, modelos/configuración y
   archivos históricos protegidos. No modificar evidencias privadas, controles, freezes o autorizaciones.
4. I006 tiene identidad congelada ligada al árbol histórico. Preservar fixture inmutable del commit
   42771e8ffe6898611a7187a27839c2aea38d3119, su árbol y los 38 hashes; mantener rechazo del árbol
   actual por el mecanismo original. No crear excepciones genéricas ni actualizar freezes para pasar tests.
5. RT-001 cambia identidad futura de I007; RT-002 además puede tocar fuentes/tests históricos
   protegidos. Si la política vigente de los 352 archivos impide esos cambios, solicitar autorización
   nominal antes de implementar: conservar su garantía mediante fixture no equivale a permiso de edición.
6. Conservar reproducibilidad desde commits previos e informes con sus hashes originales. No presentar
   un build refactorizado como el que ejecutó baseline/A/B/Oracle. No repetir experimentos como regresión.

Verificaciones futuras: tests dirigidos de cada intervención, TypeScript estricto, formato/lint,
suite determinista completa y git diff --check; integración PostgreSQL solo con instancia desechable
explícitamente autorizada, nunca contra el corpus experimental. Ninguna inferencia real es necesaria.
No se declara aceptación funcional a partir de tests ni se inicia otra iteración con esta propuesta.
