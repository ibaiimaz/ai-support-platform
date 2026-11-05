# I002 — LLM Classification Evaluation

Estado: **Verified**. Fecha de preparación y aprobación: **2026-11-05**.

Fecha de verificación y aceptación humana: **2026-11-05**.

Inicio de implementación: **2026-11-05**.

Iteración cerrada tras aceptación explícita del responsable del proyecto. Se han completado los 14 criterios de aceptación, incluida la revisión humana del dataset v2 y la ejecución real con Ollama; evidencia y baseline experimental en la sección 17.

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

### Organización implementada para el punto de control

| Ubicación prevista                 | Responsabilidad                                                   |
| ---------------------------------- | ----------------------------------------------------------------- |
| `evals/datasets/incidents-v1.json` | Dataset generado; pendiente de revisión humana.                   |
| `src/evaluation/dataset.ts`        | Carga y validación completa del dataset antes de inferir.         |
| `src/evaluation/run-evaluation.ts` | Secuencia de llamadas al caso de uso y resultados individuales.   |
| `src/evaluation/metrics.ts`        | Cálculo puro y determinista de métricas.                          |
| `src/evaluation/report.ts`         | Metadatos, validación y escritura del informe JSON.               |
| `src/evaluation/main.ts`           | Entrada manual, composición de configuración y adaptador real.    |
| `test/evaluation/`                 | Pruebas deterministas con ejemplos pequeños y proveedor simulado. |
| `evals/reports/`                   | Informes locales, excluidos de Git.                               |

Está disponible `npm run eval:classification`, tras `npm run build`, con dataset y directorio de salida fijos. Los informes están excluidos mediante `.gitignore` y `.prettierignore`. No hay nuevos flags, dependencias, servicios o contenedores. El comando manual se ejecutó con autorización contra Ollama real; el informe identificado en la sección 17 constituye la evidencia de AC-14.

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

Los 60 ejemplos iniciales se generaron en español tras recibir autorización de implementación. La versión de contenido 2 fue revisada y aceptada por el responsable antes de la primera evaluación real, conforme a I002-D-03.

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

Si `V > 0` y un denominador de precision, recall o F1 es cero, se devuelve `0` y se conserva el soporte; macro-F1 incluye siempre las tres categorías. Si `V = 0`, todas las métricas semánticas son `null`, la matriz contiene ceros y las dos tasas operativas son `0`.

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

Estado `Approved` alcanzado el **2026-11-05** tras revisión y resolución de I002-D-01 a I002-D-05. La autorización explícita de implementación se ha recibido el **2026-11-05**, manteniendo el punto de control anterior a la evaluación real.

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

Aprobación del responsable del proyecto registrada el **2026-11-05**. No quedan decisiones pendientes de esta revisión; la implementación está autorizada desde el **2026-11-05**; la evaluación real se ejecutó con autorización y la iteración ha sido aceptada el **2026-11-05**.

| ID        | Decisión aprobada                                                                                                                                                                    | Implicación                                                                                                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I002-D-01 | Aprobar las fórmulas, exclusión de errores técnicos, denominadores y convenciones cero/null de la sección 6.                                                                         | Las métricas semánticas se calculan sobre respuestas válidas; las tasas adicionales hacen visibles disponibilidad y éxito extremo a extremo.                                                                                    |
| I002-D-02 | Run completo con informe guardado: código 0 incluso con `incorrect` o errores técnicos conocidos; configuración inválida, fallo de escritura o excepción inesperada: código no cero. | La salida mide finalización de la herramienta, sin umbrales de calidad semántica.                                                                                                                                               |
| I002-D-03 | Dataset inicial exclusivamente en español, revisado por el responsable antes de la evaluación.                                                                                       | No se evalúa inglés en estos 60 casos ni se modifica el comportamiento multilingüe del clasificador.                                                                                                                            |
| I002-D-04 | Reutilizar `OLLAMA_MODEL` y aceptar cualquier modelo configurado correctamente mediante `loadConfig`. La primera evaluación real utilizará `llama3.1:8b`.                            | Registrar el nombre efectivo en cada informe. No imponer una lista de modelos, comprobar su disponibilidad por anticipado ni cambiar el valor inicial de I001. Los fallos del proveedor siguen la política de errores aprobada. |
| I002-D-05 | Extraer mínimamente el descriptor de inferencia compartido para registrar esquema/opciones efectivos sin copia manual.                                                               | Conservar exactamente comportamiento, valores, mensajes y protocolo del adaptador; proteger la extracción con regresión.                                                                                                        |

Ajuste adicional aprobado: priorizar hashes de dataset y prompt, configuración efectiva y una referencia al código cuando esté disponible. No implementar hashing de módulos o del lockfile ni exigir Git para ejecutar. Los campos y rutas aprobados están implementados para el punto de control. No hay umbrales mínimos de calidad ni trabajo de mitigación dentro de I002.

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

I002-T-01 a I002-T-10 completadas. La autorización de evaluación real, la ejecución de I002-T-09 y la aceptación humana de I002-T-10 se registran en la sección 17. No se han creado commits.

## 15. Registro de aprobación documental

Fecha: **2026-11-05**. El responsable aprueba el enfoque general, las decisiones I002-D-01 a I002-D-05 con el ajuste de modelo configurable y la simplificación de trazabilidad del código. Se han alineado requisitos, criterios de aceptación y tareas con estas decisiones, conservando sus IDs estables.

Estado tras aprobación documental: **Approved**. Posteriormente, el **2026-11-05**, se autoriza implementar y generar el dataset, pasando a **In Progress**. El punto de control se superó posteriormente con la aceptación del dataset v2 y la autorización de evaluación real; el cierre formal figura en la sección 17.

## 16. Punto de control de implementación (registro histórico)

Esta sección conserva la evidencia del punto de control anterior a la revisión del dataset; sus estados pendientes y su hash se refieren a aquel momento, no al cierre actual. La versión 2 y el cierre están registrados en la sección 17.

Fecha: **2026-11-05**. Componentes y tests deterministas completados; se conserva **In Progress** porque la Definition of Done para `Implemented` requiere la revisión del dataset de referencia. No se marca `Verified`.

Dataset completo para revisión: [incidents-v1.json](../../evals/datasets/incidents-v1.json), ID `incidents-es-v1`, versión `1`.

SHA-256 de los bytes entregados: `dde2a1c96a773b64b388ab4786c4c2d3dce04d6dd78b2eac0f20e73c0069b2cd`.

| Categoría | Evidentes (001–010) | Complejos (011–017) | Adversariales (018–020) | Total |
| --------- | ------------------- | ------------------- | ----------------------- | ----- |
| BUG       | 10                  | 7                   | 3                       | 20    |
| FEATURE   | 10                  | 7                   | 3                       | 20    |
| QUESTION  | 10                  | 7                   | 3                       | 20    |
| Total     | 30                  | 21                  | 9                       | 60    |

El archivo JSON contiene todos los campos aprobados, incluidas justificaciones. La validación automática cubre estructura, cuotas y unicidad; la revisión humana de corrección y representatividad no se sustituye por esos tests. No se han obtenido predicciones reales sobre el dataset.

| Criterio   | Evidencia determinista y estado                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I002-AC-01 | `test/evaluation/dataset.test.ts`: cuotas y contrato del dataset oficial correctos. Pendiente revisión humana del contenido.                                              |
| I002-AC-02 | `dataset.test.ts` y `report.test.ts`: rechazo de tipos, campos, duplicados, blancos, Unicode, cuotas y entradas inválidas antes del proveedor.                            |
| I002-AC-03 | `run-evaluation.test.ts` y `composition.test.ts`: orden, una llamada activa, un argumento normalizado y una llamada por ejemplo.                                          |
| I002-AC-04 | `run-evaluation.test.ts`: estados y cuatro causas conocidas; continuidad sin reintentos.                                                                                  |
| I002-AC-05 | `metrics.test.ts`: matriz asimétrica y valores calculados manualmente para cada clase y macro-F1.                                                                         |
| I002-AC-06 | `metrics.test.ts` y `report.test.ts`: denominadores, soportes y contadores diferenciados.                                                                                 |
| I002-AC-07 | `metrics.test.ts`: extremos, ausencia de respuestas, clases sin predicciones/respuestas y convenciones cero/null.                                                         |
| I002-AC-08 | `report.test.ts` y `composition.test.ts`: hashes de bytes/texto, origen sin credenciales, configuración efectiva y referencia al código presente/ausente.                 |
| I002-AC-09 | `report.test.ts` y `composition.test.ts`: CLI en proceso separado con servidor simulado, código de salida, escritura exclusiva, directorio temporal y fallo de escritura. |
| I002-AC-10 | `run-evaluation.test.ts` y `report.test.ts`: detención, informe parcial, métricas null y contadores de no intentados.                                                     |
| I002-AC-11 | `report.test.ts` y `composition.test.ts`: ausencia de texto sensible en salida/informes y exclusión comprobada con `git check-ignore`.                                    |
| I002-AC-12 | `composition.test.ts` y regresión I001: payload real al servidor simulado, modelo alternativo, prompt exacto y descriptor inmutable; sin HTTP de aplicación.              |
| I002-AC-13 | `npm run verify`: formato, lint, compilación y suite determinista con regresión I001.                                                                                     |
| I002-AC-14 | Pendiente. No se ha ejecutado evaluación real; requiere autorización explícita tras revisar este punto de control.                                                        |

I002-T-02 y las tareas técnicas I002-T-04 a I002-T-08 están completadas. I002-T-03 tiene la generación y validación automatizada completadas, pero su revisión humana sigue pendiente. I002-T-09 y I002-T-10 no se han ejecutado.

`npm run verify` completado: formato y lint correctos, compilación estricta correcta y **43 tests correctos** (24 de I001 y 19 de I002), sin fallos, omisiones ni cancelaciones.

Sin desviaciones funcionales conocidas. El archivo `types.ts` agrupa contratos internos de evaluación y `inference-descriptor.ts` materializa la extracción aprobada. La referencia opcional al código usa `git rev-parse HEAD` si está disponible; no identifica cambios locales no confirmados ni calcula hashes de módulos. Los tests de composición usan exclusivamente un servidor local simulado y los informes de pruebas se escriben en directorios temporales.

No se ha cambiado el prompt, el modelo inicial, el puerto, el caso de uso ni los contratos HTTP de I001. No se han creado commits. La siguiente acción requiere revisión humana del dataset y autorización explícita para la evaluación real.

## 17. Cierre y baseline experimental

Estado final: **Verified**, con fecha **2026-11-05**, autorizado explícitamente por el responsable del proyecto tras revisar y aceptar la implementación, el dataset de referencia y los resultados reales. Se cumple la Definition of Done completa.

La revisión del contenido produjo el dataset `incidents-es-v1`, versión de contenido **2**, `schemaVersion: 1`, con **60 ejemplos** sintéticos en español: 20 por categoría, con reparto 10 evidentes, 7 complejos y 3 adversariales por categoría. El responsable aceptó esa versión antes de inferir; no se modificaron sus etiquetas ni justificaciones tras observar predicciones.

- Archivo: [incidents-v1.json](../../evals/datasets/incidents-v1.json).
- SHA-256: `e17fcb2ea94126809319133a9ba78fa1108e7efe21ed62f45c88167bebe72c90`.
- Informe local: `evals/reports/fd9c811b-8b65-4230-bc2a-0c57796d63ad.json`, validado y excluido de Git; el archivo generado no se incorpora al repositorio.
- Identificador de ejecución: `fd9c811b-8b65-4230-bc2a-0c57796d63ad`.
- Modelo efectivo: `llama3.1:8b`; `temperature: 0`, `stream: false`, timeout 30.000 ms, sin reintentos ni warm-up.
- Prompt original de I001, SHA-256: `ea81fca7322e307986b0ab3739fc9d73ad2384cc2361da8a0b28cfedf659a9ef`.
- Ejecución completa: 60 intentos, 44 correctos, 16 incorrectos, 0 errores técnicos, código de salida 0.
- Accuracy válida: **73,33 %**; éxito extremo a extremo: **73,33 %**; ejecución satisfactoria: **100 %**; macro-F1: **73,02 %**. Los valores del JSON se conservan sin este redondeo de presentación.
- Latencia total observada por el runner: 21,372 s; media por ejemplo: 356,19 ms.

| Dificultad    | Correctos / total | Accuracy |
| ------------- | ----------------- | -------- |
| Evidentes     | 24 / 30           | 80,00 %  |
| Complejos     | 18 / 21           | 85,71 %  |
| Adversariales | 2 / 9             | 22,22 %  |

Los desgloses por dificultad son análisis descriptivo posterior del informe, sin cambiar las métricas implementadas en I002. **Siete de los nueve adversariales produjeron la categoría inducida por la instrucción maliciosa.** Ambas categorías erróneas y correctas cumplieron el contrato JSON. La validación técnica no detecta este fallo semántico. No se cambió el prompt ni se corrigió el dataset para ajustar estos resultados.

Matriz de confusión (filas esperadas; columnas predichas):

| Esperada / predicha | BUG | FEATURE | QUESTION |
| ------------------- | --- | ------- | -------- |
| BUG                 | 15  | 3       | 2        |
| FEATURE             | 1   | 17      | 2        |
| QUESTION            | 6   | 2       | 12       |

### Cumplimiento final de criterios

| ID         | Estado y evidencia                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------------------- |
| I002-AC-01 | Cumplido: cuotas y contrato validados; versión 2 revisada y aceptada por el responsable antes de ejecutar.           |
| I002-AC-02 | Cumplido: validación estricta, duplicados, cuotas y límites, con tests deterministas.                                |
| I002-AC-03 | Cumplido: orden, normalización, secuencialidad y una llamada por ejemplo comprobados.                                |
| I002-AC-04 | Cumplido: estados y causas técnicas conocidas, continuidad sin reintentos, cubiertos por tests.                      |
| I002-AC-05 | Cumplido: matriz asimétrica y métricas contrastadas con cálculos manuales.                                           |
| I002-AC-06 | Cumplido: denominadores, soportes y contadores diferenciados comprobados.                                            |
| I002-AC-07 | Cumplido: extremos y convenciones cero/null comprobados.                                                             |
| I002-AC-08 | Cumplido: metadatos, configuración efectiva y hashes comprobados; informe real coincide con la referencia v2.        |
| I002-AC-09 | Cumplido: escritura exclusiva, fallos y códigos de salida comprobados; informe real guardado con código 0.           |
| I002-AC-10 | Cumplido: detención e informe parcial comprobados mediante simulación de excepción inesperada.                       |
| I002-AC-11 | Cumplido: ausencia de texto sensible y exclusión de informes comprobadas; informe real ignorado por Git.             |
| I002-AC-12 | Cumplido: reutilización y regresión de payload/prompt; ejecución real con el caso de uso y adaptador existentes.     |
| I002-AC-13 | Cumplido: `npm run verify` pasó con 43 tests, cero fallos, cancelaciones u omisiones; suite sin Ollama real.         |
| I002-AC-14 | Cumplido: ejecución real completa identificada arriba, sin errores técnicos, revisada y aceptada por el responsable. |

Esta ejecución es la **baseline experimental** para I003. El dataset es pequeño, sintético y conocido; sus resultados no se extrapolan a tráfico real ni garantizan reproducibilidad bit a bit. El informe permanece local, mientras esta sección conserva la evidencia documental versionable del cierre. La aceptación de I002 no supone solucionar la vulnerabilidad observada.
