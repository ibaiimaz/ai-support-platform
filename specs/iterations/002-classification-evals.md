# I002 — LLM Classification Evaluation

Estado: **Approved**. Fecha de preparación y aprobación: **2026-11-05**.

Especificación aprobada por el responsable del proyecto con las decisiones de la sección 12. La aprobación documental no autoriza todavía implementar el runner, generar el dataset ni modificar el clasificador. Se requiere autorización explícita posterior para comenzar la implementación.

Ciclo: `Draft → Approved → In Progress → Implemented → Verified`. `Verified` requiere revisión y aceptación humana, además de una ejecución real con Ollama.

## 1. Objetivo y alcance

Medir la calidad semántica del clasificador existente mediante una evaluación manual sobre 60 incidencias sintéticas versionadas. Cada ejemplo produce una única inferencia, de forma secuencial, llamando directamente al caso de uso y al adaptador real de Ollama, sin HTTP.

La iteración mide el comportamiento actual; no intenta mejorar precisión ni robustez. No se exige un umbral mínimo de calidad. Una predicción semánticamente incorrecta es un resultado de evaluación y no un fallo técnico del clasificador.

Fuentes de verdad:

- [AGENTS.md](../../AGENTS.md): proceso SDD, legibilidad y verificaciones.
- [Producto](../product.md): significado de `BUG`, `FEATURE` y `QUESTION`.
- [Arquitectura](../architecture.md): separación de aplicación y proveedor.
- [I001](001-classification.md): contrato de clasificación, errores técnicos y limitación de prompt injection; estado `Verified`, fecha `2026-11-04`.
- [ADR-001](../adr/ADR-001-sync-classification.md) y [ADR-002](../adr/ADR-002-provider-abstraction.md): operación síncrona y puerto desacoplado.

## 2. Encaje con la arquitectura real

### Componentes que se reutilizan

| Componente existente                                                       | Uso en I002                                                                                       |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src/application/classify-incident.ts`                                     | Invocar `classifyIncident(classifier, description)` una vez por ejemplo; no reproducir su lógica. |
| `src/application/incident-classifier.ts`                                   | Inyectar el proveedor real en la ejecución manual y uno simulado en tests. No cambiar el puerto.  |
| `src/domain/classification.ts`                                             | Reutilizar categorías y tipos tanto para dataset como para métricas.                              |
| `src/infrastructure/ollama/ollama-classifier.ts`                           | Reutilizar structured outputs, validación, timeout y tratamiento de errores de I001.              |
| `src/infrastructure/ollama/classification-instructions.ts`                 | Importar el prompt exacto existente para identificarlo, sin modificarlo.                          |
| `src/application/classification-errors.ts`                                 | Distinguir las causas técnicas ya definidas de excepciones inesperadas.                           |
| `src/config.ts`                                                            | Leer y validar la configuración efectiva de Ollama, con los valores iniciales de I001.            |
| `node:test`, `node:assert/strict`, Ajv y herramientas de estilo existentes | Pruebas y validación sin nuevo framework.                                                         |

El runner es otro punto de composición. No importa `src/main.ts`, porque abre el servidor, ni usa Fastify, rutas o `app.inject` para ejecutar evaluaciones.

### Diferencias que deben tratarse explícitamente

1. La validación y el `trim()` de la entrada residen actualmente en HTTP, no en el caso de uso. El cargador del dataset verificará el límite y contenido de I001 y el runner aplicará el mismo `trim()` antes de invocar el caso de uso. No se mueve la validación HTTP ni se añade un validador de transporte al dominio. Los límites en bytes del cuerpo HTTP no se aplican a un archivo de dataset.
2. El prompt ya se exporta, pero el esquema y las opciones de inferencia son privados del adaptador. Para registrar valores efectivos sin mantener una copia divergente, se expondrá un descriptor del adaptador con las constantes ya existentes, usado tanto al construir la petición como al generar metadatos. No cambia valores, mensajes ni protocolo. Esta extracción mínima está aprobada en I002-D-05, condicionada a conservar el comportamiento del adaptador.
3. El adaptador devuelve solo `Classification`, no tokens, latencias internas o digest del modelo. No se amplía ese contrato: se mide duración externa y se identifica el modelo por su nombre configurado. Un digest desconocido no se inventa.

No se necesitan cambios en el caso de uso, puerto, dominio, contrato HTTP ni manejador de errores de I001.

### Organización aprobada para implementar tras autorización

| Ubicación prevista                 | Responsabilidad                                                   |
| ---------------------------------- | ----------------------------------------------------------------- |
| `evals/datasets/incidents-v1.json` | Dataset versionado; no se crea en esta fase.                      |
| `src/evaluation/dataset.ts`        | Carga y validación completa del dataset antes de inferir.         |
| `src/evaluation/run-evaluation.ts` | Secuencia de llamadas al caso de uso y resultados individuales.   |
| `src/evaluation/metrics.ts`        | Cálculo puro y determinista de métricas.                          |
| `src/evaluation/report.ts`         | Metadatos, validación y escritura del informe JSON.               |
| `src/evaluation/main.ts`           | Entrada manual, composición de configuración y adaptador real.    |
| `test/evaluation/`                 | Pruebas deterministas con ejemplos pequeños y proveedor simulado. |
| `evals/reports/`                   | Informes locales, excluidos de Git.                               |

Se incorporará `npm run eval:classification`, tras `npm run build`, con dataset y directorio de salida fijos para esta iteración. Se añadirá una entrada a `.gitignore`. No hay nuevos flags, dependencias, servicios o contenedores. Las rutas y el script están aprobados como diseño; no son archivos ni comandos disponibles todavía.

Ventajas: el código de evaluación es pequeño, auditable y reutiliza el comportamiento productivo. Costes: sus errores afectan a la medición y requieren tests propios; una ejecución secuencial tarda más. Alternativas descartadas: medir por HTTP añade transporte ajeno al objetivo; llamar directamente a Ollama desde el runner duplicaría la clasificación; un framework de evaluación añade complejidad sin necesidad actual.

## 3. Requisitos funcionales y no funcionales

| ID          | Requisito                                                                                                                                                                                                               |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I002-RF-01  | Mantener un dataset JSON versionado de exactamente 60 ejemplos sintéticos en español: 20 por categoría y, dentro de cada categoría, 10 evidentes, 7 complejos y 3 adversariales.                                        |
| I002-RF-02  | Cada ejemplo contiene ID, descripción, categoría esperada, dificultad, etiquetas y justificación. Validar el dataset completo antes de realizar inferencias.                                                            |
| I002-RF-03  | Ejecutar manualmente los ejemplos en el orden del archivo, secuencialmente, con una llamada al caso de uso por ejemplo y sin reintentos adicionales.                                                                    |
| I002-RF-04  | Reutilizar el caso de uso, el puerto y el adaptador real de Ollama, sin pasar por HTTP ni duplicar la clasificación.                                                                                                    |
| I002-RF-05  | Asignar un resultado `correct`, `incorrect` o `error` a cada ejemplo intentado, conservando la predicción o la causa técnica según corresponda.                                                                         |
| I002-RF-06  | Calcular accuracy sobre respuestas válidas, precision, recall y F1 por categoría, macro-F1 y matriz de confusión con las convenciones de la sección 6.                                                                  |
| I002-RF-07  | Calcular además tasa de éxito extremo a extremo y tasa de ejecución satisfactoria con denominadores explícitos.                                                                                                         |
| I002-RF-08  | Generar un informe JSON local con resultados individuales, hashes del dataset y prompt, configuración efectiva, modelo, ejecución y referencia al código cuando esté disponible; sin hashes de módulos ni del lockfile. |
| I002-RF-09  | Distinguir errores técnicos conocidos, predicciones incorrectas y fallos inesperados del runner o del clasificador.                                                                                                     |
| I002-RNF-01 | Mantener prompt, mensajes, parámetros, comportamiento y valor inicial del modelo de I001. El runner acepta cualquier `OLLAMA_MODEL` válido; la primera evaluación real utiliza `llama3.1:8b`.                           |
| I002-RNF-02 | Excluir los informes generados de Git y evitar texto de incidencias o errores crudos en logs.                                                                                                                           |
| I002-RNF-03 | Probar métricas y flujo con herramientas existentes y simulaciones, sin Ollama ni red externa en los tests deterministas.                                                                                               |
| I002-RNF-04 | Respetar TypeScript estricto y convenciones de AGENTS.md; verificar formato, lint, compilación y suite mediante `npm run verify`.                                                                                       |
| I002-RNF-05 | Realizar una evaluación manual completa con Ollama como evidencia final, sin exigir umbrales mínimos de calidad.                                                                                                        |

## 4. Dataset y referencia semántica

Contrato del archivo:

| Campo           | Condición                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| `schemaVersion` | Versión del formato, inicialmente `1`.                                                                |
| `id`            | Identificador estable del dataset, no vacío.                                                          |
| `version`       | Versión del contenido, inicialmente `1`; se incrementa al cambiar ejemplos o etiquetas de referencia. |
| `examples`      | Array de 60 ejemplos con IDs únicos.                                                                  |

Contrato de cada ejemplo:

| Campo              | Condición                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `id`               | String no vacío y único en el dataset; estable entre revisiones del mismo caso.                                   |
| `description`      | String no vacío tras `trim()`; máximo de 4.000 puntos de código antes de normalizar, conforme a I001.             |
| `expectedCategory` | Una categoría de la definición común del dominio.                                                                 |
| `difficulty`       | Enum: `obvious`, `complex`, `adversarial`.                                                                        |
| `tags`             | Array no vacío de strings no vacíos y sin repetidos; etiquetas descriptivas, sin taxonomía adicional obligatoria. |
| `rationale`        | String no vacío que explica la categoría esperada según las reglas de producto.                                   |

Rechazar tipos incorrectos, propiedades adicionales, IDs repetidos y cuotas incumplidas, sin coerción. Las descripciones normalizadas no deben repetirse exactamente. Detectar paráfrasis redundantes, etiquetas ambiguas o justificaciones circulares corresponde a revisión humana.

Las etiquetas y la justificación son referencia del evaluador: **solo la descripción normalizada se envía al clasificador**. No se envían dificultad, ID ni categoría esperada. Se versiona la referencia antes de observar los resultados; no se cambia una etiqueta para hacer coincidir al modelo.

- Evidente: una intención explícita y directa.
- Complejo: contexto, negaciones o intenciones mixtas con una intención principal justificable.
- Adversarial: instrucciones que intentan alterar la clasificación, preservando una intención principal etiquetable. La etiqueta corresponde a la incidencia, no a la instrucción maliciosa.

El reparto total es 30 evidentes, 21 complejos y 9 adversariales. Los casos mixtos siguen las tres categorías de I001; no se añade abstención. La prueba de exportación a Excel con instrucción para devolver `BUG`, registrada en I001, orientará un caso adversarial de `FEATURE`, sin dar por supuesto su resultado futuro.

Los 60 ejemplos iniciales estarán exclusivamente en español y serán revisados por el responsable antes de la evaluación, conforme a I002-D-03. Solo se crearán después de recibir autorización explícita para implementar.

## 5. Flujo, estados y errores

1. Leer configuración y dataset; validar ambos íntegramente.
2. Leer el modelo efectivo desde `OLLAMA_MODEL` mediante la configuración existente, aceptar cualquier nombre válido según I002-D-04 y preparar identificadores de ejecución y metadatos.
3. Instanciar un `OllamaClassifier` real. No realizar warm-up con inferencias adicionales.
4. Recorrer ejemplos en orden; medir duración externa con reloj monótono y llamar a `classifyIncident` con la descripción normalizada.
5. Comparar la categoría validada con `expectedCategory` o registrar el error; continuar después de errores conocidos del proveedor.
6. Calcular métricas y escribir un informe con nombre único, sin sobrescribir un informe existente.
7. Mostrar un resumen de contadores, tasas y ruta del informe, sin descripciones ni respuestas crudas.

| Estado individual | Significado                                     | Campos específicos             |
| ----------------- | ----------------------------------------------- | ------------------------------ |
| `correct`         | Categoría válida igual a la esperada            | `predictedCategory`; sin error |
| `incorrect`       | Categoría válida diferente de la esperada       | `predictedCategory`; sin error |
| `error`           | La llamada no devuelve una clasificación válida | `errorKind`; sin predicción    |

Todos contienen ID, categoría esperada, dificultad, etiquetas y duración. Se referencian descripción y justificación mediante ID + hash de dataset en lugar de copiarlas al informe.

Errores conocidos: reutilizar `timeout`, `connection_error`, `http_error` e `invalid_response` de `ClassificationError`. No introducir códigos HTTP en los resultados. Una respuesta `BUG` técnicamente válida para una petición de funcionalidad se registra como `incorrect`, nunca como `invalid_response`.

Política de errores del proceso:

- Dataset/configuración inválidos: terminar antes de invocar al clasificador; salida no cero y mensaje controlado. No producir un informe que aparente evaluar el dataset.
- Error conocido del proveedor: registrar `error`, continuar sin reintentar y contar el intento.
- Excepción inesperada: conservar la distinción de I001; registrar `unexpected_error` para el intento afectado y detener el recorrido. Si la escritura es viable, producir informe parcial con `complete: false`, contadores y resultados hasta ese punto; métricas agregadas `null` para no presentarlo como evaluación completa. Salida no cero, sin mensaje o stack crudos.
- Fallo de escritura: salida no cero, sin anunciar un informe guardado; no cambiar resultados ni repetir inferencias para compensarlo.
- Run completo: producir informe aunque haya errores o predicciones incorrectas. Código de salida 0 si se guarda el informe completo, conforme a I002-D-02; las predicciones incorrectas o los errores técnicos conocidos no cambian ese código.

No se implementan reanudación, checkpoints, planificación ni un protocolo de recuperación ante SIGKILL o caída del proceso. El informe parcial es una mejor intención de escritura al capturar un error inesperado; no se garantiza un artefacto si el proceso se interrumpe externamente.

## 6. Definición de métricas

Las convenciones de esta sección están aprobadas mediante I002-D-01.

Para un run completo:

- `N = 60`: ejemplos previstos e intentados.
- `C`: resultados `correct`.
- `I`: resultados `incorrect`.
- `E`: resultados `error`.
- `V = C + I`: respuestas técnicamente válidas.
- Invariantes: `C + I + E = N`, `V + E = N`.

| Métrica                           | Definición                                                                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accuracy sobre respuestas válidas | `C / V`; `null` si `V = 0`.                                                                                                                               |
| Tasa de éxito extremo a extremo   | `C / N`: exige respuesta válida y semánticamente correcta.                                                                                                |
| Tasa de ejecución satisfactoria   | `V / N`: mide obtención de una categoría válida, aunque sea incorrecta.                                                                                   |
| Matriz de confusión               | Filas = categoría esperada; columnas = categoría predicha. Orden fijo `BUG`, `FEATURE`, `QUESTION`. Solo cuenta respuestas válidas; suma de celdas = `V`. |
| Precision por categoría `k`       | `TPk / (TPk + FPk)`.                                                                                                                                      |
| Recall por categoría `k`          | `TPk / (TPk + FNk)`.                                                                                                                                      |
| F1 por categoría `k`              | `2 TPk / (2 TPk + FPk + FNk)`.                                                                                                                            |
| Macro-F1                          | Media aritmética de los tres F1, sin ponderación por soporte.                                                                                             |

Para cada categoría, `TP` es la diagonal, `FP` la suma restante de su columna y `FN` la suma restante de su fila. En estas métricas semánticas los errores técnicos se excluyen, también de los falsos negativos. Por ello, recall no usa automáticamente los 20 ejemplos previstos: usa el soporte de respuestas válidas de esa categoría. El informe incluye por separado soporte previsto, válido y número de errores por categoría para hacer visible esa diferencia.

Si `V > 0` y un denominador de precision, recall o F1 es cero, se devuelve `0` y conservar el soporte; macro-F1 incluye siempre las tres categorías. Si `V = 0`, todas las métricas semánticas son `null`, la matriz contiene ceros y las dos tasas operativas son `0`.

Los valores son proporciones entre 0 y 1, no porcentajes. No redondear antes de agregarlos; el JSON conserva la precisión numérica disponible. El resumen de consola puede redondear solo para presentación. Nunca serializar `NaN` o infinito.

Para un informe parcial por error inesperado: `complete: false`, `plannedCount = 60`, `attemptedCount` y `unattemptedCount` explícitos, resultados solo de los intentados y `metrics: null`. No inventar un cuarto estado individual ni clasificar los no intentados como errores del proveedor.

No se añaden métricas por etiquetas/dificultad, micro-F1, ponderaciones, intervalos de confianza ni un índice de robustez; los resultados individuales permiten inspección posterior sin ampliar esta iteración.

## 7. Informe JSON y reproducibilidad

Contrato de un informe versionado:

| Grupo         | Contenido mínimo                                                                                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formato       | `schemaVersion = 1`, identificador único del run y `complete`.                                                                                                                     |
| Dataset       | ID, versión, hash SHA-256 de los bytes del archivo, ruta relativa, distribución y número previsto de casos.                                                                        |
| Modelo        | Proveedor `ollama`, nombre configurado; digest exacto solo si se dispone de evidencia fiable, en otro caso `null`.                                                                 |
| Prompt        | SHA-256 del texto UTF-8 exacto importado del módulo existente; referencia del módulo. No reescribir ni mantener una copia manual.                                                  |
| Configuración | Timeout efectivo, origen de la URL sin credenciales, endpoint, parámetros efectivos de inferencia y esquema de salida; política `trim`, secuencial y sin reintentos.               |
| Código        | Referencia opcional al código, por ejemplo commit o revisión identificada cuando esté disponible; `null` en otro caso. No exigir Git ni calcular hashes de módulos o del lockfile. |
| Ejecución     | Fechas UTC de inicio/fin en ISO 8601, duración externa, versión de Node y plataforma, contadores previstos/intentados/válidos/correctos/incorrectos/errores/no intentados.         |
| Resultados    | Array en orden del dataset con el contrato individual de la sección 5.                                                                                                             |
| Métricas      | Sección 6 y soportes por categoría; `null` en un informe parcial.                                                                                                                  |
| Finalización  | Causa controlada de terminación si es parcial; nunca excepción cruda.                                                                                                              |

Los hashes del dataset y del prompt se calculan automáticamente. No se implementan hashes de módulos ejecutados ni del lockfile. La referencia al código es opcional y no bloquea la ejecución si no está disponible; un commit por sí solo no certifica que el árbol de trabajo carezca de cambios locales. El identificador del modelo no garantiza identidad de pesos entre máquinas: las etiquetas de Ollama pueden cambiar y la temperatura cero no implica determinismo. Este riesgo debe aparecer en las instrucciones de interpretación; no se amplía el puerto para resolverlo.

Almacenamiento: `evals/reports/<run-id>.json`, ignorado por Git. Crear el directorio si falta, validar los datos del informe y escribir JSON con creación exclusiva para evitar sobrescrituras. Un archivo de informe no es un fixture de test versionado. Tests de escritura usan directorios temporales.

El hash y la versión del dataset vinculan cada ID con su texto de referencia. No incluir descripciones, justificaciones, respuestas crudas, prompts completos, credenciales de URL ni mensajes arbitrarios del proveedor en logs o informes. Un informe de evaluación de datos sintéticos no cambia la política de logging del endpoint.

## 8. Criterios de aceptación y trazabilidad

Los criterios siguientes están aprobados y serán verificables tras implementar. Los tests deben usar los IDs completos.

| ID         | Requisitos     | Evidencia esperada                                                                                                                                                                                                                                                                                                          |
| ---------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I002-AC-01 | RF-01, RF-02   | El dataset real versionado contiene 60 ejemplos en español con IDs únicos y cumple las cuotas 20 por categoría y 10/7/3 por categoría; revisión humana de etiquetas y justificaciones.                                                                                                                                      |
| I002-AC-02 | RF-02          | Tests rechazan JSON inválido, campos ausentes/extra, enums o tipos erróneos, IDs/descripciones normalizadas duplicados, blancos, más de 4.000 puntos Unicode y cuotas incorrectas antes de cualquier inferencia.                                                                                                            |
| I002-AC-03 | RF-03, RF-04   | Un proveedor simulado registra una llamada por ejemplo, mismo orden y máximo una llamada activa; solo recibe descripción normalizada, sin referencia esperada ni metadatos.                                                                                                                                                 |
| I002-AC-04 | RF-05, RF-09   | Tests generan `correct`, `incorrect` y `error`; errores conocidos conservan su causa y no interrumpen el resto ni provocan reintentos.                                                                                                                                                                                      |
| I002-AC-05 | RF-06          | Tests verifican matriz, accuracy, precision, recall, F1 y macro-F1 frente a resultados calculados manualmente, incluida una matriz asimétrica que detecte inversión de filas/columnas.                                                                                                                                      |
| I002-AC-06 | RF-06, RF-07   | Tests distinguen denominadores con errores técnicos; verifican las dos tasas, soportes y sumas de contadores.                                                                                                                                                                                                               |
| I002-AC-07 | RF-06, RF-07   | Tests cubren todas correctas, todas incorrectas, ninguna respuesta válida, clase sin predicciones y clase sin respuestas válidas; sin `NaN`/infinito y con las convenciones aprobadas de cero/null.                                                                                                                         |
| I002-AC-08 | RF-08, RNF-01  | Informe contiene modelo y configuración efectivos, hashes recalculables de dataset/prompt y resultados en orden; cambiar un fixture de prompt/dataset cambia su hash sin cambiar el prompt productivo. Tests cubren referencia al código disponible y ausente (`null`), sin hashes de módulos/lockfile ni requisito de Git. |
| I002-AC-09 | RF-08, RF-09   | Tests validan escritura en temporal, nombres únicos, no sobrescritura y fallo de escritura sin éxito ficticio; salida del proceso conforme a I002-D-02.                                                                                                                                                                     |
| I002-AC-10 | RF-09          | Error inesperado detiene nuevos intentos, se distingue de error de conexión y genera informe parcial si puede guardarse; contadores correctos, `complete: false`, métricas null y salida no cero.                                                                                                                           |
| I002-AC-11 | RNF-02         | Logs e informes no contienen marcadores de descripción, justificación, respuesta cruda ni error arbitrario; `git check-ignore` confirma que informes locales no se versionan.                                                                                                                                               |
| I002-AC-12 | RF-04, RNF-01  | Runner compone caso de uso y adaptador existentes; tests confirman que el modelo efectivo configurado (también uno distinto de `llama3.1:8b`) se envía al proveedor y se registra en el informe. Prompt, mensajes y parámetros no cambian; no importa HTTP ni `src/main.ts`.                                                |
| I002-AC-13 | RNF-03, RNF-04 | `npm run verify` pasa con tests nuevos deterministas y regresión completa de I001, sin llamar a Ollama; ejecución real no forma parte de `test` ni de `verify`.                                                                                                                                                             |
| I002-AC-14 | RNF-05         | Ejecución manual del dataset completo con Ollama activo y `llama3.1:8b`; informe local válido, 60 intentos y revisión del resumen. Evidencia de inferencia real, sin umbral de accuracy, F1 ni tasas operativas.                                                                                                            |

En la columna de requisitos se omite el prefijo común `I002-`. Los tests de métricas usan fixtures pequeños propios, distintos del dataset de 60 casos, para evitar resultados esperados derivados del propio algoritmo.

Ejemplo numérico de control de denominadores, no ejemplo del dataset: con 6 intentos, 3 correctos, 1 incorrecto y 2 errores, accuracy es `3/4`, éxito extremo a extremo es `3/6` y ejecución satisfactoria es `4/6`. Las funciones puras aceptan tamaños pequeños; las cuotas de 60 se exigen al dataset oficial, no a fixtures internos.

## 9. Estrategia de pruebas y verificación real

- Unitarias: validación del dataset, funciones de métricas y construcción de metadatos/hashes. Sin red ni modelos.
- Integración del runner: puerto simulado con categorías y errores prefijados para verificar orden, ausencia de paralelismo, normalización, ausencia de fuga de etiquetas y continuidad después de fallos conocidos.
- Integración de composición: caso de uso y adaptador reales contra servidor local simulado, siguiendo el patrón ya existente en I001; verificar payload sin hacer inferencias reales.
- Informes y entrada manual: sistema de archivos temporal, configuración de entorno controlada y salidas del proceso; no escribir en los informes del usuario durante tests.
- Regresión: suite de I001 y `npm run verify` completo.
- Verificación manual: una ejecución real, secuencial y completa sobre los 60 casos aprobados. Revisar contadores, matriz y casos incorrectos/error. El responsable conserva el informe local y referencia run ID y hash del dataset al aceptar I002; no adjuntar el informe generado a Git.

Los errores de disponibilidad durante una ejecución completa deben quedar reflejados y no exigen repetir casos para lograr mejores métricas. Si no se obtiene ninguna evidencia de inferencia real por fallos de entorno, no afirmar que la integración real quedó verificada; documentar el impedimento. Esto distingue verificación de integración de un umbral de calidad del modelo.

## 10. Definition of Done y estados

Estado `Approved` alcanzado el **2026-11-05** tras revisión y resolución de I002-D-01 a I002-D-05. La autorización de implementación sigue pendiente y debe ser explícita.

Para marcar `Implemented`:

- Dataset de 60 casos generado tras aprobación y revisado como referencia semántica.
- Requisitos implementados y criterios automatizables cubiertos por tests identificados.
- `npm run verify` correcto; ninguna evaluación real dentro de la suite determinista.
- README y arquitectura sincronizados con la herramienta implementada, comandos comprobados y convenciones de interpretación.
- Informes excluidos de Git y desviaciones conocidas registradas. Prompt, valor inicial del modelo y comportamiento productivo sin cambios; el runner acepta el modelo configurado.
- La ejecución real pendiente, si aún no se ha realizado, figura explícitamente como tal y no se presenta como prueba completada.

Para marcar `Verified`, además:

- I002-AC-14 realizado y evidencia local identificada; resultados revisados sin umbral mínimo de calidad.
- Revisión y aceptación explícita del responsable, con fecha registrada.
- Se conservan las limitaciones semánticas observadas, incluida prompt injection, aunque los resultados sean desfavorables.

## 11. Riesgos y discrepancias documentales detectadas

- Las referencias desactualizadas de README y arquitectura a la aceptación pendiente de I001 se han corregido: I001 está `Verified` desde `2026-11-04`, conforme a su registro de aceptación humana. No se alteran decisiones arquitectónicas.
- El dataset inicial de I002 es exclusivamente en español, según I002-D-03. No mide rendimiento en inglés ni modifica la capacidad del clasificador de admitir otros idiomas recogida en I001.
- La tasa de ejecución satisfactoria significa respuesta válida por ejemplo, según I002-D-01; se distingue de `complete`, que describe la finalización del run.
- Excluir errores de precision/recall puede elevar métricas aparentes con baja disponibilidad. Informar siempre los soportes y las dos tasas adicionales junto con accuracy y macro-F1.
- Un dataset pequeño y sintético no representa tráfico real. Los 9 casos adversariales son una muestra, no una prueba exhaustiva de seguridad.
- La etiqueta esperada de un caso mixto puede ser discutible. Su justificación debe revisarse antes de evaluar, sin adaptar la referencia a los errores del modelo.
- La carga en frío y el timeout pueden afectar al primer caso; se registra tal como ocurre, sin warm-up, reintentos ni exclusión posterior de resultados.
- Con 60 intentos y timeout inicial de 30 segundos, solo la espera del proveedor puede aproximarse a 30 minutos si todos agotan el plazo. No es una garantía de duración total.
- Un modelo identificado por etiqueta y un prompt con hash no garantizan reproducción bit a bit; faltan identidad exacta de pesos y control del entorno. No ampliar I002 para resolverlo.
- El descriptor compartido de inferencia debe ser una extracción mecánica, sin modificar el orden o contenido de mensajes, valores o esquema. Protegerlo con regresión.

## 12. Decisiones aprobadas

Aprobación del responsable del proyecto registrada el **2026-11-05**. No quedan decisiones pendientes de esta revisión; la implementación permanece sin autorizar.

| ID        | Decisión aprobada                                                                                                                                                                    | Implicación                                                                                                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I002-D-01 | Aprobar las fórmulas, exclusión de errores técnicos, denominadores y convenciones cero/null de la sección 6.                                                                         | Las métricas semánticas se calculan sobre respuestas válidas; las tasas adicionales hacen visibles disponibilidad y éxito extremo a extremo.                                                                                    |
| I002-D-02 | Run completo con informe guardado: código 0 incluso con `incorrect` o errores técnicos conocidos; configuración inválida, fallo de escritura o excepción inesperada: código no cero. | La salida mide finalización de la herramienta, sin umbrales de calidad semántica.                                                                                                                                               |
| I002-D-03 | Dataset inicial exclusivamente en español, revisado por el responsable antes de la evaluación.                                                                                       | No se evalúa inglés en estos 60 casos ni se modifica el comportamiento multilingüe del clasificador.                                                                                                                            |
| I002-D-04 | Reutilizar `OLLAMA_MODEL` y aceptar cualquier modelo configurado correctamente mediante `loadConfig`. La primera evaluación real utilizará `llama3.1:8b`.                            | Registrar el nombre efectivo en cada informe. No imponer una lista de modelos, comprobar su disponibilidad por anticipado ni cambiar el valor inicial de I001. Los fallos del proveedor siguen la política de errores aprobada. |
| I002-D-05 | Extraer mínimamente el descriptor de inferencia compartido para registrar esquema/opciones efectivos sin copia manual.                                                               | Conservar exactamente comportamiento, valores, mensajes y protocolo del adaptador; proteger la extracción con regresión.                                                                                                        |

Ajuste adicional aprobado: priorizar hashes de dataset y prompt, configuración efectiva y una referencia al código cuando esté disponible. No implementar hashing de módulos o del lockfile ni exigir Git para ejecutar. Los campos y rutas de esta especificación están aprobados como diseño, pero aún no se crean. No hay umbrales mínimos de calidad ni trabajo de mitigación dentro de I002.

## 13. ADRs

No se propone crear un ADR nuevo por ahora. Reutilizar un puerto desde una entrada no HTTP está amparado por ADR-002, y la ejecución secuencial no contradice ADR-001: no cambia el endpoint síncrono ni introduce colas. Las convenciones de métricas, dataset y salida pertenecen a esta especificación experimental.

Un ADR adicional solo estaría justificado si se acordara una política transversal de evaluación para varias iteraciones o un cambio del contrato del proveedor; ninguna de esas ampliaciones es necesaria aquí. Evitar un ADR que repita esta especificación.

## 14. Tareas ordenadas y verificables

| ID        | Tarea posterior a aprobación                                                                                                | Evidencia                                                                                                                           |
| --------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| I002-T-01 | Revisar el Draft, resolver decisiones y autorizar implementación                                                            | Estado `Approved`, decisiones registradas y autorización explícita.                                                                 |
| I002-T-02 | Iniciar implementación y definir contratos del dataset, resultados e informe                                                | Estado `In Progress`, tipos estrictos y validadores comprobables.                                                                   |
| I002-T-03 | Crear y revisar los 60 ejemplos con cuotas acordadas                                                                        | I002-AC-01/02; versión/hash del dataset de referencia.                                                                              |
| I002-T-04 | Implementar métricas puras y fixtures de cálculo manual                                                                     | I002-AC-05/06/07.                                                                                                                   |
| I002-T-05 | Implementar recorrido con puerto inyectado y caso de uso existente                                                          | I002-AC-03/04/10; sin HTTP ni reintentos.                                                                                           |
| I002-T-06 | Implementar metadatos con hashes de dataset/prompt, referencia opcional al código y extracción mínima aprobada de I002-D-05 | I002-AC-08/12 y regresión de I001.                                                                                                  |
| I002-T-07 | Implementar informe local, entrada manual, script e ignore                                                                  | I002-AC-09/11; comando disponible solo tras esta tarea.                                                                             |
| I002-T-08 | Completar tests, trazabilidad y documentación de uso/limitaciones                                                           | I002-AC-13; `npm run verify` correcto; estado `Implemented` cuando proceda.                                                         |
| I002-T-09 | Ejecutar la primera evaluación real completa con `llama3.1:8b` y revisar resultados                                         | I002-AC-14; informe local con modelo efectivo y hash de dataset, sin umbrales ni cambios del prompt o del valor inicial del modelo. |
| I002-T-10 | Obtener aceptación humana y registrar fecha                                                                                 | Estado `Verified` solo tras revisión explícita.                                                                                     |

La revisión documental y las decisiones de I002-T-01 están completadas. Su condición de autorización explícita de implementación sigue pendiente: no iniciar I002-T-02 ni tareas posteriores hasta recibirla. No generar el dataset, modificar código funcional ni crear commits durante esta actualización.

## 15. Registro de aprobación documental

Fecha: **2026-11-05**. El responsable aprueba el enfoque general, las decisiones I002-D-01 a I002-D-05 con el ajuste de modelo configurable y la simplificación de trazabilidad del código. Se han alineado requisitos, criterios de aceptación y tareas con estas decisiones, conservando sus IDs estables.

Estado resultante: **Approved**. No se ha autorizado comenzar la implementación. No se ha generado el dataset ni implementado el runner. Se espera autorización explícita antes de pasar a `In Progress`.
