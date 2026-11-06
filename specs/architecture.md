# Arquitectura

## Estado y alcance

Arquitectura implementada para la primera iteración, en estado `Verified` desde el **2026-11-04** tras revisión y aceptación humana. El contrato normativo se mantiene en la [especificación 001](iterations/001-classification.md). La aceptación de la implementación se registra mediante el estado de la iteración.

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
