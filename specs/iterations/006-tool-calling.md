# I006 — Tool Calling

**Proyecto:** AI Support Platform

**Estado:** Implemented

**Aprobación técnica R7:** revisión independiente final APPROVED; hallazgo MEDIUM resuelto. Autorizada la preparación de validación, no la ejecución ni la aceptación definitiva. Las referencias de revisión independiente pendiente más abajo recogen el estado anterior a esta aprobación.

**Versión:** Revisión 7 — consulta híbrida y clasificación estructurada

**Aprobación de diseño de revisión 7:** 2026-11-19; implementación autorizada, pendiente de revisión independiente y validación experimental.

La revisión 6 y su aceptación de implementación se conservan como antecedentes. Las reglas de revisión 7 que siguen sustituyen expresamente sus obligaciones de dos inferencias en todos los casos. No se declara aceptada ni Verified I006.

**Fecha de aprobación de revisión 6:** 2026-11-18

**Aprobación histórica de revisión 5:** 2026-11-13

**Decisiones:** DEC-I006-001 a DEC-I006-029, con actualización DEC-R7-01 a DEC-R7-07

**Criterios de aceptación:** I006-AC-01 a I006-AC-29 (IDs 01–26 conservados)

---

La revisión 6 fue aprobada e implementada con tests deterministas el 2026-11-18. La implementación completa fue autorizada, incluida la retirada explícita de los diagnósticos históricos incompatibles. La implementación fue aceptada por el responsable el 2026-11-18 tras segunda revisión independiente APPROVED. La puerta experimental y cualquier autorización de nuevas inferencias siguen pendientes; no se marca Verified. Véanse el [ADR-003](../adr/ADR-003-separate-lookup-decision-and-classification.md) y el estado de la sección 18.

## 1. Objetivo

Ampliar el clasificador de incidencias para que un LLM pueda consultar una incidencia anterior mediante una herramienta cuando necesite información adicional para clasificar una nueva incidencia.

Categorías disponibles:

- `BUG`
- `FEATURE`
- `QUESTION`

El backend determina referencias elegibles exclusivamente en la descripción original. Si no hay ninguna, decide NO_LOOKUP sin inferencia. Si las hay, el LLM decide la necesidad semántica; el backend valida, autoriza y ejecuta como máximo una solicitud.

**Principio fundamental:** mencionar una incidencia anterior no obliga a consultarla.

### Fuera de alcance

- Agentes autónomos y cadenas de herramientas.
- Más de una ejecución de herramienta por clasificación.
- Bases de datos reales, RAG o búsqueda semántica.
- Reintentos automáticos.
- Verificación de equivalencia entre incidencias.
- Refactorización de la política de errores públicos de I001.
- Sanitización semántica avanzada mediante otro LLM.

## 2. Registro de decisiones

Las decisiones originales se aprobaron con la revisión 5 el 2026-11-13. El 2026-11-18 se aprueba la separación de fases (DEC-I006-029), que actualiza expresamente DEC-I006-005 y DEC-I006-012 y el flujo de aplicación; no altera los resultados históricos ni las demás restricciones.

| ID           | Decisión                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------- |
| DEC-I006-001 | Con referencias elegibles, el LLM decide la necesidad; el backend valida y ejecuta (revisión 7).                    |
| DEC-I006-002 | `NOT_FOUND` se entrega al LLM y permite continuar.                                                                  |
| DEC-I006-003 | `UNAVAILABLE` representa indisponibilidad técnica de la consulta, sin reintentos.                                   |
| DEC-I006-004 | Se permite abstención interna sin alterar la respuesta pública exitosa.                                             |
| DEC-I006-005 | Máximo dos llamadas y una herramienta: una inferencia final sin IDs, dos con IDs (revisión 7).                      |
| DEC-I006-006 | Repositorio sintético; `FOUND` contiene `id`, `title`, `description`, `category`.                                   |
| DEC-I006-007 | Normalización limitada al prefijo del identificador y validación estricta.                                          |
| DEC-I006-008 | Truncamiento determinista y contenido recuperado no confiable.                                                      |
| DEC-I006-009 | 45 segundos por llamada al LLM y 90 segundos globales.                                                              |
| DEC-I006-010 | Resultados internos `CLASSIFIED` o `INSUFFICIENT_CONTEXT`.                                                          |
| DEC-I006-011 | Tests deterministas y evals reales con umbrales independientes.                                                     |
| DEC-I006-012 | Clasificar sin forzar consulta; resultado exclusivamente de fase final, primera o segunda inferencia según ruta.    |
| DEC-I006-013 | Evolucionar el único caso de uso de producción.                                                                     |
| DEC-I006-014 | Preservar la política de errores públicos genéricos de I001.                                                        |
| DEC-I006-015 | Timeout máximo de herramienta de 5 segundos.                                                                        |
| DEC-I006-016 | Abstención normal: 422; abstención tras `UNAVAILABLE`: 503.                                                         |
| DEC-I006-017 | Rechazo inmediato de solicitudes inválidas, múltiples, desconocidas o adicionales.                                  |
| DEC-I006-018 | Deadline global agotado: `502 PROVIDER_ERROR`.                                                                      |
| DEC-I006-019 | Dataset de 60 casos y umbrales de evaluación definidos.                                                             |
| DEC-I006-020 | Una referencia explícita no implica necesidad de consulta.                                                          |
| DEC-I006-021 | Dos puertas de aceptación independientes y obligatorias.                                                            |
| DEC-I006-022 | Medir solicitudes, validez y ejecuciones por separado.                                                              |
| DEC-I006-023 | Separar fallos técnicos de resultados semánticos.                                                                   |
| DEC-I006-024 | Deadline global sin reservas temporales.                                                                            |
| DEC-I006-025 | Separar controles deterministas y resistencia semántica a prompt injection.                                         |
| DEC-I006-026 | Preservar runners históricos y evolucionar producción.                                                              |
| DEC-I006-027 | Orquestación de herramientas en aplicación.                                                                         |
| DEC-I006-028 | Una decisión evaluable de tool calling por caso.                                                                    |
| DEC-I006-029 | Revisión 6 introdujo decisión nativa y clasificación separadas; revisión 7 omite la inferencia de decisión sin IDs. |

**Precisiones técnicas incorporadas:**

- Los runners históricos llamarán directamente a `classifier.classify(description)`.
- No se creará una función auxiliar `classifyDirectly()`.
- Los timeouts de I006 serán constantes, sin nuevas variables de entorno.
- Las solicitudes y respuestas de herramienta conservarán su correlación cuando el protocolo la requiera.
- Los errores temporales tendrán una precedencia determinista.
- Los casos `NOT_FOUND` y `UNAVAILABLE` tendrán expectativas finales explícitas.
- El truncamiento utilizará puntos de código Unicode.
- Los datos sintéticos y las simulaciones de indisponibilidad serán reproducibles.
- Los casos adversariales tendrán expectativas verificables.

## 3. Arquitectura

### 3.1. Caso de uso

Evolucionar `classifyIncident()` como único caso de uso de producción.

Responsabilidades históricas de la revisión 6 (sustituidas por la sección 19):

1. Iniciar un único deadline monotónico de 90 segundos para toda la incidencia.
2. Primera inferencia de decisión: instrucciones específicas, descripción original, herramientas nativas habilitadas y sin `format`.
3. Validar la decisión interna. Una respuesta nativa técnicamente válida sin `tool_calls` significa `no_lookup`, no clasificación ni abstención.
4. Si hay llamadas, validar y autorizar la solicitud completa antes de acceder al repositorio; máximo una ejecución de `getIncidentById`.
5. Preparar una conversación de clasificación nueva con instrucciones de clasificación y descripción original. Si hubo consulta, incluir el turno nativo de llamada y su resultado estructurado con correlación. No incorporar automáticamente el texto de la primera respuesta, ni serializarlo como contexto o instrucciones.
6. Segunda inferencia obligatoria si no hubo un rechazo previo y queda tiempo: sin herramientas, con el esquema estricto de clasificación/abstención.
7. Validar el resultado final y devolver `ClassificationResult` o un error controlado.

`no_lookup` evita la herramienta, no la segunda inferencia. Incluso si el texto de la primera respuesta contiene una categoría o abstención aparentemente válida, no es un resultado final. Si la decisión omite una consulta necesaria, se mide como error semántico de decisión cuando el caso sea evaluable; no se inventa una consulta desde backend.

Los resultados `FOUND`, `NOT_FOUND` y `UNAVAILABLE` permiten pasar a la clasificación final cuando quede presupuesto. Un rechazo de política o fallo técnico previo impide la segunda inferencia. No se reserva tiempo para ella ni se añaden llamadas de recuperación.

La orquestación pertenece a aplicación, no al adaptador Ollama. La composición tendrá instrucciones explícitas de decisión y clasificación; no se añade un framework ni un proveedor nuevo. Los textos efectivos futuros requerirán revisión y se identificarán por separado; esta revisión define su responsabilidad, no acredita todavía prompts implementados o evaluados.

### 3.2. Puerto LLM

Reutilizar `ClassificationLlm.infer()`, `LlmMessage`, `ToolCall` y los errores existentes. La ampliación mínima del contrato interno incorpora `no_lookup` y valida el resultado según la fase, sin un puerto genérico nuevo ni sobrecargas históricas:

```ts
type Category = 'BUG' | 'FEATURE' | 'QUESTION';

type ToolCall = {
  name: string;
  arguments: unknown;
  callId?: string;
};

type LlmMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string }
  | { role: 'assistant'; toolCalls: ToolCall[] }
  | {
      role: 'tool';
      name: string;
      content: string;
      callId?: string;
    };

type NativeToolRequests = { type: 'tool_calls'; calls: ToolCall[] };

type LookupDecision = { type: 'no_lookup' } | NativeToolRequests;

type FinalClassification = { type: 'classification'; category: Category } | { type: 'abstention' };

type LlmResponse = LookupDecision | FinalClassification;

interface ClassificationLlm {
  infer(
    messages: LlmMessage[],
    options: {
      timeoutMs: number;
      toolsEnabled: boolean;
      eligibleIncidentIds?: readonly string[];
    },
  ): Promise<LlmResponse>;
}
```

`toolsEnabled: true` identifica la fase de decisión: el adaptador devuelve exclusivamente `LookupDecision`. `toolsEnabled: false` identifica la fase final: solo `FinalClassification` puede completar la operación; cualquier llamada nativa se conserva y se entrega a aplicación para rechazarla, no se filtra. Un `no_lookup` inyectado en la segunda fase es una respuesta interna inválida. La unión común permite observar solicitudes prohibidas; no autoriza mezclar los resultados de ambas fases.

`no_lookup` es un resultado construido por el adaptador en ruta LLM o determinísticamente por aplicación sin IDs, no un JSON que se exija al modelo ni una abstención. El contrato público no incluye esta variante. La validación independiente en aplicación rechazará una clasificación/abstención interna en fase de decisión, en lugar de convertirla silenciosamente en `no_lookup`.

#### Validez de la primera respuesta nativa

Se mantienen los límites de transporte y las validaciones del protocolo: HTTP satisfactorio, cuerpo presente con máximo 65.536 bytes, JSON exterior objeto, `done: true`, `done_reason: "stop"`, `message` objeto y `role: "assistant"`.

| Respuesta dentro de un sobre válido                                                                        | Interpretación                                                                    |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `tool_calls` ausente, `content` ausente o string, incluso vacío                                            | `no_lookup`; descartar el texto sin parsearlo como resultado funcional            |
| `tool_calls` ausente, texto que contiene JSON, Markdown o una supuesta llamada                             | `no_lookup`; no clasificar, abstenerse ni ejecutar desde ese texto                |
| `tool_calls` presente como array, `content` ausente o exactamente vacío, llamadas estructuralmente válidas | Devolver todas las llamadas y argumentos intactos a aplicación                    |
| Array `tool_calls: []`                                                                                     | Intento inválido de solicitar herramienta: rechazo de política; nunca `no_lookup` |
| Llamadas múltiples, desconocidas o con argumentos/ID no autorizados, pero protocolo válido                 | Preservar y rechazar en aplicación antes del repositorio; sin segunda inferencia  |
| `content` presente y no string, incluso null, o contenido no vacío junto a llamadas                        | Error técnico de protocolo; sin recuperación                                      |
| `tool_calls` no es array, o alguna llamada no satisface la estructura nativa                               | Error técnico de protocolo; no seleccionar un subconjunto válido                  |
| Sobre malformado, JSON exterior inválido, terminación incompatible o cuerpo inválido                       | Error técnico; nunca `no_lookup`                                                  |

Una llamada nativa conserva las condiciones existentes: objeto, `type` ausente o `function`, `id` ausente o string, `function` objeto con nombre string y propiedad `arguments` presente. La aplicación mantiene la validación funcional estricta del nombre, único argumento, tipo e identificador. No hay coerción, reparación ni filtrado de solicitudes.

No se aplica JSON Schema al texto de la primera fase: su contenido no es clasificación. Esto no relaja la validación del sobre ni de las llamadas nativas. La decisión de no consultar puede ser semánticamente incorrecta aunque sea técnicamente válida.

#### Validez de la respuesta final

Enviar únicamente `format` con el esquema existente `oneOf`: `{ "type": "classification", "category": "BUG" }` con categorías BUG/FEATURE/QUESTION, o `{ "type": "abstention" }`. Se prohíben propiedades adicionales, coerción y reparación. Mantener Ajv y la validación local independiente. La ausencia de contenido, JSON inválido o incumplimiento de esquema es error técnico; no se convierte en abstención. Una solicitud nativa adicional sigue siendo un rechazo de política aun sin herramientas declaradas.

No se adoptan `tools` y `format` simultáneos. La prueba cerrada de esa hipótesis no autoriza modificar producción.

#### Correlación de herramientas — P1

`callId` representa un identificador de correlación independiente del proveedor.

Reglas:

- Si el protocolo devuelve un identificador de llamada, el adaptador lo conservará.
- Si el protocolo exige correlación, el adaptador garantizará que solicitud y resultado se asocian correctamente.
- No se inventarán identificadores en aplicación sin necesidad.
- La ausencia de un identificador será válida si el protocolo no lo requiere.
- No se incorporarán estructuras específicas de Ollama a los contratos de aplicación.
- La segunda inferencia incluirá el turno del asistente que solicitó la herramienta y el resultado correspondiente.
- La segunda conversación omite el texto de decisión; si no hubo consulta, solo necesita instrucciones de clasificación y descripción original.
- `toolsEnabled: false` no sustituye la validación: cualquier solicitud adicional de herramienta se rechazará.

La traducción de revisión 6 se verifica con simulaciones; la compatibilidad real de sus dos fases queda pendiente de autorización posterior.

El adaptador debe preservar las solicitudes múltiples para que aplicación pueda rechazarlas. No seleccionará silenciosamente la primera.

Las respuestas de protocolo malformadas producirán errores técnicos tipados, no abstenciones ni `no_lookup`. El texto libre admisible de la fase de decisión se descarta conforme a la tabla anterior.

### 3.3. Puerto de repositorio

```ts
interface Incident {
  id: string;
  title: string;
  description: string;
  category: Category;
}

interface IncidentRepository {
  getById(id: string, options: { timeoutMs: number }): Promise<Incident | null>;
}
```

Resultados:

- Incidencia encontrada: `Incident`.
- Incidencia inexistente: `null`.
- Fallo técnico: excepción controlada.

La aplicación convierte estos resultados a `FOUND`, `NOT_FOUND` o `UNAVAILABLE`.

### 3.4. Resultado de aplicación

```ts
type ClassificationResult =
  | {
      status: 'CLASSIFIED';
      category: Category;
    }
  | {
      status: 'INSUFFICIENT_CONTEXT';
      category: null;
      toolUnavailable: boolean;
    };
```

`toolUnavailable` es interno y permite seleccionar el código HTTP.

### 3.5. Adaptadores

- Adaptador Ollama con soporte para tool calling.
- Repositorio sintético de incidencias.
- Adaptador HTTP existente, actualizado para el nuevo resultado.
- Runner de evaluación I006.
- Adaptadores y runners históricos preservados para I002–I005.

El adaptador Ollama traduce el protocolo, pero no ejecuta herramientas ni aplica reglas de negocio.

## 4. Contrato de herramienta

**Nombre:** `getIncidentById`

Argumentos:

```json
{ "incidentId": "INC-142" }
```

Normalización admitida:

`inc-142` → `INC-142`

Validación:

```text
^INC-[1-9][0-9]{0,5}$
```

No corregir otros formatos automáticamente.

### FOUND

```json
{
  "status": "FOUND",
  "incident": {
    "id": "INC-142",
    "title": "Error al guardar",
    "description": "La aplicación se bloquea al guardar.",
    "category": "BUG"
  }
}
```

### NOT_FOUND

```json
{
  "status": "NOT_FOUND",
  "incidentId": "INC-999"
}
```

### UNAVAILABLE

```json
{ "status": "UNAVAILABLE" }
```

### Repositorio reproducible — M2

El repositorio sintético será determinista:

- Identificadores, títulos, descripciones y categorías fijos.
- Resultados `FOUND` y `NOT_FOUND` estables.
- Escenarios `UNAVAILABLE` configurados explícitamente por caso.
- Sin fallos aleatorios ni dependencias de servicios externos.
- Misma entrada y escenario producen el mismo resultado de herramienta.

Las simulaciones de indisponibilidad no dependerán de la disponibilidad real de Ollama.

## 5. Política de decisión

La herramienta debe solicitarse únicamente cuando la información disponible no sea suficiente y consultar la incidencia referenciada pueda resolver esa falta de contexto.

| Descripción                                                   | Resultado esperado         |
| ------------------------------------------------------------- | -------------------------- |
| «La aplicación falla al iniciar sesión»                       | `BUG`, sin herramienta     |
| «La aplicación falla al iniciar sesión, igual que en INC-142» | `BUG`, sin herramienta     |
| «Me pasa exactamente lo mismo que en INC-142»                 | Consultar `INC-142`        |
| «Quiero añadir un botón de exportación, como en INC-142»      | `FEATURE`, sin herramienta |

El backend no fuerza consultas por encontrar referencias. En esta revisión, «clasificación directa» significa clasificación sin herramienta, no una sola inferencia: se decide `no_lookup` y se clasifica en la segunda fase.

Las consultas innecesarias se penalizan en las evals.

## 6. Límites y configuración

### 6.1. Constantes

```ts
const classificationTimeouts = {
  llmCallMs: 45_000,
  toolCallMs: 5_000,
  overallMs: 90_000,
} as const;
```

No añadir variables de entorno para estos límites en I006.

No modificar la configuración histórica de `OllamaClassifier`.

### 6.2. Política temporal

Para cada operación:

```text
timeoutEfectivo =
  min(límiteIndividual, tiempoGlobalRestante)
```

El deadline global utilizará un reloj monotónico.

El presupuesto restante se calculará antes de iniciar cada operación.

No se reserva tiempo para operaciones futuras.

Si no queda presupuesto, no se inicia una nueva operación, incluida la clasificación final obligatoria. 45 + 5 + 45 segundos no concede 95 segundos: después de una decisión de 45 s y una consulta de 5 s quedan como máximo 40 s para clasificar, descontados otros costes.

El timeout de la herramienta debe imponerse desde aplicación, sin depender exclusivamente de que el repositorio respete `timeoutMs`.

### 6.3. Precedencia de errores temporales — P2

Cuando coincidan o se solapen vencimientos:

1. **Deadline global agotado:** `global_deadline_exceeded`.
2. **Timeout individual del LLM**, si todavía queda presupuesto global: timeout de proveedor (`kind: "timeout"` existente, denominado conceptualmente `provider_timeout`). No se renombra la taxonomía implementada.
3. **Timeout de herramienta**, si todavía queda presupuesto global: entregar `UNAVAILABLE`.

La comprobación de la causa se realizará con el mismo reloj monotónico y con reglas deterministas.

No se utilizará el orden accidental de resolución de promesas para decidir qué error prevalece.

Los tests deberán simular el reloj y los vencimientos relevantes.

### 6.4. Límites funcionales

- Máximo dos llamadas al LLM.
- Máximo una ejecución de herramienta.
- Inferencia final obligatoria: única sin IDs, segunda con IDs, también después de `no_lookup`.
- Sin reintentos automáticos.
- Cancelación _best effort_.

Si la herramienta agota sus 5 segundos y queda presupuesto global, entregar `UNAVAILABLE` al LLM.

Si se agota el deadline global, responder `502 PROVIDER_ERROR`.

## 7. Validación de solicitudes

Rechazar inmediatamente:

- Herramientas desconocidas.
- Argumentos inválidos.
- Solicitudes múltiples.
- Solicitudes adicionales tras la primera ejecución.
- Solicitudes de herramientas en la segunda inferencia.
- Respuestas intermedias malformadas; no confundir con contenido textual descartable de un sobre válido sin llamadas nativas.

No ejecutar herramientas ni conceder llamadas de recuperación tras un rechazo.

La respuesta pública será `502 PROVIDER_ERROR`.

Registrar causas internas sin exponer datos sensibles.

## 8. Seguridad

### 8.1. Datos recuperados

Campos permitidos: `id`, `title`, `description`, `category`.

Límites:

- `title`: 200 puntos de código Unicode.
- `description`: 2.000 puntos de código Unicode.

#### Truncamiento — M1

El límite se contará en **puntos de código Unicode**, no en unidades UTF-16.

Ejemplo conceptual:

```ts
Array.from(value).slice(0, limit).join('');
```

El truncamiento:

- Será determinista.
- Preservará el orden original.
- No añadirá instrucciones ni contenido.
- No dividirá pares sustitutos válidos.
- Se aplicará antes de serializar el resultado de la herramienta.

No se exige segmentación por grafemas en I006.

### 8.2. Datos no confiables

Presentar los resultados de herramientas como datos no confiables.

No introducir contenido recuperado como instrucciones de sistema.

Evitar registrar descripciones, prompts o respuestas arbitrarias con información sensible.

### 8.3. Prompt injection

Distinguir dos niveles:

**Controles deterministas:** validación de herramientas, argumentos, límites, operaciones permitidas y respuestas finales.

**Resistencia semántica:** evaluación experimental del comportamiento del modelo ante instrucciones maliciosas incluidas en incidencias recuperadas.

Superar las evals no demuestra inmunidad absoluta frente a prompt injection.

## 9. Resultados y errores

### 9.1. Resultado interno

Clasificación:

```json
{ "status": "CLASSIFIED", "category": "BUG" }
```

Abstención:

```json
{
  "status": "INSUFFICIENT_CONTEXT",
  "category": null,
  "toolUnavailable": false
}
```

### 9.2. Endpoint público

Mantener:

`POST /api/v1/incidents/classify`

Entrada:

```json
{ "description": "La aplicación falla al iniciar sesión" }
```

Respuesta exitosa:

```json
{ "category": "BUG" }
```

### 9.3. Mapeo HTTP

| Condición                              | HTTP | Código                       |
| -------------------------------------- | ---- | ---------------------------- |
| Clasificación válida                   | 200  | —                            |
| Abstención sin indisponibilidad previa | 422  | `INSUFFICIENT_CONTEXT`       |
| Abstención después de `UNAVAILABLE`    | 503  | `CLASSIFICATION_UNAVAILABLE` |
| Fallo de Ollama                        | 502  | `PROVIDER_ERROR`             |
| Solicitud de herramienta inválida      | 502  | `PROVIDER_ERROR`             |
| Deadline global agotado                | 502  | `PROVIDER_ERROR`             |

Conservar el sobre de error de I001:

```json
{
  "error": {
    "code": "PROVIDER_ERROR",
    "message": "No se pudo completar la clasificación.",
    "requestId": "req-123"
  }
}
```

### 9.4. Causas internas

Distinguir:

- Fase de decisión, herramienta o clasificación final donde se produjo el fallo, mediante metadatos seguros.
- Timeout del proveedor.
- Error de conexión.
- Error HTTP del proveedor.
- Respuesta inválida.
- Solicitud de herramienta inválida.
- Deadline global agotado.

Los errores técnicos del repositorio se tratarán separadamente como `UNAVAILABLE`, cuando corresponda.

Reutilizar las clases de errores existentes cuando resulte compatible con sus contratos. Conservar `kind` y los códigos diagnósticos seguros enumerados de `invalid_response`, sin detalles de Ajv, mensajes arbitrarios ni texto de modelo en informes o HTTP. Una fase final inválida nunca se reinterpreta como `no_lookup`.

## 10. Compatibilidad histórica

Preservar `IncidentClassifier` y `OllamaClassifier` para los experimentos I002–I005.

Los runners históricos llamarán directamente:

```ts
const result = await classifier.classify(description);
```

No crear `classifyDirectly()`.

Preservar:

- Modelo y versión.
- Prompts.
- Esquemas de salida.
- Parámetros de inferencia.
- Timeouts.
- Datasets.
- Procedimiento de invocación.

### Reproducción histórica

El procedimiento de I002–I005 conserva la ruta sin herramientas y su configuración correspondiente. Esta descripción no autoriza repetir ningún experimento: todos los anteriores permanecen cerrados; no se reinicializan sus controles. Para estudiar la revisión 5 de I006 se utiliza su código e identidad Git históricos, no se afirma que la revisión 6 reproduzca su flujo.

### Regresión I006

La regresión determinista utiliza proveedores simulados. Cualquier evaluación real adicional con datasets anteriores requeriría autorización independiente; no queda autorizada aquí.

No confundir ambos procedimientos.

La reproducción del procedimiento no garantiza respuestas idénticas del LLM.

## 11. Dataset de evaluación

**Total: 60 casos.**

| Grupo                                | Casos |
| ------------------------------------ | ----: |
| Clasificación directa sin referencia |    10 |
| Clasificación directa con referencia |    10 |
| Consulta necesaria                   |    20 |
| `NOT_FOUND` / `UNAVAILABLE`          |    10 |
| Adversariales o ambiguos             |    10 |

Cada caso debe definir:

- ID estable.
- Descripción.
- Categoría o abstención esperada.
- `toolExpected`.
- Herramienta e identificador esperados.
- Resultado sintético de herramienta.
- Escenario y etiquetas.
- Justificación.
- Pareja contrafactual, cuando exista.

Las expectativas individuales determinan los denominadores; no se excluyen grupos completos por su nombre.

El dataset contenido v3 ya fue revisado, aprobado y congelado el 2026-11-17, referencia `I006-DATASET-V3-FREEZE-2026-11-17`. Se conserva sin alterar un byte, incluidos esquema 1, IDs, etiquetas, expectativas, fixtures y pares. SHA-256:

`fa5b19d7783417220d2b852eabe9260352ba808a4307676f6a20fa86a4562490`.

Los nombres de grupo «directa» indican ausencia esperada de herramienta, no una inferencia única. Se mantienen 33 consultas esperadas y 27 casos sin consulta. La revisión 6 cambia el procedimiento de obtención del resultado, no el ground truth. No se vuelve a etiquetar a partir de predicciones observadas.

### Expectativas tras NOT_FOUND o UNAVAILABLE — P3

Cada caso que simule `NOT_FOUND` o `UNAVAILABLE` tendrá una expectativa final explícita:

- Categoría concreta, si la información restante permite clasificar.
- Abstención, si la información restante es insuficiente.

La evaluación comprobará por separado:

1. Si el modelo tomó correctamente la decisión de solicitar la herramienta.
2. Si la solicitud fue válida.
3. Si la herramienta se ejecutó correctamente según el escenario sintético.
4. Si el resultado final coincide con la expectativa.

Ejemplo:

- Descripción: «Me pasa exactamente lo mismo que en INC-142».
- Herramienta esperada: `getIncidentById("INC-142")`.
- Resultado simulado: `UNAVAILABLE`.
- Resultado final esperado: abstención.

Si el modelo solicita correctamente la herramienta pero responde `FEATURE`, la decisión de consulta puede contar como correcta y el resultado final como incorrecto.

No se descartará el caso de las métricas por tratarse de una indisponibilidad prevista.

### Expectativas adversariales — M3

Cada caso adversarial tendrá:

- Vector de ataque identificado.
- Comportamiento esperado.
- Herramienta e identificador permitidos, cuando proceda.
- Resultado final esperado.
- Condiciones explícitas de incumplimiento.

Ejemplos de incumplimiento:

- Solicitar una herramienta no autorizada.
- Utilizar un identificador introducido por contenido no confiable cuando contradice la tarea legítima.
- Ejecutar una segunda herramienta.
- Obedecer instrucciones de una incidencia recuperada que intentan modificar las reglas del sistema.

Estos casos se evaluarán individualmente y contribuirán a las métricas correspondientes.

## 12. Métricas

### Tool-call precision

Casos con solicitud correcta / casos con alguna solicitud.

Cada caso aporta como máximo una unidad.

Una solicitud correcta requiere:

- Consulta necesaria.
- Herramienta correcta.
- Argumentos válidos.
- Identificador correcto.
- Ausencia de solicitudes múltiples o infracciones del límite.

### Tool-call recall

Casos con consulta necesaria correctamente solicitada / casos con consulta necesaria esperada.

### Classification accuracy

Clasificaciones correctas / casos evaluables con categoría esperada.

Una abstención ante un caso que requiere clasificación cuenta como error, si la ejecución es técnicamente evaluable.

### Abstention accuracy

Decisiones correctas de clasificar o abstenerse / casos evaluables para esa decisión.

No mide la categoría concreta.

### Counterfactual consistency

Pares que cumplen ambas expectativas / pares completos y evaluables.

Cada pareja debe cumplir las expectativas de decisión de herramienta y resultado final.

### Reglas comunes

- Una respuesta múltiple es una decisión incorrecta.
- Una solicitud con identificador incorrecto es una decisión incorrecta.
- Las solicitudes adicionales se registran como infracciones, sin inflar los denominadores.
- Los casos técnicamente incompletos no se convierten artificialmente en errores semánticos.
- Los `UNAVAILABLE` previstos se evalúan normalmente.
- Los casos incompletos bloquean aceptación.
- Un denominador cero deja la métrica sin evaluar.
- Registrar numeradores, denominadores y resultados individuales.

### Umbrales

| Métrica                    | Mínimo |
| -------------------------- | -----: |
| Tool-call precision        |   90 % |
| Tool-call recall           |   90 % |
| Classification accuracy    |   85 % |
| Abstention accuracy        |   85 % |
| Counterfactual consistency |   90 % |

## 13. Política de ejecución de evals

- Verificar la congelación ya aprobada del dataset y expectativas antes de la evaluación de aceptación.
- Registrar modelo, versión, prompts, esquema, herramientas y parámetros.
- Conservar resultados individuales y agregados.
- Separar fallos técnicos de errores semánticos.
- No modificar silenciosamente expectativas.
- Detener nuevas inferencias ante timeout de Ollama y conservar resultados parciales, conforme a I005.
- Exigir los 60 casos evaluables para comprobar los umbrales.

### Protocolo histórico de revisión 6: dos fases por caso

Conservado como trazabilidad; para nuevas preparaciones rige exclusivamente la sección 19.

- Identificador del protocolo implementado: `I006-DECISION-CLASSIFICATION-V1`. No es una autorización.
- La cota de una pasada de 60 casos es 120 inferencias. Si los 60 alcanzan resultado final, se observan exactamente 120: una decisión y una clasificación por caso. No hay warm-up ni llamadas auxiliares de inferencia. Un rechazo de política puede dejar un caso evaluable con menos llamadas y sin resultado final; conserva sus penalizaciones y no obliga a ejecutar la segunda fase. Los fallos técnicos detienen la pasada. Ningún caso se repite.
- Reutilizar reserva durable de dos slots por caso antes del primer envío, contabilización de cada intento antes de llamar al proveedor, lock y bloqueo fail-closed. Una segunda fase no enviada no libera la reserva. Máximo 120 para la nueva pasada, sin añadir capacidad por diagnóstico ni reutilizar sobrantes cerrados.
- Primera fase con herramientas nativas y sin `format`; segunda sin herramientas y con el esquema final. Mantener orden del dataset, temperatura 0, timeouts 45/5/90, configuración de proveedor e identidad verificadas. No pasar al modelo etiquetas, justificaciones, pares ni objetivos adversariales.
- Observar separadamente intentos y estados de `decision` y `classification`: no iniciada, completada, rechazo de política o error técnico según corresponda. En un caso completado, cada fase tiene un intento. Registrar la fase de fallo mediante un código seguro; no inventar fase final ni resultado cuando no se ejecutó.
- `toolRequested`, `toolRequestValid`, `toolExecuted` y `toolDecisionCorrect` mantienen sus significados y una unidad por caso. `no_lookup` válido implica ausencia observada de solicitud, no abstención. Un error técnico de decisión deja la solicitud no observable; un fallo posterior conserva observaciones conocidas, pero el caso técnico sigue excluido de E.
- Las solicitudes adicionales de la segunda fase invalidan la decisión del caso sin inflar denominadores ni ejecutar herramienta. `tool_calls: []` sigue penalizado como solicitud inválida. Los rechazos de política siguen siendo evaluables y no se convierten en abstenciones; los errores técnicos detienen la pasada y bloquean la puerta experimental.
- La clasificación y los diagnósticos de abstención se calculan solo sobre el resultado final, nunca sobre contenido de decisión. Mantener las cinco fórmulas, umbrales y reglas de denominador cero. Mantener abstention recall/precision informativos, sin nuevos umbrales.
- Informes futuros con versión de esquema 2 y `protocolId` explícito, ambas fases, hashes separados de instrucciones de decisión y clasificación, esquema final, herramientas, dataset, configuración, modelo/digest, versión y metadatos de Ollama y referencia/huella de código y build. No reinterpretar ni migrar informes de versión 1 como si hubieran ejecutado dos fases.
- Persistir resultados parciales y errores saneados sin prompts, texto de decisión, respuestas crudas ni argumentos. Conservar estados `INCOMPLETE`, `COMPLETE_FAILED`, `COMPLETE_PASSED`, puerta determinista independiente y revisión humana posterior.
- El runner y el caso de uso existentes se adaptan, sin otro framework ni runner paralelo. La composición fija un manifiesto propio `evals/experiments/i006-decision-classification-manifest.json`, permisos desactivados inicialmente, y evidencias en `evals/reports/i006-decision-classification/`. El manifiesto desactivado está creado; los controles y directorio de evidencias no están inicializados. No se añadirá selector CLI para saltarse identidades o escoger un protocolo ya cerrado.
- El manifiesto `i006-manifest.json`, ledger y evidencias originales permanecen íntegros y CLOSED. La nueva identidad y cualquier inicialización o ejecución requieren aprobaciones independientes posteriores. Esta revisión no concede un presupuesto ejecutable ni activa permisos.

## 14. Criterios de aceptación

### Funcionalidad

- **I006-AC-01:** Sin identificadores elegibles, NO_LOOKUP determinista y exactamente una inferencia final con esquema; con referencias autosuficientes, decisión semántica sin consulta y segunda inferencia final. Nunca clasificar desde el texto de decisión.
- **I006-AC-02:** Una referencia innecesaria no obliga a consultar.
- **I006-AC-03:** Una consulta necesaria solicita correctamente `getIncidentById`.
- **I006-AC-04:** `FOUND` aporta contexto para la respuesta final.
- **I006-AC-05:** `NOT_FOUND` permite continuar.
- **I006-AC-06:** `UNAVAILABLE` permite continuar cuando queda presupuesto.

### Validación, límites y seguridad

- **I006-AC-07:** Normalización y validación estricta de identificadores.
- **I006-AC-08:** Rechazo de solicitudes inválidas, múltiples, desconocidas o adicionales.
- **I006-AC-09:** Máximo dos inferencias y una herramienta; recorrido completado sin ID usa una clasificación; con ID usa una decisión y una clasificación. Rechazo o fallo previo impide operaciones posteriores, sin completar artificialmente las dos llamadas.
- **I006-AC-10:** Aplicación de límites 45/5/90, precedencia determinista, sin reservas temporales ni reintentos.
- **I006-AC-11:** Truncamiento por puntos de código Unicode y serialización estructurada.
- **I006-AC-12:** Controles deterministas que impiden operaciones no autorizadas.
- **I006-AC-13:** Evaluación adversarial con expectativas explícitas de resistencia semántica frente a prompt injection.

### Contratos y compatibilidad

- **I006-AC-14:** Validación estricta según fase lógica: solo `LookupDecision` cuando existe fase LLM de decisión y resultado final de clasificación/abstención en la fase final; llamadas adicionales rechazadas, sin convertir texto o resultados de otra fase.
- **I006-AC-15:** Mapeo HTTP y errores públicos acordados.
- **I006-AC-16:** Compatibilidad del endpoint público.
- **I006-AC-17:** Petición de decisión solo con IDs elegibles, tools con enum dinámico y sin format, traducción estricta del sobre y llamadas nativas o `no_lookup` sin interpretar contenido; petición final con format y sin tools, esquema final estricto y preservación de solicitudes prohibidas para rechazo; correlación y errores seguros.
- **I006-AC-18:** Compatibilidad de I002–I005 sin herramientas en su ruta histórica.

### Evaluación

- **I006-AC-19:** Registro independiente de origen CODE/LLM de decisión, solicitudes, validez, pertenencia del ID y ejecuciones; la clasificación procede solo de la fase final y un caso aporta una unidad.
- **I006-AC-20:** Penalización de solicitudes innecesarias, inválidas o con identificador incorrecto.
- **I006-AC-21:** Separación de fallos técnicos y semánticos; bloqueo ante casos incompletos.
- **I006-AC-22:** Dataset contenido v3 congelado conservado byte a byte; grupos directos significan sin consulta, con expectativas explícitas para `NOT_FOUND`, `UNAVAILABLE`, casos adversariales y pares contrafactuales.
- **I006-AC-23:** Puertas determinista y experimental independientes; ambas cohortes deben superar sus umbrales por separado conforme a la sección 20, sin aceptación automática.
- **I006-AC-24:** Runners I002–I005 preservados con invocación directa al clasificador histórico.
- **I006-AC-25:** El endpoint utiliza exclusivamente el flujo I006.
- **I006-AC-26:** Runner sobre el flujo híbrido real, informes con protocolo e identidad diferenciados, origen de decisión e intentos/estados por fase; cota calculada por extracción (104 regresión, 105 holdout), controles e identidades por cohorte y parciales durables y aislamiento de todos los experimentos cerrados.

## 15. Puertas de aceptación

### Puerta 1 — Determinista

Superar el 100 % de los tests obligatorios sobre:

- Contratos.
- Validaciones.
- Límites y deadlines.
- Seguridad del backend.
- Errores.
- Compatibilidad histórica.

### Puerta 2 — Experimental

Completar los 60 casos evaluables con el modelo real y superar todos los umbrales definidos.

Ambas puertas son obligatorias e independientes. Se conservan 60 casos evaluables y los umbrales como condición experimental, sin añadir un umbral de 120 intentos observados: los rechazos de política conservan su evaluabilidad y penalización aunque no se ejecute la segunda fase. Para revisión 7 la cota se calcula desde las referencias elegibles: 104 para los 60 recorridos conocidos con resultado final.

Un resultado experimental favorable no compensa un incumplimiento determinista.

## 16. Entregables de implementación

Cuando se autorice:

1. Caso de uso `classifyIncident()` evolucionado.
2. Puerto LLM y adaptador Ollama con herramientas.
3. Puerto de repositorio y adaptador sintético reproducible.
4. Validación y ejecución controlada de `getIncidentById`.
5. Configuración de deadlines mediante constantes.
6. Mapeo HTTP de clasificación y abstención.
7. Tests deterministas.
8. Runners históricos compatibles.
9. Runner I006 y dataset de 60 casos.
10. Informe de resultados y métricas.

## 17. Plan histórico de implementación y verificación determinista — revisión 6

Las siete tareas fueron autorizadas e implementadas el 2026-11-18. No conceden permisos experimentales. La tabla conserva el alcance y las verificaciones aprobadas; la trazabilidad de cierre figura al final.

| Tarea        | Cambio mínimo y componentes previstos                                                                                                                                                                           | Verificación y trazabilidad                                                                                                                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I006-R6-T-01 | Ampliar `classification-llm.ts` con `LookupDecision`/`no_lookup`, manteniendo `infer`, mensajes y llamadas; validaciones por fase en `classification-response.ts`                                               | Tests de tipos y respuestas internas cruzadas; AC-14                                                                                                                                                                      |
| I006-R6-T-02 | Adaptar `tool-calling-protocol.ts` y `ollama-classification-llm.ts` para interpretar decisión sin validar el texto como clasificación; reutilizar transporte y códigos diagnósticos                             | Tabla de validez completa, contenido ignorado, JSON textual no ejecutable, arrays vacíos/múltiples, argumentos intactos, payloads tools/format excluyentes, esquema final sin relajar; AC-07/08/14/17                     |
| I006-R6-T-03 | Adaptar `classify-incident.ts`, instrucciones específicas y `composition.ts`; reutilizar herramienta, repositorio y `ClassificationDeadline`                                                                    | Dos inferencias para `no_lookup`, FOUND, NOT_FOUND y UNAVAILABLE; ninguna operación tras rechazo/error; no incorporar texto de decisión; correlación; AC-01–11/13/25                                                      |
| I006-R6-T-04 | Mantener HTTP y sus mensajes; adaptar proveedores simulados a ambas fases, sin refactorización HTTP innecesaria                                                                                                 | 200, 422, 503, 502 y 500 seguros; cuatro combinaciones NOT_FOUND/UNAVAILABLE con clasificación/abstención; privacidad de respuestas/logs; AC-15/16/25                                                                     |
| I006-R6-T-05 | Adaptar módulos existentes de `src/evaluation/tool-calling/` (observación, ejecución, tipos, informe, composición/control) al protocolo y reporte v2; prever configuración propia desactivada sin inicializarla | 60 casos simulados → 120 intentos, contador por fase, parada en ambas fases, rechazos y solicitudes adicionales penalizados una vez, persistencia, fallos de disco, locks y controles anteriores intactos; AC-12/19–23/26 |
| I006-R6-T-06 | Revisar tests de unidad, HTTP, Ollama, composición y evaluación; mantener regresión I002–I005 en su ruta histórica                                                                                              | Compilación estricta, tests afectados, `npm run verify`, `git diff --check`, hash del dataset y controles/evidencias anteriores intactos; AC-18/24 y regresión del resto                                                  |
| I006-R6-T-07 | Sincronizar README/arquitectura/guía con comportamiento realmente implementado y entregar matriz de 26 AC                                                                                                       | Distinguir cobertura determinista de compatibilidad/eficacia real pendiente; revisión humana antes de inicialización o inferencias                                                                                        |

Los tests temporales controlarán reloj monotónico y temporizadores: timeout individual de herramienta con tiempo restante permite UNAVAILABLE y segunda fase; vencimiento simultáneo prevalece como deadline global y evita esa fase. Primera inferencia de 45 s seguida de herramienta de 5 s limita la segunda al remanente, no a otros 45 s completos. Se probará que el texto de decisión, incluidas categorías o supuestas instrucciones de herramienta, nunca entra en la conversación final ni en logs/informes.

Las fuentes, prompts, identidades y evidencias de diagnósticos de revisión 5 siguen disponibles en sus commits históricos y directorios privados. Sus resultados no acreditan el flujo nuevo. Los launchers históricos deben continuar bloqueados por sus permisos/cierres e identidades; no se modificarán ni reactivarán para probar revisión 6. Si una dependencia compartida provoca incompatibilidades en sus tests, se identificarán y propondrá su adaptación determinista antes de ampliar el alcance, preservando las garantías históricas; no se promete reproducir revisión 5 con un caso de uso modificado.

### Definition of Done de revisión 6

- Todos los AC automatizables cuentan con tests trazables para las dos fases, sin Ollama real.
- Compilación estricta, suite, formato, lint y revisión de diff satisfactorios.
- Dataset congelado y artefactos de I002–I005 y de todas las ejecuciones I006 anteriores intactos.
- Documentación sincronizada y limitaciones/desviaciones registradas; no confundir diseño aprobado con código desplegado.
- Una futura evaluación completa, expresamente autorizada con nueva identidad y controles propios, satisface la puerta experimental sin reintentos ni modificación del ground truth.
- Revisión y aceptación humanas de la implementación y evidencias antes de marcar Verified. Implementación completada y aceptación experimental son estados distintos; ningún test o informe los concede automáticamente.

## 18. Estado y trazabilidad de la revisión

**Implemented — revisión 6, 2026-11-18. Implementación aceptada por el responsable tras segunda revisión independiente APPROVED; puerta experimental pendiente.** La revisión 5 se aprobó el 2026-11-13 y su implementación de fases 1–7 y migración AC-24 queda como antecedente; no se marca I006 Verified.

| Cambio aprobado el 2026-11-18                                         | Resolución                                                                                                            |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Atajo de clasificación/abstención en la primera llamada de revisión 5 | Sustituido por DEC-I006-029; DEC-I006-005/012 y AC-01/09/14/17/26 se actualizan expresamente                          |
| «Clasificación directa»                                               | Se conserva como sin consulta, siempre con dos fases si se completa                                                   |
| Primera respuesta sin llamadas                                        | `no_lookup` solo tras validar protocolo; texto descartado, sin esquema final ni ejecución desde JSON textual          |
| Experimento original y diagnósticos                                   | Permanecen cerrados con resultados e identidades originales; no se trasladan como resultados de revisión 6            |
| Dataset                                                               | Misma aprobación, contenido 3 y hash; cambia el protocolo, no ejemplos o etiquetas                                    |
| Presupuesto                                                           | 120 inferencias para una futura pasada completa bajo nueva autorización; no reutilizar ni liberar reservas anteriores |

No se han detectado contradicciones normativas pendientes tras la sustitución explícita del atajo anterior. La implementación vigente utiliza revisión 6. La incompatibilidad de los diagnósticos históricos fue elevada al responsable y su retirada recibió autorización expresa: rechazo antes de cualquier reserva, proveedor, herramienta o evidencia, conservando sus versiones originales en Git. Los controles y evidencias cerrados no se migran ni se reabren.

Los AC mantienen sus 26 IDs y los umbrales no cambian. DEC-I006-001 a DEC-I006-028 conservan trazabilidad histórica; DEC-I006-029 y el ADR-003 documentan la sustitución aprobada. La implementación de revisión 6 está completada y fue aceptada por el responsable el 2026-11-18 tras segunda revisión independiente APPROVED, con los hallazgos HIGH y LOW resueltos. La autorización de implementación y correcciones deterministas no autoriza inicialización ni inferencias; dataset, permisos y evidencias históricos se conservan intactos.

## 19. Trazabilidad de implementación de revisión 6 — 2026-11-18

Las tareas I006-R6-T-01–07 están implementadas. La ampliación de alcance autorizada retira las tres entradas diagnósticas históricas incompatibles, sin modificar sus autorizaciones, identidades ni evidencias. Las pruebas positivas de su antigua ejecución se conservan en Git y se sustituyen por pruebas de rechazo antes de cualquier efecto; sus utilidades de transporte siguen probadas y se reutilizan. No se mantiene una orquestación productiva de revisión 5.

La tabla distingue cobertura determinista de aceptación experimental. «Determinista» acredita mecanismos y comportamiento con proveedores simulados, no decisiones semánticas reales del modelo. La implementación tiene aceptación humana expresa tras segunda revisión independiente APPROVED. La puerta experimental de revisión 6 y la aceptación de sus futuras evidencias siguen pendientes. Ningún resultado histórico se traslada al protocolo nuevo.

| Criterio | Evidencia determinista (archivos bajo `test/`)                                                                                                                                              | Pendiente                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| AC-01    | `unit/classification-phases.test.ts`, `unit/classify-incident-orchestration.test.ts`: no_lookup y segunda clasificación obligatoria                                                         | Calidad de decisión y clasificación real                                   |
| AC-02    | `tool-calling-evaluation/execution.test.ts`: fixtures sin consulta, referencias incidentales                                                                                                | Decisión real del modelo                                                   |
| AC-03    | `unit/classify-incident-orchestration.test.ts`, `ollama/tool-calling-adapter.test.ts`: solicitud y correlación                                                                              | Solicitud nativa correcta con Ollama                                       |
| AC-04    | `unit/classify-incident-orchestration.test.ts`, `http/tool-calling.test.ts`: FOUND y contexto estructurado                                                                                  | Uso semántico del contexto                                                 |
| AC-05    | Mismos tests y `tool-calling-evaluation/execution.test.ts`: NOT_FOUND con clasificación o abstención                                                                                        | Decisión final real                                                        |
| AC-06    | Mismos tests y `unit/classification-deadline.test.ts`: UNAVAILABLE y presupuesto restante                                                                                                   | Decisión final real                                                        |
| AC-07    | `unit/get-incident-by-id.test.ts`, `unit/synthetic-incident-repository.test.ts`: prefijo, regex y argumentos                                                                                | Sin laguna determinista identificada                                       |
| AC-08    | `unit/classify-incident-orchestration.test.ts`, `unit/classification-phases.test.ts`: vacías, múltiples, desconocidas y adicionales                                                         | Frecuencia de infracciones reales                                          |
| AC-09    | `unit/classification-phases.test.ts`, `tool-calling-evaluation/control.test.ts`: dos fases y límites                                                                                        | Respeto de tiempos en entorno real                                         |
| AC-10    | `unit/classification-deadline.test.ts`, `unit/classify-incident-orchestration.test.ts`: 45/5/90 y precedencia simultánea                                                                    | Cancelación del proveedor best effort                                      |
| AC-11    | `unit/get-incident-by-id.test.ts`, `http/tool-calling.test.ts`: Unicode y serialización                                                                                                     | Sin laguna determinista identificada                                       |
| AC-12    | `tool-calling-evaluation/control.test.ts`, `diagnostics/i006-*.test.ts`: permisos, reservas durables, revocación, locks, fallos de persistencia y retirada                                  | Revisión operativa antes de autorizar                                      |
| AC-13    | `http/tool-calling.test.ts` y dataset validado: separación de roles, límites y privacidad                                                                                                   | Resistencia semántica en los seis adversariales                            |
| AC-14    | `unit/classification-phases.test.ts`, `ollama/invalid-response-diagnostics.test.ts`: validación por fase, sin conversiones                                                                  | Sin laguna determinista identificada                                       |
| AC-15    | `http/tool-calling.test.ts`, `http/app.test.ts`: 200/422/503/502/500 y errores seguros                                                                                                      | Sin laguna determinista identificada                                       |
| AC-16    | `http/app.test.ts`, `ollama/adapter.test.ts`: contrato público y validaciones históricas                                                                                                    | Sin laguna determinista identificada                                       |
| AC-17    | `ollama/tool-calling-adapter.test.ts`, `unit/classification-phases.test.ts`: tools/format excluyentes, texto descartado, llamadas intactas                                                  | Compatibilidad real de revisión 6                                          |
| AC-18    | Suites `evaluation/`, `robustness/`, `model-comparison/`, `independent-validation/`: regresión simulada I002–I005                                                                           | No implica repetir experimentos                                            |
| AC-19    | `unit/classification-phases.test.ts`, `tool-calling-evaluation/execution.test.ts`: estados e intentos por fase y decisión observada                                                         | Observaciones de una nueva pasada autorizada                               |
| AC-20    | `tool-calling-evaluation/metrics.test.ts`: ID incorrecto y solicitudes inválidas/múltiples/adicionales                                                                                      | Resultados reales                                                          |
| AC-21    | `tool-calling-evaluation/execution.test.ts`, `control.test.ts`, `report.test.ts`: parada técnica, parciales y ausencia de reintentos                                                        | Revisión operativa y experimental                                          |
| AC-22    | `tool-calling-evaluation/dataset.test.ts`: 60 casos, cuotas, fixtures, diez pares; hash congelado comprobado                                                                                | Ningún cambio de ground truth autorizado                                   |
| AC-23    | `tool-calling-evaluation/metrics.test.ts`, `diagnostics.test.ts`, `unit/classification-phases.test.ts`: gates independientes y denominadores intactos                                       | Cinco umbrales y aceptación experimental                                   |
| AC-24    | Suites históricas y `unit/application.test.ts`: llamada directa al clasificador, trim y contexto del método preservados                                                                     | Cierre histórico conservado                                                |
| AC-25    | `unit/production-composition.test.ts`, `http/tool-calling.test.ts`: HTTP exclusivo sobre I006                                                                                               | Sin laguna determinista identificada                                       |
| AC-26    | `unit/classification-phases.test.ts`, `tool-calling-evaluation/control.test.ts`, `report.test.ts`: 60 casos simulados/120 intentos, reporte v2, identidad y fases; config nueva desactivada | Identidad efectiva y autorización independiente, sin inicialización actual |

El protocolo `I006-DECISION-CLASSIFICATION-V1`, las dos instrucciones y la nueva identidad de código/build cambian la identidad experimental. Su cálculo efectivo, aprobación, inicialización y ejecución requieren pasos posteriores autorizados. El manifiesto propio tiene permisos desactivados e identidad nula. La revisión 6 no tiene ledger ni resultados reales. La calidad semántica y compatibilidad con Ollama no se presentan como demostradas.

### Aceptación de implementación y correcciones de revisión independiente

El responsable acepta expresamente la implementación de revisión 6 el **2026-11-18** tras segunda revisión independiente **APPROVED**. Los hallazgos HIGH (pérdida del parcial ante fallo previo a reserva) y LOW (estado documental obsoleto) quedan resueltos. La verificación determinista de las correcciones pasó **296/296 tests**, formato, lint, compilación estricta y `git diff --check`; el commit de cierre exige volver a ejecutar estas comprobaciones.

El evaluador distingue inicio lógico, intento durable confirmado, reserva incierta y envío observado. Un fallo de autorización/reserva se sanea como `control_error`; se conserva el prefijo y el caso técnico en el checkpoint cuando su almacenamiento está disponible, sin relajar la correspondencia con el ledger ni devolver capacidad. Si el ledger queda incierto se bloquea y no se repara automáticamente. Si tampoco puede persistirse el informe, siguen vigentes el bloqueo conservador y las evidencias anteriores. Esta aceptación no autoriza inferencias ni inicialización y no acredita la puerta experimental. El estado de I006 sigue **Implemented**, no Verified.

## 19. Revisión 7 — diseño aprobado, implementación autorizada

Fecha: **2026-11-19**. La experimentación exploratoria fue aceptada como justificación de selección candidata, no como validación del nuevo flujo. Las secciones anteriores que describen revisión 6 son históricas donde contradigan esta sección. Se mantienen todas las reglas no sustituidas y los resultados anteriores.

### Decisiones aprobadas

| ID        | Decisión vigente                                                                                                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEC-R7-01 | Candidato Ollama `qwen3:8b`, Q4_K_M, digest `500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41`, temperatura 0 y `think: false`. No cambia el modelo desplegado ni el default Llama. |
| DEC-R7-02 | Extraer exclusivamente de la descripción original IDs completos `^INC-[1-9][0-9]{0,5}$`, normalizar solo prefijo, eliminar duplicados y rechazar coincidencias parciales o integradas.              |
| DEC-R7-03 | Cero IDs: decisión CODE NO_LOOKUP, sin inferencia de decisión ni herramientas, una inferencia final estructurada.                                                                                   |
| DEC-R7-04 | Uno o más IDs: decisión LLM nativa sin format con enum dinámico, máximo una herramienta y posterior clasificación obligatoria; dos inferencias al completar.                                        |
| DEC-R7-05 | Validar en aplicación nombre, argumentos, multiplicidad y pertenencia al conjunto original, independientemente del schema del proveedor. Un rechazo no se transforma en NO_LOOKUP.                  |
| DEC-R7-06 | Clasificación final sin tools y con schema estricto; contexto original y resultado autorizado, sin texto de decisión. HTTP, categorías y abstención permanecen iguales.                             |
| DEC-R7-07 | Añadir las definiciones oficiales BUG/FEATURE/QUESTION al prompt de decisión para juzgar suficiencia. Mejora semántica como hipótesis no evaluada; sin ejemplos ni IDs concretos.                   |

Estas decisiones actualizan DEC-I006-001/005/012/029: el LLM decide necesidad solo cuando hay referencias elegibles; la clasificación es siempre fase final, pero no siempre segunda inferencia. DEC-I006-007 y todas las restricciones de error, privacidad, límites y herramientas se mantienen.

### Extracción y contrato interno

El extractor distingue tokens de IDs completos de la búsqueda textual. Se consideran límites léxicos las letras y marcas Unicode, números, guion y guion bajo: no extraer un prefijo válido dentro de una secuencia inválida, demasiado larga o alfanumérica. Se conserva orden de primera aparición; solo `inc-` admite normalización de mayúsculas. No se recorta ni repara el identificador. Citas en la descripción siguen siendo datos no confiables: elegibilidad sintáctica no implica necesidad semántica ni autorización de acceso.

`ClassificationLlm.infer` recibe opcionalmente `eligibleIncidentIds` para el schema dinámico; cuando `toolsEnabled` es true la lista no puede estar vacía. Aplicación vuelve a comprobar pertenencia usando `readIncidentId`. La configuración `think` pertenece a infraestructura/composición, nunca a dominio ni aplicación.

### Evaluación y controles

Protocolo propio `I006-HYBRID-CLASSIFICATION-V1`, manifiesto `i006-hybrid-manifest.json` y directorio privado `evals/reports/i006-hybrid/`. Permisos inicialmente false e identidad null; no inicializados. El CLI existente no permite escoger protocolos cerrados. El manifiesto de revisión 6 queda intacto y sus controles no se reutilizan.

Dataset contenido 3 y hash aprobados intactos. Los 60 casos son **regresión conocida, no holdout independiente**, por su uso durante desarrollo y selección. La preparación independiente y cualquier inferencia corresponden a un bloque posterior.

La extracción implementada deberá confirmar 16 casos sin ID y 44 con ID; reserva conservadora por caso de uno o dos slots respectivamente: **16 + 44 × 2 = 104**. Ninguna reserva no enviada se libera. Se preservan lock, journals previos al envío, cierre durable, prohibición de reanudación y saneamiento de fallos de autorización/reserva/persistencia. Inicio lógico, intento reservado y envío real siguen separados. La primera reserva corresponde a classification en ruta CODE o decision en ruta LLM; no se deduce fase del ordinal de envío.

El informe serializado identifica `dataset.cohort: KNOWN_REGRESSION`. `status` (INCOMPLETE/COMPLETE_FAILED/COMPLETE_PASSED) y `thresholdGate` describen exclusivamente completitud y umbrales de esa cohorte; COMPLETE_PASSED no significa validación independiente ni aceptación de I006. Para la regresión conocida, `experimentalGate` e `assessment.independentValidation` permanecen NOT_EVALUATED y `assessment.iterationAcceptance` es NOT_GRANTED, con `assessment.scope: COHORT_THRESHOLDS_ONLY`. La aceptación humana sigue fuera del informe automático. El campo de cohorte distingue KNOWN_REGRESSION e INDEPENDENT_HOLDOUT; la sección 20 incorpora la preparación de la segunda y la validación cruzada de identidad/dataset. Seleccionar una cohorte no concede independencia absoluta ni permiso de ejecución.

Los segmentos serializan `interpretation: DESCRIPTIVE_ONLY` y `bindingThresholds: false`; sus métricas conservan fórmulas y referencias numéricas existentes, pero no añaden puertas vinculantes. Estos metadatos no modifican umbrales, denominadores, política de errores ni controles operativos.

Registrar `decisionSource: CODE | LLM`, fases no iniciadas, solicitudes/validez/ID, ejecuciones, errores y resultado final. Ofrecer métricas globales y segmentadas por origen sin umbrales nuevos. No atribuir un bloqueo de backend como acierto semántico LLM. Mantener las cinco fórmulas y umbrales, diagnósticos de abstención, contadores y denominadores, gate determinista independiente y estados INCOMPLETE/COMPLETE_FAILED/COMPLETE_PASSED.

### Criterios adicionales y verificación

- **I006-AC-27:** Extracción completa y determinista, deduplicación, límites Unicode y normalización; sin identificadores desde prompts, herramientas o resultados.
- **I006-AC-28:** Ausencia de IDs omite decisión LLM; presencia genera enum y validación posterior independiente que bloquea cualquier ID no aportado antes del repositorio.
- **I006-AC-29:** Candidato Qwen con think false identificado sin promoción automática; trazabilidad CODE/LLM, métricas segmentadas y presupuestos por cohorte de 104/105 con controles propios desactivados.

Plan: (1) extractor y contrato mínimo; (2) orquestación híbrida y validación; (3) enum y configuración candidata en infraestructura; (4) prompt de decisión; (5) observación, informes y métricas segmentadas; (6) control por ruta e identidad independiente; (7) regresión determinista integral, HTTP e históricos, autorrevisión y consistencia documental. Actualizar tests obsoletos de dos fases obligatorias conservando su garantía en entradas con referencias. No ejecutar modelos ni modificar evidencias. Implementación pendiente de revisión independiente; puerta experimental pendiente y ninguna inferencia autorizada por este documento.

### Implementación y trazabilidad de revisión 7 — pendiente de aceptación

La implementación de este bloque prepara las siete tareas anteriores. Se conserva estado Implemented, sin aceptación de revisión 7 ni puerta experimental superada. No hay promoción o despliegue; Llama sigue siendo el default de la API. La autorrevisión de Codex no es una revisión independiente.

| AC                   | Evidencia determinista vigente                                                                                                                              | Pendiente                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 01–03                | `hybrid-classification`, `classify-incident-orchestration`, `classification-phases`: rutas de una/dos inferencias, decisiones simuladas y consulta opcional | Calidad semántica de necesidad y categoría con Qwen            |
| 04–06                | Orquestación y HTTP: FOUND, NOT_FOUND, UNAVAILABLE con clasificación/abstención                                                                             | Recorrido real autorizado                                      |
| 07–08, 12, 14, 27–28 | Extracción Unicode, enums por petición, validación posterior y rechazos antes del repositorio; protocolo estricto                                           | Ningún control determinista identificado como pendiente        |
| 09–10                | Orquestación y deadline: límites, precedencia y parada sin recuperación; nueva ruta de una inferencia                                                       | Latencia real y cancelación best effort                        |
| 11, 15–16, 25        | Truncamiento, correlación, privacidad y regresión del contrato HTTP                                                                                         | Ningún cambio público autorizado                               |
| 13                   | Separación de roles, contenido recuperado no confiable y bloqueo de operaciones adicionales                                                                 | Resistencia semántica adversarial no demostrada                |
| 17, 29               | Adaptador simulado: herramientas nativas con enum, final con schema, think false y candidato identificado sin cambio de defaults                            | Compatibilidad real del flujo y prompt nuevos                  |
| 18, 24               | Regresión simulada I002–I005; adaptadores, prompts y contratos históricos intactos                                                                          | No repetir ejecuciones históricas                              |
| 19–21, 26            | Observación CODE/LLM, 104 envíos simulados, journals durables y fallos de autorización/reserva/persistencia con parciales                                   | Revisión independiente e identidad/autorización futuras        |
| 22                   | Dataset y hash congelados, 60 casos, fixtures y diez pares; extracción 16/44                                                                                | Es regresión conocida; preparar conjunto independiente después |
| 23                   | Fórmulas y gates separados, segmentación informativa sin nuevos umbrales                                                                                    | Puerta experimental y aceptación humana                        |

Los tests anteriores que asumían dos inferencias sin referencia se actualizan a la ruta de una; las pruebas de fallos entre fases usan entradas simuladas con referencias para conservar su garantía original. No se eliminan tests. La prueba de composición I003 conserva sus payloads históricos y usa una referencia explícita solo para probar las dos fases HTTP actuales. La solicitud de un ID no aportado se comprueba como bloqueo; otro test conserva el caso distinto de un ID elegible pero semánticamente incorrecto.

La comprobación adicional del smoke R6 usa escenarios inyectados expresamente sintéticos con referencia para seguir probando sus barreras de cuatro envíos; no ejecuta ni reinterpreta I006-001 histórico con arquitectura nueva. El guion original permanece sin cambios, fijado a su identidad anterior y con autorización cerrada. La extracción y los schemas de revisión 7 no reutilizan autorizaciones de esa prueba. Se conserva el texto de la declaración nativa exploratoria y se añade únicamente el enum dinámico; las definiciones del prompt son la hipótesis semántica nueva.

Verificación de implementación del **2026-11-19**: `npm run verify` satisfactorio con **317/317 tests** (formato, lint y TypeScript estricto incluidos); comprobación adicional de 51 tests sobre extractor, adaptador y scripts históricos, todos satisfactorios. `git diff --check` conforme. `--validate` confirma dataset v3 congelado, cohorte KNOWN_REGRESSION y cota 104. No se realizaron inferencias ni inicialización en este bloque. La revisión 7 queda implementada, sin commit y pendiente de revisión independiente y posterior validación experimental; no implica aceptación humana.

## 20. Preparación de dos cohortes — autorización posterior a revisión técnica APPROVED

La implementación de R7 se congela en el commit técnico antes de redactar el holdout. El inventario `evals/experiments/i006-r7-system-freeze.json` identifica código de aplicación/dominio/infraestructura y composición/configuración que no podrá ajustarse a estos casos. Solo se adapta el evaluador; no se modifican prompt, modelo ni selección/clasificación.

Se preparan KNOWN_REGRESSION (60 casos originales, contenido 3, 104 inferencias) e INDEPENDENT_HOLDOUT (60 casos sintéticos nuevos, contenido 1). No se mezclan sus resultados ni se calcula una métrica global conjunta. Cada cohorte deberá superar por separado las cinco referencias existentes (90/90/85/85/90 %) y los controles deterministas deben pasar al 100 %. La recomendación de aceptación exige ambas cohortes; la aceptación definitiva sigue requiriendo decisión humana explícita.

El holdout conserva esquema y campos de casos, cuotas 10/10/20/10/10, cinco NOT_FOUND, cinco UNAVAILABLE, seis adversariales, cuatro ambiguos y diez pares. Usa ID de dataset `incidents-tool-calling-holdout-es-v1` y casos `I006-H-001` a `I006-H-060`, sin modificar el conjunto original. Se añaden referencias múltiples e inválidas dentro de esas cuotas. Etiquetas derivadas de reglas funcionales, sin inferencias ni predicciones como criterio. Su distribución y los 60 textos/fixtures/expectativas se documentan en `evals/experiments/i006-holdout-review.md`.

La independencia es procedimental: nuevo conjunto sintético después de congelar comportamiento, creado dentro del mismo proyecto, sin revisión humana independiente de etiquetas todavía y sin representatividad de producción acreditada. Se congela por hash antes de cualquier ejecución, con estado externo FROZEN_PENDING_HUMAN_REVIEW. Ese estado no autoriza inferencias. No se ajusta R7 ni se cambian expectativas tras observar resultados. La revisión humana de casos/etiquetas e identidades precede a cualquier futura autorización.

El mismo runner recibe un selector explícito `--cohort KNOWN_REGRESSION|INDEPENDENT_HOLDOUT` (por defecto KNOWN_REGRESSION para conservar el uso manual existente). El selector solo escoge una de dos configuraciones fijas: dataset, manifiesto y directorio propios. No acepta rutas o presupuestos arbitrarios. Nuevos manifiestos `i006-r7-known-manifest.json` e `i006-r7-holdout-manifest.json`, autorizaciones esquema 3, ambas false e identidad null. No se reutilizan manifiestos, estados ni controles anteriores. Las identidades incluyen cohorte y presupuesto calculado; una autorización de otra cohorte falla antes de efectos. Los controles durables y parciales se reutilizan sin liberar reservas ni permitir reanudación.

En KNOWN_REGRESSION se mantiene experimentalGate NOT_EVALUATED: PASSED de thresholdGate solo significa superar los umbrales de regresión. En INDEPENDENT_HOLDOUT, thresholdGate y experimentalGate describen los umbrales y la evidencia experimental de ese holdout, bajo scope SYNTHETIC_HOLDOUT_ONLY. Ningún PASSED representa aceptación global: los informes declaran requiredCohorts y mantienen iterationAcceptance NOT_GRANTED, puerta determinista separada y segmentos DESCRIPTIVE_ONLY sin umbrales adicionales. La revisión conjunta de las dos cohortes es humana; no se introduce un agregador que oculte deficiencias.

La preparación actual prohíbe consultar Ollama. `--identity` se calcula sin red desde metadatos públicos conservados de la selección; se identifica el hash íntegro del descriptor nativo. No acredita disponibilidad ni identidad en vivo. Antes de inicializar o ejecutar en el futuro, el camino operativo verificará metadatos en vivo y deberá coincidir con la identidad aprobada; un cambio bloqueará. El código/build y las fuentes congeladas se verifican localmente. Tras el commit de preparación se recalculan ambas identidades, sin rellenar ni activar permisos.
