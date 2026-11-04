# Arquitectura

## Estado y alcance

Arquitectura implementada para la primera iteración; aceptación humana pendiente. El contrato normativo se mantiene en la [especificación 001](iterations/001-classification.md). La aceptación de la implementación se registra mediante el estado de la iteración.

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
  config.ts
  main.ts
test/
  unit/
  http/
  ollama/
```

- `domain`: categorías permitidas y tipo de clasificación, independientes del proveedor y sin esquemas de protocolo.
- `application`: caso de uso, puerto de clasificación y errores técnicos independientes del transporte.
- `http`: validación de entrada, normalización y traducción de errores al contrato público.
- `infrastructure/ollama`: instrucciones, protocolo del proveedor, construcción del JSON Schema desde las categorías del dominio, timeout y validación de la respuesta.
- `config.ts`: lectura y validación de entorno al arrancar.
- `main.ts`: composición y apertura del servidor; `app.ts` construye la aplicación sin escuchar en un puerto.

Las dependencias apuntan hacia el contrato de aplicación y el dominio. El caso de uso no importa Fastify ni detalles de Ollama. La composición conecta el adaptador con el puerto sin contenedor de inyección.

## Puerto y flujo

Contrato conceptual: `classify(description: string) → Promise<Classification>`, donde `Classification` contiene exclusivamente la categoría permitida. El puerto declara errores técnicos mediante un código discriminante; no recibe modelo, URL, prompt ni objetos HTTP. El timeout pertenece al adaptador.

Flujo: HTTP valida y normaliza → caso de uso invoca el puerto → adaptador llama a Ollama → adaptador valida sobre y contenido → caso de uso devuelve el resultado → HTTP responde o traduce el error.

Ollama recibe `POST /api/chat`, mensajes `system` y `user` separados, `stream: false`, JSON Schema en `format` y `temperature: 0`. Las instrucciones se mantienen en un módulo propio. La descripción nunca se concatena al mensaje de sistema. No se conserva historial entre peticiones.

El adaptador construye su JSON Schema a partir de la definición común del dominio, sin infraestructura genérica de conversión ni dependencias de Ollama en el dominio. Usa ese esquema para structured outputs y validación local.

El adaptador devuelve solo resultados validados. El caso de uso permanece igual al sustituir el proveedor; véase [ADR-002](adr/ADR-002-provider-abstraction.md). La respuesta es síncrona conforme a [ADR-001](adr/ADR-001-sync-classification.md).

## Restricciones operativas

La especificación 001 es la única fuente de límites, variables de entorno, códigos de error y políticas de timeout. No hay reintentos, fallback de categoría ni descarga automática de modelos. La API puede arrancar aunque Ollama esté temporalmente inaccesible.

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
