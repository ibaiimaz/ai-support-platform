# I006 — Diagnóstico independiente de primera inferencia

> **Retirado bajo I006 revisión 6 (2026-11-18).** Todas sus entradas, incluidos `--check` y `--run`, rechazan con `I006_DIAGNOSTIC_RETIRED` antes de leer autorizaciones, reservar presupuesto, acceder al proveedor o modificar evidencias. Las instrucciones y resultados siguientes son históricos. La implementación original se conserva en Git; sus autorizaciones, identidades y evidencias permanecen intactas. No debe ejecutarse con la semántica nueva.

Estado: implementado, pendiente de revisión y de autorización de cualquier inferencia real.

Este diagnóstico observa exclusivamente la primera inferencia de `I006-001`. No reabre la
pasada experimental `bdfb68d5-e828-4a7e-9c76-028a5c0e28b4`, cerrada como `INCOMPLETE`,
ni el smoke test anterior. No aporta resultados a las métricas del dataset.

## Entrada e identidad

Lee el texto exacto desde `evals/datasets/incidents-tool-calling-v1.json`: dataset
`incidents-tool-calling-es-v1`, esquema 1, contenido 3, SHA-256
`fa5b19d7783417220d2b852eabe9260352ba808a4307676f6a20fa86a4562490`.
La entrada no puede seleccionarse mediante argumentos de CLI.

Reutiliza `classifyIncident()`, `createClassificationDependencies()`, el adaptador real y
las instrucciones I006. Primera llamada con herramientas y sin `format`, temperatura 0,
45 segundos por inferencia y deadline de 90 segundos. Modelo `llama3.1:8b`, digest
`46e0c10c039e019119339687c3c1757cc81b9da49709a3b3924863ba87ca666e`, Ollama 0.40.14.

La identidad incluye dataset y texto del caso mediante hashes, prompt, esquema y herramienta,
configuración, metadatos esperados del modelo, protocolo de parada y límite de un intento
mediante código/build verificados, referencia Git y compilador. El check no confirma el
servicio vivo: los metadatos de Ollama se comprueban antes del envío autorizado.
Cambios de código, build, configuración o dataset invalidan la comprobación durante la pasada.

## Uso y autorización

```sh
npm run build
npm run diagnose:i006-first-inference -- --check
```

`--check` es de lectura: no escribe archivos ni consulta Ollama. Presenta la identidad calculada,
el permiso, la presencia de evidencias y la falta de verificación de metadatos vivos.

Antes de ejecutar hacen falta revisión humana, aprobación de la identidad y una referencia
independiente `I006-FIRST-INFERENCE-...`. Solo entonces se permite completar `identityHash`,
`approvalReference` y habilitar `execute` en `i006-first-inference-authorization.json`.
El permiso está desactivado por defecto; la identidad todavía no está aprobada.

Solo tras autorización expresa, ejecutar una única vez:

```sh
npm run diagnose:i006-first-inference -- --run
```

No ejecutar ahora. No hay reintentos, reinicio, reanudación ni selección de otros casos.
Tras la operación, cerrar el permiso mediante una operación autorizada y conservar los archivos.
La identidad no incluye los campos mutables de permiso; el snapshot conserva su valor al ejecutar.

## Límite y parada

Una barrera en el transporte reclama el único envío antes de esperar la reserva durable.
Reutiliza el transporte protegido del smoke, pero no sus permisos, marcadores, informes ni
contadores fijos de dos intentos. Se persiste la reserva antes de invocar el transporte real.
Un segundo acceso, incluso concurrente o posterior a un fallo, no reserva ni envía otra petición.

Tras la primera respuesta validada del adaptador, un observador conserva únicamente tipo y
categoría, o tipo y número de llamadas de herramienta. Lanza una señal privada de observación
para detener la orquestación antes de ejecutar herramientas, consultar el repositorio o solicitar
otra inferencia. No evalúa la política completa de herramientas ni altera argumentos o respuestas.

Resultados separados:

- `FIRST_RESPONSE_OBSERVED`: clasificación, abstención o solicitudes estructuralmente válidas.
- `TECHNICAL_ERROR`: fallo del proveedor, protocolo, timeout o error inesperado saneado.
- `SECOND_SEND_BLOCKED`: actuación deliberada de la barrera independiente de un envío.
- `OPERATIONAL_FAILURE`: autorización, identidad, exclusión mutua o persistencia incompatibles.

Un fallo que impida guardar el informe se comunica de forma saneada por CLI y conserva los
controles ya escritos. No se declara que existe un informe si su persistencia falla.

## Evidencias y privacidad

Directorio privado exclusivo: `evals/reports/i006-first-inference/`, ya excluido de Git.
Contiene `started.json`, snapshot `authorization.json`, `attempt-1.json`, `report.json`,
`report.json.sha256` y `closed.json`. `budget.lock` protege toda la ejecución y se libera al
terminar normalmente. Un lock residual requiere revisión; no se elimina automáticamente.

Cualquier evidencia previa bloquea una segunda ejecución, incluso sin informe o cierre.
Las escrituras reutilizan creación exclusiva, sincronización de archivos y directorio y permisos
privados. No se liberan intentos por falta de respuesta. Un borrado deliberado o simultáneo de
todos los controles, o restaurar copias antiguas, queda fuera de las garantías locales.

No se guardan texto de la incidencia, prompts, contenido recuperado, argumentos, correlaciones,
nombres arbitrarios de herramientas, respuestas crudas, stacks ni mensajes arbitrarios de excepción.
`invalid_response` conserva únicamente un diagnóstico de la enumeración aprobada, si existe.

Los contadores distinguen reserva solicitada conservadoramente, envío observado y respuesta
validada. Una reserva cuya persistencia falle puede estar parcialmente escrita y bloquea la
repetición. `uncertainDispatches` significa envíos sin respuesta validada; no demuestra si el
modelo calculó o terminó. Una respuesta inválida tampoco equivale a ausencia de inferencia.

Presupuesto independiente: máximo **un intento adicional**. Consumo observado previo: dos del
smoke y uno del experimento original. Máximo combinado observado tras este diagnóstico: cuatro.
No se utiliza ni modifica el ledger experimental de 120 intentos.

## Límites de interpretación

Una respuesta nueva no reconstruye la respuesta original, que no se conservó. Temperatura cero
no garantiza reproducibilidad bit a bit; carga, residencia y entorno pueden afectar la ejecución.
Una solicitud de herramienta observada no demuestra su autorización funcional ni la validez de
una segunda inferencia. Una categoría válida tampoco implica por sí sola corrección semántica.
