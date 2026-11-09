# I004 — Local Model Comparison

Estado: **Verified**. Cierre: **2026-11-09**, conforme a la autorización humana condicionada a AC-11 y AC-13. Inicio y finalización de implementación controlada: **2026-11-06**. Preparación y aprobación documental: **2026-11-06**. Aprobación: responsable del proyecto, mediante las decisiones registradas en la sección 14.

Ciclo: `Draft → Approved → In Progress → Implemented → Verified`. **Implementación autorizada el 2026-11-06; fases operativas completadas bajo permisos limitados posteriores. Presupuesto agotado y todas las inferencias desautorizadas actualmente.** La aprobación del diseño y de su presupuesto no habilita su consumo. Se requiere autorización explícita posterior para cada fase operativa. I003 permanece cerrado; sus 120 inferencias restantes no se reutilizan.

## 1. Objetivo, referencias y exclusiones

Comparar los **sistemas Ollama completos** `llama3.1:8b` (referencia) y `gemma3:12b` (candidato), incluidas sus plantillas nativas, para clasificar incidencias. Mantener prompt original, contrato JSON y benchmark congelado; observar diferencias de calidad, robustez, fiabilidad, latencia y memoria.

Fuentes de verdad: [AGENTS](../../AGENTS.md), [producto](../product.md), [arquitectura](../architecture.md), [I001](001-classification.md), [I002](002-classification-evals.md), [I003](003-prompt-robustness.md), [ADR-001](../adr/ADR-001-sync-classification.md) y [ADR-002](../adr/ADR-002-provider-abstraction.md).

I003 quedó `Verified` el 2026-11-06 con resultado negativo. Ningún candidato fue promovido y el original sigue en producción. I004 no modifica I003 ni sus evidencias. No se ejecuta validación independiente, no se promociona ningún modelo y no se crean nuevos prompts. El modelo productivo sigue siendo **`llama3.1:8b`**, con timeout productivo de **30000 ms** intacto. Sin H5, cambios de datasets, frameworks de evaluación, dependencias adicionales, dashboards, bases de datos, CI o paralelismo de inferencias. No commits automáticos.

## 2. Hipótesis, referencia histórica y unidad de comparación

| ID        | Hipótesis, sin garantía de resultado                                          |
| --------- | ----------------------------------------------------------------------------- |
| I004-H-01 | El sistema Gemma mejora la calidad global respecto al sistema Llama.          |
| I004-H-02 | Gemma mejora el reconocimiento de QUESTION.                                   |
| I004-H-03 | Gemma reduce errores adversariales o coincidencias con categorías inducidas.  |
| I004-H-04 | Las diferencias de calidad se acompañan de un coste computacional observable. |

| Baseline histórica I003 | Desarrollo                             | Validación                             |
| ----------------------- | -------------------------------------- | -------------------------------------- |
| Run                     | `e2ad3019-8fa4-4f06-ba7c-305ac6df0e99` | `13ce8414-02c3-4208-953c-4d819f898932` |
| Accuracy                | 44/60 (73,33 %)                        | 40/60 (66,67 %)                        |
| Macro-F1                | 73,02 %                                | 64,44 %                                |
| Legítimos correctos     | 42/51                                  | 39/51                                  |
| Adversariales correctos | 2/9                                    | 1/9                                    |
| Coincidencias inducidas | 7/9                                    | 8/9                                    |
| Recall QUESTION         | 12/20 (60 %)                           | 7/20 (35 %)                            |

Los informes históricos locales `evals/reports/<run>.json` se conservan sin sobrescribir. Son contexto, no controles primarios: I004 exige **dos ejecuciones nuevas de 60** para mejorar comparabilidad temporal. El timeout I004 es **45000 ms** para ambos sistemas, frente a 30000 ms en I003. Esta diferencia impide afirmar equivalencia estricta del protocolo histórico, incluso con mismo digest; también afectan versión de Ollama, cuantización, carga, residencia y condiciones temporales. No sustituir el control fresco por el histórico tras observar resultados.

La unidad de análisis es el par por ID del mismo benchmark entre los dos brazos contemporáneos, con sus estados y predicciones. No se seleccionan casos después de inferir. Se comparan sistemas completos: arquitectura, pesos, tokenizador, plantilla y parámetros heredados pueden diferir. No se atribuyen diferencias causalmente a capacidades intrínsecas de los pesos, al número de parámetros o a una jerarquía de instrucciones equivalente.

## 3. Compatibilidad y plantillas nativas

Revisión documental de preparación del 2026-11-06, sin comprobación local ni descargas:

- La [API oficial de chat](https://docs.ollama.com/api/chat) acepta mensajes con roles y `format` como esquema JSON; los [structured outputs](https://docs.ollama.com/capabilities/structured-outputs) restringen forma, no garantizan corrección semántica.
- La [ficha de gemma3:12b](https://ollama.com/library/gemma3:12b) consultada muestra uso por `/api/chat`, Q4_K_M, aproximadamente 8,2 GB almacenados y requisito de Ollama 0.6 o posterior. Son referencias del registro, no medidas de memoria o identidad de una instalación concreta.
- La [plantilla publicada de Gemma](https://ollama.com/library/gemma3:12b/blobs/e0a42594d802) representa `system` y `user` como turnos `user`. Conservar ambos roles en el payload no garantiza la misma jerarquía interna que otro modelo.

La diferencia de plantilla está **aceptada como parte del sistema comparado**. No es por sí sola incompatibilidad técnica. No adaptar instrucciones a Gemma, unir mensajes, crear un Modelfile o reescribir plantillas. Sí es bloqueo un rechazo real del payload/esquema, salida inválida o incumplimiento del timeout.

En preflight posteriormente autorizado se inspeccionarán `/api/show`, `/api/tags`, `/api/ps` y versión local: plantilla efectiva de ambos modelos, digest completo, cuantización, capacidades, parámetros heredados y contexto. No inferir la plantilla de Llama ni suponer que el registro web representa exactamente la instalación. No actualizar servidor o modelos entre brazos. Cambios respecto a la configuración congelada requieren revisión antes de continuar; nunca descargar variantes o ajustar parámetros para mejorar resultados.

## 4. Requisitos aprobados

| ID          | Requisito                                                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| I004-RF-01  | Evaluar fuera de HTTP con el caso de uso, puerto y adaptador existentes; seleccionar modelo únicamente en composición experimental.       |
| I004-RF-02  | Mantener exactos prompt original, dos mensajes, categorías, esquema, normalización y anotaciones; plantillas nativas sin modificaciones.  |
| I004-RF-03  | Comparar por ID, incluyendo correcciones, regresiones semánticas/operativas y casos con error, sin omisiones favorables.                  |
| I004-RF-04  | Calcular calidad global, por categoría/dificultad y bloques legítimo/adversarial con soportes, errores y denominadores.                   |
| I004-RF-05  | Medir latencias externas y memoria descriptiva con método, cobertura y límites; declarar ausencias explícitamente.                        |
| I004-RF-06  | Informes con modelo solicitado/efectivo, digest, prompt/dataset, configuración, entorno, permisos y presupuesto; escritura exclusiva.     |
| I004-RF-07  | Presupuesto propio máximo de 126 inferencias reales, permisos por fase/modelo, reservas previas y bloqueo de duplicados/reintentos.       |
| I004-RF-08  | Compatibilidad fail-fast; benchmark solo tras autorización específica y compatibilidad correcta en ambos sistemas.                        |
| I004-RNF-01 | Producción intacta, incluidas configuración, modelo y timeout de 30000 ms. Timeout de 45000 ms solo en I004, documentado respecto a I003. |
| I004-RNF-02 | Ejecución secuencial, temperature 0, sin reintentos o inferencias de warm-up; un único modelo residente durante cada evaluación.          |
| I004-RNF-03 | Sin infraestructura/dependencias innecesarias; tests node:test y node:assert/strict, sin Ollama; npm run verify y legibilidad de AGENTS.  |
| I004-RNF-04 | No guardar descripciones, justificaciones, prompt completo, respuestas crudas o secretos en logs/informes de ejecución.                   |
| I004-RNF-05 | Sin validación independiente, promoción o ajustes de prompting; presupuestos, permisos y evidencias I003/I004 separados.                  |

## 5. Entradas congeladas y protocolo

Benchmark exploratorio exclusivo: `evals/datasets/incidents-v1.json`, ID `incidents-es-v1`, contenido 2, esquema 1, SHA-256 `e17fcb2ea94126809319133a9ba78fa1108e7efe21ed62f45c88167bebe72c90`. Sus 60 ejemplos contienen 20 por categoría y 10 evidentes/7 complejos/3 adversariales por categoría. Conservar las nueve anotaciones de categoría inducida aprobadas en I003; el manifiesto I004 referencia sus valores y comprueba igualdad, sin cambiar I003.

Prompt original: SHA-256 UTF-8 `ea81fca7322e307986b0ab3739fc9d73ad2384cc2361da8a0b28cfedf659a9ef`. No usar H1/H2/H3/H4. No ejecutar ni utilizar validación I003 para ajustar sistemas.

### Compatibilidad

Tres casos sintéticos separados, independientes de los 60 del benchmark, uno por categoría; mismos casos en ambos modelos. Prepararlos y someterlos a revisión humana/congelación durante una implementación posteriormente autorizada; no se crean ahora ni se usan para diseñar prompts. Son una comprobación técnica, no una validación de calidad.

1. Preflight sin inferencias: permisos, modelos/digests, prompt/dataset, versión, configuración, presupuesto y condiciones de residencia. No descargar, generar peticiones vacías o precargar automáticamente.
2. Orden fijo: **tres casos Llama, después tres Gemma**. Una petición por caso; reservar 3 intentos antes de cada brazo. Registrar intentos realmente iniciados, no intentados y reservas conservadoras por separado.
3. Comprobar comunicación, dos mensajes y esquema sin cambios, sobre de chat conforme al adaptador, objeto JSON exclusivo con categoría permitida y respuesta dentro de **45 segundos**. Una categoría semánticamente incorrecta pero válida no es incompatibilidad.
4. Ante el primer timeout, conexión fallida, HTTP no satisfactorio o respuesta inválida, detener toda la fase inmediatamente; guardar evidencia y no intentar los casos o modelos restantes. Sin reintentos, redistribución del presupuesto o adaptaciones. Inesperados, incompatibilidad de configuración y fallos de escritura también detienen.
5. Se requieren **6/6 respuestas técnicamente válidas** para presentar compatibilidad satisfactoria y solicitar autorización separada del benchmark. No se activa automáticamente. El resultado semántico queda registrado sin constituir criterio de compatibilidad.

### Benchmark y residencia

Orden fijo: **Llama 60, después Gemma 60**, sobre los mismos IDs y orden. Modelo/digest y opciones se congelan antes; misma versión del servidor, equipo y método de observación. No intercalar peticiones ni ejecutar otros trabajos de inferencia en el servicio dedicado.

Sin inferencias adicionales de warm-up. Para evitar que compatibilidad caliente ocultamente el benchmark, antes de cada brazo detener la residencia de los modelos de prueba mediante el control operativo de Ollama, sin reiniciar servidor, modificar opciones o generar peticiones vacías de chat. Confirmar `/api/ps` sin otros modelos residentes antes de iniciar. Solo el modelo de ese brazo puede quedar residente durante su evaluación; registrar antes del brazo, tras el primer caso y tras cada caso, con digest y timestamps. Si aparece otro modelo residente, detener y conservar parcialidad, sin repetir. No expulsar procesos ajenos o afectar producción para lograr la condición: si el servicio no puede dedicarse al experimento, pedir revisión antes de inferir.

Esta preparación controla residencia de Ollama, no cachés del sistema ni arranque físico en frío. El primer caso medido incluye posible carga; registrar condiciones iniciales, su latencia y las 59 restantes por separado. No añadir keep_alive, semilla, num_ctx o parámetros de muestreo nuevos. Una expulsión automática se documenta; una consulta sin modelos residentes no demuestra por sí sola incompatibilidad, pero nunca permite otra carga deliberada o repetir casos. La verificación por instantáneas limita lo que se puede afirmar sobre intervalos no observados.

## 6. Métricas, memoria y límites de medición

Reutilizar las fórmulas de [I002](002-classification-evals.md) y las distinciones de [I003](003-prompt-robustness.md#8-métricas-pares-y-errores-técnicos): accuracy sobre válidas, precision/recall/F1 por clase, macro-F1, matriz con filas esperadas y columnas predichas, éxito extremo a extremo y ejecución satisfactoria; soportes previstos/válidos, errores por causa/clase y cero/null explícitos.

Pares por ID con estados correct/incorrect/error, predicción null ante error, transiciones, correcciones, pérdidas netas y regresiones semánticas/operativas. Revisar individualmente todas las regresiones legítimas, especialmente QUESTION. Mostrar conjunto completo y subconjunto válido en ambos, sin sustituir los resultados extremo a extremo por una intersección favorable.

Adversariales: correctos/9, incorrectos/9, errores/9 e inducidas/9, además de inducidas entre respuestas válidas con denominador. Una categoría errónea distinta de la inducida o un error técnico no son defensa exitosa. Coincidencia inducida no demuestra causalmente obediencia a instrucciones. No afirmar significación estadística o robustez general con nueve ataques.

### Latencia y carga inicial

Fuente: `EvaluationResult.durationMs`, reloj monotónico existente alrededor del caso de uso, incluyendo transporte, posible carga, parsing y validación. No es tiempo puro de inferencia. Conservar cada observación, incluidos errores/timeouts; informar media, mediana, p95, n y distribución de todos los intentos, válidos e intersección válida en ambos brazos. No asignar cero a errores ni excluirlos silenciosamente.

Mediana: central ordenado o media de los dos centrales. P95 nearest-rank: índice `ceil(0.95*n)-1` ascendente; con 60 observaciones, la 57. Con n=0, null. Informar primer caso y los 59 restantes con los mismos índices para ambos modelos, sin garantizar estado caliente. Tiempo total por brazo y experimento con UTC, intervalos de preparación/compatibilidad/benchmark y coste de observación identificado.

La [API de chat](https://docs.ollama.com/api/chat) documenta tiempos internos como load_duration y eval_duration, pero el adaptador actual los descarta. No modificar puerto/adaptador ni interceptar globalmente fetch para obtenerlos por conveniencia experimental. Registrar carga inicial mediante condiciones de residencia y primera petición; tiempos internos de carga/tokenización/generación quedan null con motivo `not_exposed_by_existing_adapter`. No presentar la latencia del primer caso como carga aislada ni inventar valores por resta.

### Memoria

Muestreo objetivo **cada 500 ms**, usando PID/PPID cuando sea viable, con herramientas del sistema sin dependencias adicionales ni argumentos de proceso que revelen textos o credenciales. El host de referencia es macOS local; registrar el método real, CPU/GPU, RAM física, OS y procesos atribuibles al servidor dedicado/runners. No vigilar procesos ajenos ni usar memoria del proceso Node como si fuera la de Ollama.

| Magnitud             | Método y límites                                                                                                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tamaño almacenado    | Bytes del artefacto local de `/api/tags`, digest y cuantización; no es RAM ni memoria residente o máxima.                                                                                                            |
| Residencia reportada | `/api/ps` antes y tras cada caso: size, size_vram, contexto/digest disponibles. Son estimaciones del proveedor, no RSS exclusivo del modelo.                                                                         |
| RSS observado        | Identificar servidor/runners por PID/PPID, actualizar descendientes, registrar KiB por proceso y convertir a bytes; sumar solo procesos atribuibles por muestra. Páginas compartidas pueden contarse varias veces.   |
| Máximo observado     | Máximo de muestras completas, con n/timestamps/PIDs y duración observada; no es pico real continuo. truePeakBytes null con motivo. No sumar size_vram y RSS como memoria total, especialmente con memoria unificada. |

Tomar muestra inicial/final y muestrear con cadencia objetivo de 500 ms durante el brazo; guardar tiempos reales, huecos, errores, muestras parciales y cambios de PID. No solapar muestras si una tarda más que la cadencia; registrar el intervalo perdido. Consultas `/api/ps` entre casos quedan fuera de la llamada medida; su coste puede aparecer en duración del brazo. El muestreo concurrente introduce posible efecto observador que se declara.

La cobertura se describe, no se convierte en una garantía de pico: timestamps, n, hueco máximo, intervalos sin datos y atribución completa/parcial/desconocida. Para comparar RSS se necesitan al menos dos muestras completas, inicio/fin documentados y procesos atribuibles sin omisiones conocidas; si no se puede defender una comparación fiable, marcarla no disponible, con motivos, sin inventar cero o un cociente válido. No se exige el umbral anterior de huecos ≤1500 ms ni un límite 1,75×: no fueron adoptados como puertas de aceptación.

Si el método no es viable en preflight, registrar la limitación y acordar si se procede con memoria no disponible antes de inferir. Si falla durante el brazo, registrar ausencia y continuar clasificación salvo riesgo operativo, escritura fallida o cambio del sistema; no repetir inferencias para mejorar cobertura. El informe distingue cumplimiento de la instrumentación/registro de disponibilidad real de una medida. La ausencia honesta y justificada de RSS fiable puede satisfacer AC-08; omitir el intento, inventar datos o afirmar comparabilidad sin cobertura no lo satisface. No diseñar un monitor genérico multiplataforma.

## 7. Interpretación aprobada, sin puertas de promoción

| Dimensión      | Interpretación                                                                                                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Calidad global | Ganancia neta `correctos Gemma − correctos Llama ≥5/60` es señal exploratoria relevante, no prueba estadística ni criterio suficiente.                                                       |
| Macro-F1       | Aumento ≥0,03 es señal complementaria **no obligatoria**. Mostrar valor y variación aunque no alcance el umbral.                                                                             |
| QUESTION       | Comparar recall, soportes válidos/previstos, aciertos extremo a extremo y regresiones individuales; sin mínimo de +0,10 o +2 aciertos obligatorio.                                           |
| Legítimos      | Describir aciertos/51, correcciones, pérdida neta, regresiones individuales y operativas; revisión humana, sin las anteriores puertas de máximo 1/51, dos pérdidas o caída F1 0,05.          |
| Robustez       | Comparación descriptiva de aciertos, errores e inducidas/9 y pares, sin mínimos +2/−1 ni significación estadística.                                                                          |
| Fiabilidad     | Comparar errores, respuestas inválidas y tasa de ejecución satisfactoria; no exigir 60/60 válidas en benchmark como condición de éxito experimental. La compatibilidad sí exige 6/6 válidas. |
| Coste          | Media/mediana/p95, carga inicial descriptiva, tiempo total y memoria con cobertura/límites; sin límites obligatorios de 2× p95 o 1,75× RSS.                                                  |

Los cinco aciertos son ganancia neta sobre **60 casos previstos**, incluidos errores como no aciertos, no cinco correcciones aisladas. Equivalen a +8,33 pp de éxito extremo a extremo; solo coinciden con diferencia de accuracy válida si ambos tienen 60 válidas. Informar correcciones/regresiones/errores para evitar que la ganancia neta oculte pérdidas individuales.

Los umbrales adicionales del Draft anterior no están aprobados ni se aplicarán silenciosamente. No se calcula elegibilidad mediante una conjunción de esas puertas. Ninguna mejora numérica, conjunta o aislada, autoriza promoción o cambio productivo; ambas acciones están excluidas. Un resultado negativo, mixto o inconcluso por memoria no disponible se conserva, sin relajar criterios o ampliar presupuesto tras observar predicciones. Calidad desfavorable no equivale a fallo técnico o incumplimiento automático de la iteración.

## 8. Diseño técnico y entrada manual

La arquitectura encaja: Config admite modelo/timeout, el adaptador conserva el prompt por defecto y el runner llama al caso de uso. No se cambia dominio, puerto, endpoint, prompt o defaults productivos.

| Componente existente                                              | Uso previsto                                                                                                                                                                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| dataset.ts, types.ts, metrics.ts, analysis.ts                     | Reutilizar validación, estados, métricas, desgloses y anotaciones sin duplicar fórmulas.                                                                                                                                 |
| run-evaluation.ts, classifyIncident, OllamaClassifier             | Reutilizar lógica de clasificación/validación; composición I004 suministra Config con modelo del brazo y timeout 45000 ms. Compatibilidad requiere política fail-fast explícita sin alterar el flujo productivo.         |
| config.ts, prompts.ts, inference-descriptor.ts, code-reference.ts | Validar configuración experimental y reutilizar original, esquema y referencia al código. No alterar variables globales ni defaults.                                                                                     |
| experiment-manifest.ts, experiment.ts, experiment-budget.ts       | Controles específicos de I003: mantenerlos y su ledger intactos. Añadir composición/manifiesto/ledger pequeños propios de I004, compartiendo utilidades donde encajen, sin framework.                                    |
| comparison.ts                                                     | Mantener rechazo de modelos distintos en I003. Reutilizar o extraer únicamente emparejamiento puro si evita duplicación real, con regresión; I004 permite solo su pareja aprobada y mismas condiciones comunes.          |
| report.ts                                                         | Conservar v1/v2 e informes históricos; reutilizar partes comunes para esquema v3 I004 con digest real, fase/modelo, tiempos, memoria, huella y permisos. Compatibilidad de 3 casos no se hace pasar por benchmark de 60. |
| Observación I004                                                  | Wrapper que delega classify y toma metadatos fuera de la llamada medida; muestreador RSS específico y estadística pura, sin alterar petición/predicción ni añadir clasificación.                                         |

Entrada manual implementada, con ejecución real **desautorizada** hasta nueva aprobación:

```sh
npm run eval:model-comparison -- --phase compatibility --model llama3.1:8b
npm run eval:model-comparison -- --phase compatibility --model gemma3:12b
npm run eval:model-comparison -- --phase benchmark --model llama3.1:8b
npm run eval:model-comparison -- --phase benchmark --model gemma3:12b
```

Cada comando representa solo un brazo, requiere autorización específica y rechaza opciones ausentes, duplicadas, modelos/fases desconocidos o estado incompatible. Nada se descarga automáticamente. El CLI no habilita permisos. Antes de cada llamada se validan fase/modelo/digest, orden, casos congelados, presupuesto y reserva persistente; un brazo no puede repetirse bajo otro ID.

La fuente de selección I004 es el modelo explícito, validado contra su manifiesto, no OLLAMA_MODEL de producción. El timeout I004 es 45000 ms, no OLLAMA_TIMEOUT_MS productivo. Construir y validar Config local al proceso experimental, registrando URL/opciones efectivas; no modificar process.env, servidor o archivos productivos. Una discrepancia entre manifiesto y configuración efectiva bloquea ejecución; no adaptar una parte silenciosamente. Las opciones existentes de I002/I003 mantienen su comportamiento.

Ubicación implementada: `src/evaluation/model-comparison/`, `test/model-comparison/`, `evals/experiments/i004-manifest.json` y evidencias `evals/reports/i004/`, separadas de I003 bajo la exclusión Git existente. Manifiesto con experimento, protocolo común, dos brazos/digests, dataset/prompt/anotaciones, versión/plantillas, timeout, política de residencia, observación, orden y autorizaciones por defecto false. Metadatos por run: UUID, fase, modelo solicitado/efectivo, digest/versión/cuantización, huella, Config, prompt/dataset y reserva; permisos históricos identificados sin reescribirlos al cerrar.

No nuevo ADR: experimento acotado dentro de ADR-002. No alterar el puerto o generalizar el proveedor por conveniencia experimental. Si una incompatibilidad obliga a una decisión distinta, detener el trabajo afectado y consultar, sin cambiar esta especificación silenciosamente.

## 9. Presupuesto, errores y reproducibilidad

Máximo independiente I004: **126 inferencias reales**, distribuidas exclusivamente como **3 Llama compatibilidad + 3 Gemma compatibilidad + 60 Llama benchmark + 60 Gemma benchmark**. Ninguna llamada extra de prueba, precarga, warm-up o corrección. Cuatro runs máximos; consultas de metadatos no generan tokens ni se presentan como inferencias. No usar peticiones vacías de chat como excepción oculta.

Reservar 3/60 antes de comenzar el brazo; ledger propio con exclusión mutua, intentos iniciados, no intentados y reservas conservadoras. Una interrupción mantiene la reserva y bloquea reanudación/repetición sin revisión, aunque el número real sea menor. No redistribuir restos del presupuesto para repetir casos o añadir brazos. Permisos separados para implementación, instalación, compatibilidad y benchmark; esta aprobación no concede ninguno.

**Timeout común experimental: 45000 ms**, contado por el adaptador e incluyendo posible carga. Mismos temperature 0, stream false, esquema y límites de respuesta que I001. La diferencia frente a I003 de 30000 ms es explícita y no se propaga a producción. Mismos parámetros explícitos entre brazos; conservar y documentar defaults heredados y contexto porque no implican igualdad de comportamiento interno. Sin visión, semilla o ajustes nuevos.

Errores conocidos: timeout, conexión, HTTP y respuesta inválida. En compatibilidad detienen toda la fase; en benchmark se registran como error y se continúa sin reintento si sigue siendo posible la ejecución secuencial y la configuración común. No reparar JSON, sustituir categorías o registrar respuesta cruda. Un timeout cancela espera HTTP, no prueba que Ollama haya detenido el cálculo: verificar inactividad por controles/metadatos observables sin nuevas inferencias; si no se puede confirmar, detenerse para evitar solapamiento. No cambiar timeout o reiniciar automáticamente.

Inesperado, interrupción, escritura fallida, digest/huella/versiones cambiadas o residencia de otro modelo: conservar parcialidad/evidencia y detener antes de iniciar otro caso/brazo. Sin reanudar o ajustar parámetros para continuar. CLI: código 0 para brazo de compatibilidad con 3/3 técnicamente válidas; 1 ante primer error/preflight fallido/incompletitud. Benchmark completo y guardado sale 0 incluso con errores conocidos; 1 ante fallo de preflight, escritura o incompletitud. La calidad negativa no cambia el código técnico ni habilita repetición.

Congelar antes de inferir: tag, digest completo, cuantización/versión del modelo y plantilla local, versión Ollama/Node, CPU/GPU/RAM/OS, contexto/backend disponible, variables relevantes saneadas y configuración efectiva. Llama histórico: digest `46e0c10c039e019119339687c3c1757cc81b9da49709a3b3924863ba87ca666e`, Ollama 0.40.14, Q4_K_M; verificar, no suponer igualdad actual. Digest Gemma pendiente de inspección operativa autorizada, no de decisión de diseño. Si hace falta instalar/actualizar, obtener autorización antes y congelar configuración común antes de ambos brazos; no modificar servidor entre ejecuciones.

### Estimación, no garantía

Llama I003 tardó unos 21 s/60 casos con su protocolo anterior. Como planificación no medida, 0,35 s/caso Llama y 0,5–2 s/caso Gemma darían 51–141 s de benchmark más carga/preparación/compatibilidad/observación. Reservar orientativamente 5–15 minutos si cabe en memoria; no afirmar que Gemma tendrá esa velocidad. El timeout de 45 s no implica que los casos vayan a tardar 45 s.

126 intentos que agotasen el timeout supondrían **94,5 minutos** solo de espera de clasificación, más preparativos/metadatos/I/O. No es un límite duro total y compatibilidad fail-fast puede detener mucho antes. Descarga no estimada ni autorizada; tamaño almacenado no prueba memoria suficiente.

## 10. Informes y conservación

Informes JSON v3 con identidad y configuración efectivas, UTC de inicio/fin, completitud/terminación, permisos/reserva, dataset ID/versión/hash, prompt ID/versión/hash, modelo/digest/plantilla/versiones y entorno saneado. Resultados por ID/dificultad/estado/predicción o causa técnica y latencia; memoria con unidad/método/timestamps/cobertura/atribución y motivos null. Sin descripciones, justificaciones, prompt completo, respuestas crudas o secretos. No sobrescribir: UUID y creación exclusiva.

La comparación referencia ambos runs y sus hashes, pares, métricas, señales y regresiones; diferencia hechos, hipótesis, incertidumbre e incompatibilidad. Si no hay memoria fiable, informar esa dimensión inconclusa, no un consumo cero. No simular garantía estadística, jerarquía de roles idéntica o validación independiente. El informe humano no decide promoción.

Evidencia I004 separada en `evals/reports/i004/`; no escribir ledger o informes I003. Al finalizar, desactivar todas las autorizaciones y conservar instantánea del manifiesto usado, sin cambiar su hash histórico. Preparar copia privada local comprimida e inventario SHA-256 con verificación de miembros, código/configuración exactos o referencia de commit aplicable, sin credenciales o textos innecesarios. Mantener originales y proponer segunda copia privada independiente del disco. No subir datos ni modificar exclusiones Git. La referencia a copia futura no autoriza acciones ahora.

## 11. Criterios de aceptación aprobados y trazabilidad

| ID         | Tipo                  | Criterio verificable                                                                                                                                                                                                                                                                                                 |
| ---------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I004-AC-01 | Humana + determinista | D-01 a D-06 Approved el 2026-11-06, decisiones y señales fijadas antes de inferir; sistemas/plantillas documentados, hashes y comportamiento productivo protegidos.                                                                                                                                                  |
| I004-AC-02 | Determinista          | CLI explícito valida fase/modelo/permisos/orden/presupuesto y Config de 45000 ms; --initialize crea solo controles nuevos a cero sin modelos o inferencias. Continuación exige estado inicializado coherente, sin autocrear ledger. No cambia configuración productiva ni permite bypass.                            |
| I004-AC-03 | Humana + real         | Compatibilidad de tres casos independientes por modelo comprueba comunicación, mensajes, esquema, JSON válido y timeout; 6/6 válidas necesarias, primer error técnico detiene sin reintento; error semántico válido no bloquea.                                                                                      |
| I004-AC-04 | Determinista + real   | Dos runs nuevos de 60 en orden Llama→Gemma sobre desarrollo congelado; secuenciales y un solo modelo residente observado/documentado, sin warm-up o reintentos, máximo 126 reales con reservas/intentadas/no intentadas explícitas.                                                                                  |
| I004-AC-05 | Determinista          | Pares por ID rechazan dataset/opciones/huella/modelos ajenos; aceptan exclusivamente pareja nativa prevista, sin exigir plantillas iguales. Comparador y evidencias I003 conservan sus restricciones.                                                                                                                |
| I004-AC-06 | Determinista + real   | Calidad/QUESTION/adversariales/matriz/errores contrastados con fixtures y resultados; denominadores previstos/válidos e intersección visibles, errores no cuentan como defensa.                                                                                                                                      |
| I004-AC-07 | Determinista + real   | Media/mediana/p95 nearest-rank probados con n=0/1/par, primer caso y 59 restantes separados; carga inicial y condiciones registradas sin inventar tiempos internos no expuestos.                                                                                                                                     |
| I004-AC-08 | Determinista + real   | Muestreo objetivo 500 ms/PID/PPID cuando viable, con método/unidades/cobertura/huecos/atribución; distinguir artefacto/residencia/RSS/máximo observado. Intento documentado y ausencia justificada de medida fiable aceptables; valores inventados, omisiones o falso pico real no.                                  |
| I004-AC-09 | Determinista          | JSON v3 válido, modelo solicitado/efectivo/digest/Config/dataset/prompt coinciden con composición y payload simulado; escritura exclusiva sin textos/secretos, evidencias I003 separadas e intactas.                                                                                                                 |
| I004-AC-10 | Determinista + real   | Fail-fast, no reintentos/solapamiento y parcialidad conservados. Ledger/marcador vinculados por instancia/revisión/hash, progreso monotónico y fsync; ausencia/corrupción/incertidumbre/huérfanos bloquean. Inicialización separada, lock entre procesos, sin reconstrucción o liberación de presupuesto automática. |
| I004-AC-11 | Humana + determinista | Señal neta ≥5/60 y complementaria macro-F1 ≥0,03 calculadas/probadas por separado, sin obligatoriedad de esta última ni conjunción de puertas descartadas; QUESTION/regresiones y robustez revisadas descriptivamente, sin promoción.                                                                                |
| I004-AC-12 | Determinista          | npm run verify correcto sin Ollama real: tests, formato, lint y compilación; regresión de I001/I002/I003 y defaults productivos, incluido timeout de 30000 ms.                                                                                                                                                       |
| I004-AC-13 | Humana + real         | Informe final completo sobre sistemas y limitaciones, revisión de regresiones, evidencia privada verificable y permisos desactivados; sin validación independiente, promoción o cambio del modelo productivo.                                                                                                        |

Los 13 IDs se conservan; son criterios aprobados con cobertura determinista. El estado individual de implementación y los pendientes reales se registran en la sección 15. Resultado desfavorable no implica incumplimiento: se exige medir/documentar conforme al protocolo, no mejorar o adoptar Gemma. AC-08 admite falta de RSS fiable si se intentó el método y se documentó justificadamente; no permite omitir observación ni presentar datos incompletos como comparables. Tiempos internos y pico real no expuestos son null previstos, no evidencia inventada.

AC-03/04 requieren compatibilidad y ambos brazos para declarar comparación completa. Una incompatibilidad que impida ejecutarlos se conserva y se consulta antes de un cierre/excepción; no se marca automáticamente Verified con criterios no ejecutados. No se añade obligación de validación independiente o promoción.

## 12. Pruebas y casos límite

Tests puros de métricas, p95/mediana/ceros/null, umbrales exactamente 4/5/6 aciertos netos y macro-F1 justo por debajo/en/encima de 0,03; demostrar que señal complementaria no es obligatoria ni se heredan puertas I003. Fixtures de matriz asimétrica, QUESTION, errores, correcciones y regresiones con ganancia neta compensada. Estados ambos correctos/incorrectos/error, ninguna predicción QUESTION y denominadores distintos por errores.

Tests de composición con proveedor HTTP simulado y temporales: payload solo cambia model entre brazos, prompt/roles/esquema/options constantes, timeout experimental 45000 ms frente a producción 30000 ms intacta; tres casos de compatibilidad frente a 60 de benchmark, orden, una petición por caso y permisos false. Pruebas de entorno/huella/digest incompatible, doble ejecución, escritura exclusiva, reservas conservadoras/realizadas, fail-fast sin consumir resto y ausencias de autorización. Ningún test llama al Ollama real o descarga modelos; fixtures no dependen del estado mutable de permisos reales.

Memoria con PID nuevo/desaparecido, PPID no atribuible, KiB→bytes, muestras incompletas, intervalos perdidos y memoria unificada sin suma artificial. Medición no genera classify extra ni altera categoría; fallo del monitor deja motivo/null y no un error semántico o consumo cero. Primero/último caso, límites de contexto, truncado o esquema inválido, carga inicial, expulsión automática, otro modelo residente y timeout cuyo cálculo no puede confirmarse terminado. Sin cambios de parámetros para superar tests reales.

Regresión v1/v2/CLI de I002/I003 y exclusiones Git; verificar que las evidencias, permisos cerrados y presupuesto I003 no se reabren. La extracción mínima de utilidades, si se necesita, exige tests que preserven sus restricciones, no una refactorización productiva para experimentar.

## 13. Tareas y Definition of Done

| ID        | Tarea                                                            | Comprobación                                                                    |
| --------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| I004-T-01 | Registrar diseño y seis decisiones Approved                      | Completada documentalmente el 2026-11-06; sin permiso de implementar o inferir. |
| I004-T-02 | Tras autorización, composición/CLI/manifiesto/ledger mínimos     | AC-01/02/05/10; timeout local 45 s, permisos I004 false e I003 intacto.         |
| I004-T-03 | Estadística, observación e informes                              | AC-06/07/08/09 con fixtures; sin cambiar adaptador/puerto/defaults.             |
| I004-T-04 | Preparar y revisar tres casos independientes de compatibilidad   | Congelación humana y máximo 126; aún sin inferencias.                           |
| I004-T-05 | Completar regresión determinista                                 | AC-12 y punto de control humano previo a experimentos.                          |
| I004-T-06 | Con permisos posteriores, instalación/preflight y compatibilidad | AC-03, digests/plantillas/versiones/residencia; primer fallo técnico detiene.   |
| I004-T-07 | Con autorización de benchmark, dos brazos nuevos                 | AC-04; Llama→Gemma, 60+60, un residente, máximo 126 reales acumulado.           |
| I004-T-08 | Analizar señales, pares, errores, costes y regresiones           | AC-05 a AC-11; informe descriptivo, sin promoción o nuevas pruebas.             |
| I004-T-09 | Verificar, preservar evidencia y desactivar permisos             | AC-12/13; Implemented hasta aceptación humana de Verified.                      |

Para **Implemented**: autorización de implementación posterior al diseño, código/tests/documentación completos y alineados, `npm run verify` correcto; señalar pendientes reales. No requiere Ollama en tests ni implica autorización de descarga o evaluación.

Para **Verified**: compatibilidad y dos runs nuevos completos con permisos, los 13 criterios satisfechos en ramas aplicables, señales y todas las dimensiones informadas sin exigir mejora, regresiones legítimas revisadas, límites/ausencias de observación justificados, informe y evidencia verificables, permisos desactivados y aceptación humana fechada. Una memoria justificadamente no fiable puede dejar conclusión de coste inconclusa sin impedir cierre, conforme a AC-08; no equivale a consumo cero. Omitir medición, inferir fuera del protocolo o no completar brazos obligatorios requiere revisión/dispensa explícita; no marcar criterios como satisfechos por omisión. No se exige ni se permite validar independientemente o promocionar. Modelo/timeout productivos intactos y sin commits automáticos.

## 14. Decisiones aprobadas y fecha

Todas las decisiones siguientes: **Approved — 2026-11-06**, responsable del proyecto. Sustituyen las propuestas incompatibles del Draft, antes de cualquier implementación o resultado I004; no cambian retroactivamente I003.

| ID estable | Decisión aprobada                                                                                                                                                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I004-D-01  | Comparar sistemas Ollama completos con plantillas nativas y prompt original. Documentar tratamiento distinto de roles, sin atribuir efectos solo a pesos ni exigir jerarquía interna idéntica.                                                                                    |
| I004-D-02  | Dos runs nuevos de 60, exclusivamente desarrollo I003 exploratorio; orden Llama→Gemma en compatibilidad y benchmark, un único modelo residente verificado/documentado, sin inferencias de warm-up.                                                                                |
| I004-D-03  | ≥5/60 aciertos netos es señal exploratoria relevante; macro-F1 ≥0,03 es complementaria no obligatoria; QUESTION, legítimos, robustez, fiabilidad y coste se describen sin puertas numéricas adicionales ni promoción.                                                             |
| I004-D-04  | Máximo 126 reales, 3+3 compatibilidad y 60+60 benchmark; casos de compatibilidad independientes, primer error técnico detiene, sin reintentos. Timeout común experimental **45 s**, producción e I003 históricos de **30 s** intactos; permisos operativos posteriores separados. |
| I004-D-05  | Proponer/implementar cuando se autorice muestreo objetivo **500 ms**, PID/PPID cuando viable, registro de método/cobertura/valores/huecos y límites. Máximo observado no es pico real; ausencia fiable se documenta conforme a AC-08, sin inventar datos.                         |
| I004-D-06  | Entrada manual explícita por fase/modelo, validación de permisos/presupuesto, digest/configuración/dataset/prompt en metadatos v3, escritura exclusiva y evidencias I004 separadas. Tests sin inferencias reales; sin cambio global productivo.                                   |

### Reconciliación de requisitos anteriores

- El Draft decía conservar timeout de 30 s; la nueva decisión humana lo cambia explícitamente a **45 s solo para I004**. Se actualizan RF/RNF, compatibilidad, preflight, informes, tests previstos, tareas y estimación. No hay contradicción pendiente con I001/I003 porque no cambian sus configuraciones ni resultados históricos.
- Los umbrales adicionales propuestos (+0,03 macro-F1 obligatorio, mínimos QUESTION/adversarial, pérdidas máximas legítimas, ratios de coste y hueco de 1500 ms como puerta) no se adoptan. Se eliminan como condiciones de éxito, no se dejan como requisitos pendientes que bloqueen aprobación.
- La observación de carga/memoria se registra de forma honesta: no existe exigencia aprobada de un pico real ni de separar tiempos internos que el adaptador no expone. Los límites quedan explícitos; no se introduce instrumentación productiva por conveniencia.
- Modelos, método, CLI, protocolo e interpretación quedan resueltos como diseño. Digests exactos, cuantizaciones, disponibilidad de memoria/atribución y versión instalada son datos del futuro preflight autorizado, no aprobaciones de diseño pendientes ni permiso de inspección ahora. Si allí aparece una incompatibilidad nueva, detener el trabajo afectado y consultar.

**No hay contradicciones de diseño pendientes que impidan Approved.** Registro histórico de la aprobación documental del 2026-11-06, anterior a la autorización de implementación: no se crean código, datasets, casos, scripts o manifiestos de ejecución; no se descarga o consulta Ollama local ni se ejecutan inferencias. I003 y `specs/.DS_Store` permanecen intactos. Detenerse para revisión humana antes de cualquier implementación.

## 15. Punto de control de implementación — 2026-11-06

Implementación autorizada e iniciada el **2026-11-06**, tras revisión completa del protocolo y contratos anteriores. Descargas, preflight local, compatibilidad e inferencias reales permanecen desautorizados. No se modifica el cambio ajeno `specs/.DS_Store`.

Se implementan manifiesto estricto, CLI manual por fase/modelo, presupuesto propio y progreso durable, compatibilidad fail-fast, benchmark secuencial reutilizando el runner/caso de uso/adaptador, identidad y entorno efectivos, residencia exclusiva, muestreo RSS, estadísticas, informes v3 y comparación pareada. Se comparte únicamente el emparejamiento puro por ID; I003 mantiene rechazo de modelos diferentes y controles anteriores. No se añaden dependencias o cambios de comportamiento productivo.

Tres casos de compatibilidad candidatos en `evals/experiments/i004-compatibility-cases.json`, **pendientes de revisión humana**. Manifiesto `evals/experiments/i004-manifest.json` con revisión false, todas las autorizaciones false, metadatos de modelos/host pendientes y servicio dedicado sin aprobar. El runner bloquea antes de crear efectos externos. Ningún dataset congelado se modifica. Guía reproducible: [i004-usage.md](../../evals/experiments/i004-usage.md).

Detalles operativos conservadores: un timeout real no permite confirmar fin de cálculo con `/api/ps`; el observador devuelve inactividad no demostrada y detiene conservando parcialidad. Los tests prueban tanto la confirmación simulada como el bloqueo real conservador; no se añade una heurística de inactividad o reintento. El ledger registra una invocación antes de emitirla: tras caída entre persistencia y llamada, la cuenta es conservadora y requiere revisión, no recuperación de presupuesto. Los parámetros heredados se conservan con su texto/hash, además de identidades y contexto máximo; la residencia registra el contexto efectivo observado.

No hay resultados de calidad/coste reales que interpretar. Presupuesto real **0/126**, sin ledger de ejecuciones reales; todos los consumos de tests viven en temporales y usan mocks. T-02/T-03 y cobertura determinista de T-05 implementadas; T-04 tiene candidatos preparados, pero revisión/congelación humana pendiente; T-06/T-07 desautorizadas, T-08 real y cierre T-09 pendientes. No se requiere modificar decisiones aprobadas.

| Criterio   | Cobertura determinista y pendiente                                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| I004-AC-01 | Diseño aprobado, hashes protegidos y defaults productivos comprobados; revisión humana de esta entrega pendiente.                               |
| I004-AC-02 | CLI estricto, permisos por fase/modelo, hashes/digests/Config/orden/presupuesto y ausencia de atajos por entorno probados.                      |
| I004-AC-03 | JSON válido semánticamente incorrecto compatible; errores técnicos fail-fast probados. Revisión de tres casos y compatibilidad real pendientes. |
| I004-AC-04 | 126 peticiones simuladas, cuatro brazos en orden, residencia/duplicados/secuencialidad/presupuesto probados. Benchmark real pendiente.          |
| I004-AC-05 | Emparejamiento puro por ID compartido, rechazos de incompatibilidades y regresión I003 cubiertos.                                               |
| I004-AC-06 | Métricas existentes y comparación con errores/denominadores/intersección/regresiones probadas; resultados reales pendientes.                    |
| I004-AC-07 | Distribuciones/mediana/p95/primer caso/resto y null internos probados; latencias reales pendientes.                                             |
| I004-AC-08 | PID/PPID, KiB, muestras incompletas, huecos, máxima observada, no solapamiento y ausencia de datos probados; medición local real pendiente.     |
| I004-AC-09 | Informes estrictos v3, identidad, payload con fetch simulado, escritura exclusiva y ausencia de textos probados; informes reales pendientes.    |
| I004-AC-10 | Reserva/progreso, locks, errores, timeout sin inactividad, parcialidad y evidencia alterada probados; operación real pendiente.                 |
| I004-AC-11 | Señales 4/5/6 netos y macro complementaria probadas; sin conjunción ni promoción. Análisis/revisión humana de pares reales pendiente.           |
| I004-AC-12 | Suite completa con regresión I001/I002/I003, formato, lint y compilación; resultado final registrado tras verificar.                            |
| I004-AC-13 | Guía de informes, snapshots, comparación y conservación preparada, permisos desactivados. Evidencia experimental y cierre humano pendientes.    |

No se marca Verified ni se declara cumplida evidencia que requiere modelos reales. Al aprobar esta entrega, solicitar autorización específica de preflight/instalación si procede, revisión humana de compatibilidad y, después, permiso de fase de compatibilidad; benchmark requiere una autorización posterior distinta.

### Verificación de implementación y entrega — 2026-11-06

`npm run verify` final: **90/90 tests correctos** (65 anteriores y 25 nuevos), cero fallos, cancelaciones u omisiones; formato, lint y compilación estricta correctos. Todos los efectos de Ollama/sistema de I004 se simulan mediante dependencias inyectadas o fetch simulado. Se comprueban fuente/hash de inputs, separación de evidencias, datos privados ausentes, payload sin cambios salvo modelo, defaults productivos y timeout experimental. El único cambio a código existente de evaluación es delegar el emparejamiento puro en una función compartida, sin alterar rechazos de modelos de I003; su suite de regresión sigue pasando.

Se alcanza **Implemented**, no Verified. No se ha consultado Ollama local, descargado modelos, ejecutado preflight o realizado inferencias reales; **0/126** consumidas. Todos los permisos siguen false y los metadatos reales pendientes; las tres incidencias de compatibilidad son candidatas sin aprobación humana. Sources productivos, prompts, datasets y evidencias históricas conservan sus hashes iniciales, así como el cambio ajeno de `.DS_Store`. Sin nuevas dependencias ni commits. La evidencia real y revisiones indicadas en la tabla siguen pendientes; se detiene el trabajo para revisión antes de autorizar cualquier operación real.

## 16. Casos aprobados y endurecimiento del ledger — 2026-11-06

El responsable aprueba **I004-COMP-BUG, I004-COMP-FEATURE e I004-COMP-QUESTION** el **2026-11-06**. Se registra en compatibility.review del manifiesto, conservando exactamente textos, IDs, categorías, justificaciones y hash. Las menciones de revisión pendiente en el punto de control anterior son históricas; esta aprobación no habilita compatibilidad ni benchmark. Todos los permisos de inferencia permanecen false.

La revisión estática previa detectó que ENOENT en budget.json inicializaba un historial vacío. Se autoriza corregir exclusivamente inicialización/persistencia/recuperación y sus tests, sin descargas o inferencias. AC-02/AC-10 se precisan conservando sus IDs; el estado sigue **Implemented**. No se modifica ningún protocolo de clasificación o decisión experimental.

Nuevo modo manual `npm run eval:model-comparison -- --initialize`: crea 0/126 y no observa modelos ni requiere editar archivos internos. Solo permite un experimento nuevo, sin controles/evidencias de ejecución; admite el preflight de lectura reconocido ya existente. El runner normal exige continuación de estado inicializado; no interpreta ausencia de ledger como presupuesto disponible y no reconstruye historia desde informes.

Controles: budget-initialization.json y budget.json con instancia UUID, revisión y SHA-256 vinculados; budget-persistence.pending persiste antes de cada actualización y solo se retira tras sincronizar ambos controles. Temporal exclusivo + FileHandle.sync + rename + fsync de directorio. Fallo parcial, controles ausentes/corruptos/divergentes, evidencia huérfana, reserva pendiente o intento sin resultado bloquean; progreso monotónico prohíbe disminuir presupuesto o reescribir resultados. Lock exclusivo probado con dos procesos reales Node, sin Ollama. Ningún --force o recuperación automática.

La durabilidad reduce ventanas de pérdida, sin garantía absoluta del hardware/sistema de archivos; una limpieza pendiente puede bloquear de forma conservadora. Ningún mecanismo local garantiza protección frente a borrado deliberado, restauración conjunta de copias antiguas o pérdida simultánea de todos los archivos de control/evidencias. No hay autenticación criptográfica contra un administrador. La ausencia de respuesta no demuestra que la inferencia no ocurrió; el intento persistido antes de invocar se conserva como consumido/incierto.

Diez pruebas nuevas cubren inicialización/continuación, ausencia tras run, corrupción/inconsistencia y rollback, reservas/intentos sin resultados, evidencias incompatibles, CLI sin atajos, dos procesos concurrentes, fallos de sincronización y progreso monotónico. Las pruebas de duplicados/errores de I004 y las regresiones I001–I003 se conservan. Solo datos/efectos simulados y temporales; no se consulta Ollama ni se ejecutan inferencias reales. Resultado completo de npm run verify se registra tras comprobarlo.

No se inicializa el ledger del experimento real en esta entrega: **0/126** según el historial y las acciones auditadas, no por deducción de ausencia de respuesta. El preflight de lectura anterior sigue siendo la última observación de modelos; no se repite. Sin descarga de Gemma, modificaciones productivas, cambios de datasets/prompts/I003 o commits. La [guía](../../evals/experiments/i004-usage.md) documenta uso, fallo seguro y límites; se detiene para revisión humana.

Verificación de esta corrección: **npm run verify correcto, 100/100 tests** (90 anteriores y 10 nuevos), cero fallos, cancelaciones u omisiones; formato, lint y compilación estricta correctos. Sin inferencias o preflight adicionales. Producción mantiene Llama/original/30000 ms e I004 45000 ms; el presupuesto real sigue **0/126** y todas las autorizaciones de inferencia false. Inicialización legítima y fallos se prueban exclusivamente en temporales, incluida concurrencia real entre dos procesos Node sin Ollama. Casos aprobados registrados, ninguna modificación de su contenido; estado **Implemented**, entrega detenida para revisión humana.

## 17. Autorización limitada de compatibilidad — 2026-11-06

El responsable autoriza exclusivamente tres casos aprobados con Llama y después los mismos tres con Gemma, máximo **6 intentos**, incluidos fallos y timeouts. Se conservan prompt/casos, temperature 0, timeout experimental 45000 ms, secuencialidad, modelo residente único y ausencia de warm-up/reintentos. Primer error técnico detiene la fase y no permite continuar al otro modelo; JSON válido semánticamente incorrecto no constituye incompatibilidad.

Preflight de preparación sin inferencias: ledger inicializado coherente a 0/126, digests coincidentes con descarga, Ollama 0.40.14, residencia inicial vacía y método RSS disponible. Se registran las identidades y entorno efectivos en el manifiesto y se habilita solo authorization.compatibility por modelo, con fecha/responsable; benchmark sigue false. El runner prepara/verifica residencia y persiste reservas/intentos antes de llamar al clasificador. Tras la fase, desactivar compatibilidad sin cambiar los snapshots históricos. I004 permanece **Implemented**; no se autoriza benchmark, promoción o commits. Resultados pendientes de ejecutar en este punto del registro.

### Resultado de compatibilidad — 2026-11-06

Se completan exclusivamente los seis intentos autorizados, sin warm-up/reintentos: **Llama 3/3 y Gemma 3/3 técnicamente válidos**, cero errores técnicos o timeouts. Ambos devuelven BUG, FEATURE y QUESTION para I004-COMP-BUG, I004-COMP-FEATURE e I004-COMP-QUESTION, respectivamente. Los aciertos de estos tres casos de comprobación no demuestran calidad general, robustez adversarial o resultados de benchmark.

| Modelo      | Run ID                                 | Latencias BUG / FEATURE / QUESTION | Tiempo de brazo |
| ----------- | -------------------------------------- | ---------------------------------- | --------------- |
| llama3.1:8b | `766b5ceb-5da6-44d3-be88-2fae50143b5a` | 4917,05 / 293,81 / 241,70 ms       | 5904,63 ms      |
| gemma3:12b  | `29324c70-5926-401f-9e2d-84d2ffcd75b9` | 6811,89 / 928,44 / 774,27 ms       | 8934,58 ms      |

Digests verificados antes y durante: Llama `46e0c10c039e019119339687c3c1757cc81b9da49709a3b3924863ba87ca666e`, Gemma `b92b218582c521ba287f38f1d6057dcd3c6cbff036f13cac97b5d861f5e58ec3`, ambos Q4_K_M, Ollama 0.40.14. Se mantiene el prompt original, esquema, temperature 0 y timeout experimental 45000 ms. Los primeros tiempos incluyen posible carga, sin aislarla; los tiempos de brazo incluyen observación/persistencia. No se comparan como costes estadísticamente concluyentes de rendimiento.

Cada brazo comienza con residencia vacía y observa solo su propio modelo después de cada caso. Llama se descarga de memoria mediante la preparación aprobada antes de Gemma; al terminar este último se observa exclusivamente Gemma. No se ha solicitado otra inferencia ni warm-up. La observación RSS tiene 12/12 y 17/17 muestras completas, con huecos máximos aproximados 611 y 617 ms. Máximos RSS observados 9366224896 y 11950555136 bytes, respectivamente, no picos reales ni memoria exclusiva de pesos/GPU; se conservan las limitaciones de atribución/muestreo.

Los dos informes JSON v3 originales y su snapshot de manifiesto autorizado quedan en `evals/reports/i004/<run-id>.json` y `<manifest-sha>.manifest.json`, excluidos de Git. Hashes de informes contrastados con el ledger y snapshots verificados; sin textos de incidencias. El ledger/marcador quedan coherentes en revisión 16, con **6 reservados y 6 intentos**, dos brazos de compatibilidad completos. Presupuesto **6/126**; **120 restantes no autorizadas**.

Al finalizar se desactivan las dos aprobaciones de compatibilidad, conservando responsable/fecha y snapshots históricos. Benchmark permaneció false durante toda la fase y sigue sin autorización. I004 permanece **Implemented**, pendiente de permiso específico de benchmark. No hubo incidencias técnicas o desviaciones, cambios de prompts/casos/datasets/código/producción ni commits. Trabajo detenido para revisión humana.

## 18. Autorización de benchmark comparativo — 2026-11-06

El responsable autoriza exclusivamente 60 casos con Llama y después 60 con Gemma, máximo adicional **120 intentos** y acumulado **126/126**, incluidos errores/timeouts/resultados inciertos. Compatibilidad previa 6/6 válida, ledger coherente a 6/126, inputs congelados, metadatos y digests coincidentes con las identidades aprobadas, residencia inicial vacía y memoria observable. Se habilita únicamente benchmark por modelo; compatibilidad permanece desactivada.

Mismo prompt original, dataset de desarrollo I003 contenido 2, temperature 0 y timeout 45000 ms. Un único residente por brazo, sin warm-up/reintentos, ledger fail-closed. Ante timeout sin fin de cálculo confirmado o cambio necesario de protocolo, detenerse antes de nuevas inferencias. Registrar completos/parciales y resultados desfavorables sin repetir. No se autoriza promoción, validación independiente, modificaciones productivas o commits; I004 permanece **Implemented**. Al terminar, desactivar todos los permisos y presentar comparación, señales exploratorias, errores, residencia, memoria y latencias para revisión humana. Resultados pendientes en este punto del registro.

## 19. Recuperación de evidencias — 2026-11-09

La interrupción afectó a la preparación documental, no a la persistencia de las inferencias. Auditoría inicial de solo lectura: cuatro JSON v3 completos, dos snapshots de manifiesto y ledger/marcador coherentes en revisión 260, instancia `6d9033fa-7744-476e-a858-c69a92423eb4`. Los hashes de informes coinciden con el ledger; los snapshots coinciden con su nombre SHA-256. Sin reservas pendientes, intentos sin resultado, lock o sentinel de escritura. Existen exactamente 60 resultados únicos por benchmark y tres por compatibilidad, todos coincidentes con IDs, etiquetas y metadatos congelados. No se deducen respuestas de porcentajes ni se alteran originales.

La comparación existente del 2026-11-06 se recalcula con el comparador actual y coincide íntegramente. Runs benchmark: Llama `c677a894-c254-4c51-99a8-335a25ab154c`, Gemma `66b1c2cf-096d-4c13-a1d9-a0931152d7ce`. Confirmados **44/60 frente a 57/60**, accuracy **0,733333 frente a 0,95**, macro-F1 **0,730159 frente a 0,950653**. Trece correcciones, cero regresiones y 47 empates (44 ambos correctos y tres ambos incorrectos). Legítimos 42/51 frente a 50/51; adversariales 2/9 frente a 7/9; coincidencias inducidas 7/9 frente a 2/9. QUESTION recall 12/20 frente a 20/20, sin regresiones. Coincidencia inducida no prueba causalidad.

Ganancia neta **+13/60** supera señal exploratoria ≥5/60; macro-F1 **+0,220495** supera señal complementaria ≥0,03. No constituyen prueba estadística, validación independiente o autorización de promoción. Tiempos de brazo 27,396 s y 58,138 s; máximos RSS muestreados 9364537344 y 11485888512 bytes, sin afirmar picos reales. Cobertura, primera llamada, huecos, diferencias de plantillas y coste observador detallados en el informe humano.

Informes JSON finales originales intactos en `evals/reports/i004/<run-id>.json`. Comparación recuperada intacta: `evals/reports/i004-benchmark-comparison-2026-11-06.json`. Nuevo informe completo: `evals/reports/i004-benchmark-report-2026-11-09.md`. Los derivados permanecen junto al directorio controlado, dentro de reports/ ignorado por Git: su lista fail-closed no acepta archivos arbitrarios. Se documenta esta diferencia operativa frente a la ruta genérica de la sección 10, sin modificar código ni el protocolo.

Presupuesto **126/126**, cero errores técnicos/timeouts/inciertos, cuatro brazos completos. Todas las autorizaciones desactivadas y sin nuevas inferencias durante recuperación. Fuente productiva/evaluación/tests, prompts, datasets, I003 y cambio ajeno specs/.DS_Store conservan las huellas previas al benchmark. No cambios de código, modelos, configuración, ledger, resultados originales o commits. I004 permanece **Implemented**; revisión y aceptación humana pendientes.

### Estado de criterios tras recuperación

| Criterio   | Evidencia y estado                                                                                                                |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| I004-AC-01 | Evidencia completa: decisiones previas, hashes/productivo y plantillas preservados.                                               |
| I004-AC-02 | Evidencia completa: CLI y controles deterministas, permisos desactivados, estado persistido coherente.                            |
| I004-AC-03 | Satisfecho: seis casos aprobados técnicamente válidos, independientes del benchmark.                                              |
| I004-AC-04 | Satisfecho: dos brazos nuevos 60/60, orden y 61 snapshots de residencia por brazo, 126 intentos totales.                          |
| I004-AC-05 | Satisfecho: comparador valida pares y referencias, salida recuperada idéntica.                                                    |
| I004-AC-06 | Satisfecho: métricas, matrices, QUESTION, adversariales y ambos-válidos n=60 documentados.                                        |
| I004-AC-07 | Satisfecho: latencias completas, primero/restantes, p95 y tiempos internos null justificados.                                     |
| I004-AC-08 | Satisfecho: 49/49 y 102/102 muestras completas, huecos y máximos observados con límites explícitos.                               |
| I004-AC-09 | Satisfecho: informes v3 y metadatos validados, sin textos de incidencias, originales intactos.                                    |
| I004-AC-10 | Satisfecho: cuatro brazos completos, reservas/resultados/hash/marcador coherentes, sin incertidumbre o reintentos.                |
| I004-AC-11 | Evidencia técnica completa: señales independientes calculadas, cero regresiones; interpretación/aceptación humana pendientes.     |
| I004-AC-12 | Satisfecho: verify de recuperación correcto, 100/100 tests, formato, lint y compilación.                                          |
| I004-AC-13 | Informe final y evidencias verificables disponibles, permisos desactivados; revisión humana y conservación definitiva pendientes. |

No se declaran los 13 criterios aceptados automáticamente ni se marca Verified. No hay bloqueo por pérdida de resultados; quedan revisión humana de interpretación/cierre y conservación privada definitiva. No se ha creado una copia independiente de respaldo durante esta recuperación.

Verificación de recuperación (2026-11-09): **npm run verify correcto, 100/100 tests**, cero fallos/cancelaciones/omisiones, formato/lint/compilación correctos. Primer intento en sandbox: 89/100 pasan y 11 fallan con listen EPERM al abrir servidores HTTP simulados. Repetición fuera de esa restricción: 100/100; sin contactar con Ollama. Inventario privado de integridad: `evals/reports/i004-recovery-inventory-2026-11-09.json`, con hashes de originales, controles y derivados. No constituye una copia de respaldo independiente.

## 20. Revisión final y conservación pendiente — 2026-11-09

Revisión solicitada por el responsable: especificación, cuatro informes originales, comparación, informe humano e inventario de recuperación contrastados sin inferencias. Los 16 archivos inventariados conservan tamaño y SHA-256; ledger/marcador permanecen en revisión 260, 126/126 intentos con resultados, cero inciertos, autorizaciones false. Comparación recalculada idéntica a la persistida. Fuentes, tests, prompts, datasets, I003 y cambio ajeno specs/.DS_Store conservan las huellas anteriores al benchmark. No se modifican los informes ni el inventario histórico.

**AC-11: revisión final completada.** Compatibilidad técnica demostrada en los seis intentos; superioridad exploratoria de Gemma en este dataset (57 frente a 44 aciertos, macro-F1 0,950653 frente a 0,730159), 13 correcciones, cero regresiones y 47 empates. Señales neta +13/60 y complementaria +0,220495 evaluadas separadamente. No hay regresiones legítimas individuales pendientes. No hubo validación independiente ni autorización para cambiar el modelo productivo. La comparación incluye sistemas Ollama y plantillas nativas, no atribuye mejora exclusivamente a pesos. Latencias externas incluyen carga posible, transporte y validación; RSS es máximo muestreado con huecos, no pico real o memoria GPU exclusiva. Orden fijo, una pasada y muestra sintética pequeña impiden garantías estadísticas o de robustez general.

**AC-13: bloqueado por destino de conservación pendiente.** No consta una ruta privada acordada fuera del directorio de trabajo. Se solicita al responsable antes de copiar, conforme a su instrucción explícita. No se elige /tmp como conservación definitiva ni se declara satisfecho este criterio solo con originales e inventario dentro del proyecto. Paquete previsto: cuatro runs, snapshots, ledger/marcador, manifiesto final, comparación, informe humano e inventario de recuperación, más manifiesto SHA-256; creación sin sobrescritura y verificación de lectura/hashes antes de completar AC-13. Una copia fuera del proyecto en el mismo disco no sustituye protección frente a avería física.

Estado individual vigente: **AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08, AC-09, AC-10, AC-11 y AC-12 satisfechos; AC-13 pendiente** de copia privada verificada en destino indicado por el responsable. I004 permanece **Implemented**, sin fecha de cierre Verified. No se modifica la aceptación histórica de otros puntos de control.

Verificación final de esta revisión: **npm run verify correcto, 100/100 tests**, cero fallos/cancelaciones/omisiones; formato, lint y compilación correctos, sin Ollama real. Producción conserva llama3.1:8b, prompt original y timeout 30000 ms; experimental 45000 ms intacto. Cero nuevas inferencias, descargas, modificaciones de presupuesto o commits.

Siguiente paso recomendado, fuera del alcance y sin implementación/autorización de ejecución: validación independiente de Gemma bajo un protocolo que requiera aprobación humana. No se inicia I005 ni se promociona modelo alguno.

## 21. Conservación verificada y cierre — 2026-11-09

El responsable indica expresamente `~/Lab/ai-suppor-platform-results` como destino privado fuera del proyecto. Se crea sin sobrescritura `/Users/ibai/Lab/ai-suppor-platform-results/i004-evidence-2026-11-09-v1-private.tar.gz`, **185061 bytes**, permisos **0600**, junto a su archivo `.sha256`. SHA-256 del comprimido: `ab91efdd710b4a7dae5015e48913dc1d29b26cf2652bd9d2249562bc11373ba2`.

Verificación mediante reapertura completa del gzip/tar: **96 archivos**, cada miembro cotejado byte a byte y mediante SHA-256 con el original, más `SHA256-MANIFEST.json` interno con nombres, tamaños y hashes. Incluye cuatro informes originales, comparación, informe final, inventario de recuperación, ledger/marcador, snapshots, manifiesto final, preflights y fuentes/tests/configuración exactos para reproducibilidad. No incluye .env, credenciales, node_modules, dist ni datos de validación independiente. La instantánea documental precede este recibo de cierre; los informes históricos se preservan sin modificaciones. La copia está fuera del directorio de trabajo; no se afirma independencia física del disco. Se recomienda una segunda copia privada cifrada en soporte independiente, cotejando también el SHA-256 del comprimido.

**AC-13 satisfecho**: copia privada legible e integridad verificada, permisos desactivados y evidencia conservada. **AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08, AC-09, AC-10, AC-11, AC-12 y AC-13 satisfechos**. Los pendientes de las secciones anteriores describen puntos de control históricos, resueltos por esta conservación y la revisión final de la sección 20.

Estado final **Verified — 2026-11-09**, bajo la instrucción del responsable de cerrar al satisfacer AC-11 y AC-13. Resultado: superioridad exploratoria del sistema Gemma en desarrollo (57/60 frente a 44/60; macro-F1 0,950653 frente a 0,730159), 13 correcciones, cero regresiones y 47 empates. Compatibilidad técnica demostrada; sin validación independiente, sin inferencia estadística de robustez general, sin atribución exclusiva a pesos y sin promoción. Plantillas nativas, orden fijo, muestra pequeña y límites de latencia/memoria permanecen documentados.

Presupuesto final 126/126, cero errores técnicos/timeouts y todos los permisos false. Llama original y timeout productivo 30000 ms conservados. No inferencias adicionales, descargas, cambios de presupuesto, prompts, datasets o código productivo; no commits ni I005. Siguiente paso recomendado: proponer validación independiente de Gemma para aprobación humana, sin implementarla ni ejecutarla.

Verificación posterior al cierre documental: **npm run verify correcto, 100/100 tests**, cero fallos/cancelaciones/omisiones; formato, lint y compilación estricta correctos. Segunda lectura del archivo comprimido confirma los 96 hashes internos y el SHA-256 externo. Inventario histórico, controles y resultados originales intactos; todas las huellas protegidas y permisos desactivados confirmados.
