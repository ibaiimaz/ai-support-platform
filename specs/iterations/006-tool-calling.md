# I006 — Tool Calling

**Proyecto:** AI Support Platform  
**Estado:** APPROVED  
**Versión:** Revisión 5  
**Fecha de aprobación:** 2026-11-13  
**Decisiones:** DEC-I006-001 a DEC-I006-028  
**Criterios de aceptación:** I006-AC-01 a I006-AC-26

---

## 1. Objetivo

Ampliar el clasificador de incidencias para que un LLM pueda consultar una incidencia anterior mediante una herramienta cuando necesite información adicional para clasificar una nueva incidencia.

Categorías disponibles:

- `BUG`
- `FEATURE`
- `QUESTION`

El LLM decide si necesita una herramienta. El backend valida, autoriza y ejecuta la solicitud.

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

Las decisiones siguientes están acordadas individualmente y la especificación global está APPROVED desde el 2026-11-13.

| ID           | Decisión                                                                           |
| ------------ | ---------------------------------------------------------------------------------- |
| DEC-I006-001 | El LLM decide si necesita una herramienta; el backend valida y ejecuta.            |
| DEC-I006-002 | `NOT_FOUND` se entrega al LLM y permite continuar.                                 |
| DEC-I006-003 | `UNAVAILABLE` representa indisponibilidad técnica de la consulta, sin reintentos.  |
| DEC-I006-004 | Se permite abstención interna sin alterar la respuesta pública exitosa.            |
| DEC-I006-005 | Máximo dos llamadas al LLM y una ejecución de herramienta.                         |
| DEC-I006-006 | Repositorio sintético; `FOUND` contiene `id`, `title`, `description`, `category`.  |
| DEC-I006-007 | Normalización limitada al prefijo del identificador y validación estricta.         |
| DEC-I006-008 | Truncamiento determinista y contenido recuperado no confiable.                     |
| DEC-I006-009 | 45 segundos por llamada al LLM y 90 segundos globales.                             |
| DEC-I006-010 | Resultados internos `CLASSIFIED` o `INSUFFICIENT_CONTEXT`.                         |
| DEC-I006-011 | Tests deterministas y evals reales con umbrales independientes.                    |
| DEC-I006-012 | Aceptar clasificación directa válida sin forzar consulta.                          |
| DEC-I006-013 | Evolucionar el único caso de uso de producción.                                    |
| DEC-I006-014 | Preservar la política de errores públicos genéricos de I001.                       |
| DEC-I006-015 | Timeout máximo de herramienta de 5 segundos.                                       |
| DEC-I006-016 | Abstención normal: 422; abstención tras `UNAVAILABLE`: 503.                        |
| DEC-I006-017 | Rechazo inmediato de solicitudes inválidas, múltiples, desconocidas o adicionales. |
| DEC-I006-018 | Deadline global agotado: `502 PROVIDER_ERROR`.                                     |
| DEC-I006-019 | Dataset de 60 casos y umbrales de evaluación definidos.                            |
| DEC-I006-020 | Una referencia explícita no implica necesidad de consulta.                         |
| DEC-I006-021 | Dos puertas de aceptación independientes y obligatorias.                           |
| DEC-I006-022 | Medir solicitudes, validez y ejecuciones por separado.                             |
| DEC-I006-023 | Separar fallos técnicos de resultados semánticos.                                  |
| DEC-I006-024 | Deadline global sin reservas temporales.                                           |
| DEC-I006-025 | Separar controles deterministas y resistencia semántica a prompt injection.        |
| DEC-I006-026 | Preservar runners históricos y evolucionar producción.                             |
| DEC-I006-027 | Orquestación de herramientas en aplicación.                                        |
| DEC-I006-028 | Una decisión evaluable de tool calling por caso.                                   |

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

Responsabilidades:

1. Iniciar el deadline global.
2. Invocar la primera inferencia.
3. Aceptar una clasificación directa o una abstención válida.
4. Si se solicitan herramientas, validar la solicitud completa.
5. Ejecutar la única consulta autorizada.
6. Entregar el resultado al LLM.
7. Ejecutar, como máximo, una segunda inferencia.
8. Validar el resultado final.
9. Devolver el resultado interno o un error controlado.

La orquestación pertenece a aplicación, no al adaptador Ollama.

### 3.2. Puerto LLM

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

type LlmResponse =
  | { type: 'classification'; category: Category }
  | { type: 'abstention' }
  | { type: 'tool_calls'; calls: ToolCall[] };

interface ClassificationLlm {
  infer(
    messages: LlmMessage[],
    options: {
      timeoutMs: number;
      toolsEnabled: boolean;
    },
  ): Promise<LlmResponse>;
}
```

#### Correlación de herramientas — P1

`callId` representa un identificador de correlación independiente del proveedor.

Reglas:

- Si el protocolo devuelve un identificador de llamada, el adaptador lo conservará.
- Si el protocolo exige correlación, el adaptador garantizará que solicitud y resultado se asocian correctamente.
- No se inventarán identificadores en aplicación sin necesidad.
- La ausencia de un identificador será válida si el protocolo no lo requiere.
- No se incorporarán estructuras específicas de Ollama a los contratos de aplicación.
- La segunda inferencia incluirá el turno del asistente que solicitó la herramienta y el resultado correspondiente.
- `toolsEnabled: false` no sustituye la validación: cualquier solicitud adicional de herramienta se rechazará.

La compatibilidad exacta se verificará durante la implementación.

El adaptador debe preservar las solicitudes múltiples para que aplicación pueda rechazarlas. No seleccionará silenciosamente la primera.

Las respuestas malformadas producirán errores técnicos tipados, no abstenciones.

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

El backend no fuerza consultas por encontrar referencias.

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

Si no queda presupuesto, no se inicia una nueva operación.

El timeout de la herramienta debe imponerse desde aplicación, sin depender exclusivamente de que el repositorio respete `timeoutMs`.

### 6.3. Precedencia de errores temporales — P2

Cuando coincidan o se solapen vencimientos:

1. **Deadline global agotado:** `global_deadline_exceeded`.
2. **Timeout individual del LLM**, si todavía queda presupuesto global: `provider_timeout`.
3. **Timeout de herramienta**, si todavía queda presupuesto global: entregar `UNAVAILABLE`.

La comprobación de la causa se realizará con el mismo reloj monotónico y con reglas deterministas.

No se utilizará el orden accidental de resolución de promesas para decidir qué error prevalece.

Los tests deberán simular el reloj y los vencimientos relevantes.

### 6.4. Límites funcionales

- Máximo dos llamadas al LLM.
- Máximo una ejecución de herramienta.
- Segunda inferencia exclusivamente para obtener un resultado final.
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
- Respuestas intermedias malformadas.

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

- Timeout del proveedor.
- Error de conexión.
- Error HTTP del proveedor.
- Respuesta inválida.
- Solicitud de herramienta inválida.
- Deadline global agotado.

Los errores técnicos del repositorio se tratarán separadamente como `UNAVAILABLE`, cuando corresponda.

Reutilizar las clases de errores existentes cuando resulte compatible con sus contratos.

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

Repetir el experimento original sin herramientas y con su configuración correspondiente.

### Regresión I006

Ejecutar datasets anteriores contra el nuevo flujo para detectar cambios de comportamiento.

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

El dataset debe revisarse y congelarse antes de las evals de aceptación.

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

- Congelar dataset y expectativas antes de la evaluación de aceptación.
- Registrar modelo, versión, prompts, esquema, herramientas y parámetros.
- Conservar resultados individuales y agregados.
- Separar fallos técnicos de errores semánticos.
- No modificar silenciosamente expectativas.
- Detener nuevas inferencias ante timeout de Ollama y conservar resultados parciales, conforme a I005.
- Exigir los 60 casos evaluables para comprobar los umbrales.

## 14. Criterios de aceptación

### Funcionalidad

- **I006-AC-01:** Clasificación directa sin herramienta cuando la descripción es suficiente.
- **I006-AC-02:** Una referencia innecesaria no obliga a consultar.
- **I006-AC-03:** Una consulta necesaria solicita correctamente `getIncidentById`.
- **I006-AC-04:** `FOUND` aporta contexto para la respuesta final.
- **I006-AC-05:** `NOT_FOUND` permite continuar.
- **I006-AC-06:** `UNAVAILABLE` permite continuar cuando queda presupuesto.

### Validación, límites y seguridad

- **I006-AC-07:** Normalización y validación estricta de identificadores.
- **I006-AC-08:** Rechazo de solicitudes inválidas, múltiples, desconocidas o adicionales.
- **I006-AC-09:** Respeto de los máximos de dos inferencias y una ejecución de herramienta.
- **I006-AC-10:** Aplicación de límites 45/5/90, precedencia determinista, sin reservas ni reintentos.
- **I006-AC-11:** Truncamiento por puntos de código Unicode y serialización estructurada.
- **I006-AC-12:** Controles deterministas que impiden operaciones no autorizadas.
- **I006-AC-13:** Evaluación adversarial con expectativas explícitas de resistencia semántica frente a prompt injection.

### Contratos y compatibilidad

- **I006-AC-14:** Validación estricta de resultados internos.
- **I006-AC-15:** Mapeo HTTP y errores públicos acordados.
- **I006-AC-16:** Compatibilidad del endpoint público.
- **I006-AC-17:** Traducción correcta de respuestas finales, correlación de herramientas cuando corresponda, solicitudes múltiples y errores del protocolo Ollama.
- **I006-AC-18:** Compatibilidad de I002–I005 sin herramientas en su ruta histórica.

### Evaluación

- **I006-AC-19:** Registro independiente de solicitudes, validez y ejecuciones.
- **I006-AC-20:** Penalización de solicitudes innecesarias, inválidas o con identificador incorrecto.
- **I006-AC-21:** Separación de fallos técnicos y semánticos; bloqueo ante casos incompletos.
- **I006-AC-22:** Dataset reproducible, con expectativas explícitas para `NOT_FOUND`, `UNAVAILABLE`, casos adversariales y pares contrafactuales.
- **I006-AC-23:** Cumplimiento independiente de ambas puertas de aceptación.
- **I006-AC-24:** Runners I002–I005 preservados con invocación directa al clasificador histórico.
- **I006-AC-25:** El endpoint utiliza exclusivamente el flujo I006.
- **I006-AC-26:** Runner I006 con informes separados de clasificación, solicitudes, validaciones, ejecuciones y fallos técnicos.

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

Ambas puertas son obligatorias e independientes.

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

## 17. Verificaciones pendientes

Estas verificaciones no bloquean la aprobación del diseño, pero sí la aceptación de la implementación:

- Compatibilidad real de tool calling con el modelo Ollama seleccionado.
- Compatibilidad entre herramientas y salida estructurada.
- Correlación de solicitudes y resultados según el protocolo real.
- Comportamiento real de abortos y cancelación.
- Compatibilidad de los runners históricos.
- Resultados de los tests deterministas.
- Resultados de las evals reales.

## 18. Estado

**APPROVED — 2026-11-13.**

Las decisiones DEC-I006-001 a DEC-I006-028 están incorporadas.

La aprobación de esta especificación no autoriza por sí misma la implementación.

La incorporación de esta especificación al repositorio es exclusivamente documental; no se ha implementado funcionalidad ni ejecutado tests o inferencias.
