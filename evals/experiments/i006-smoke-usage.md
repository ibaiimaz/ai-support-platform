# I006 — Smoke test de compatibilidad

**Diagnóstico cerrado — PASSED — 2026-11-17.** La primera y única ejecución real ha terminado y ha sido aceptada por el responsable del proyecto. La configuración versionada [i006-smoke-authorization.json](i006-smoke-authorization.json) queda desactivada y sin autorización reutilizable: `execute: false`, `identityHash: null` y `approvalReference: null`. La autorización efectiva utilizada se conserva únicamente en las evidencias privadas; la referencia e identidad históricas figuran en el resumen de resultado, que no concede permisos.

Este diagnóstico no inicializa el experimento, no modifica su manifiesto, no carga casos del dataset y no aporta resultados a sus métricas. El dataset I006 contenido v3 permanece congelado. No se modifica código productivo ni se reproduce la orquestación dentro del diagnóstico.

## Escenario único

ID fijo: `I006-SMOKE-INC-142`.

Mensaje fijo, sin selección por CLI:

> Retomo el asunto de INC-142. Los detalles de lo que necesito están en esa incidencia

El diagnóstico invoca una vez `classifyIncident()` con dependencias creadas por `createClassificationDependencies()`: mismo prompt I006, adaptador Ollama y repositorio sintético productivo. Espera una solicitud única de `getIncidentById` con INC-142, resultado FOUND y clasificación estructurada BUG en la segunda inferencia.

El transporte observa y limita, sin reescribir mensajes, argumentos o respuestas. Las solicitudes erróneas se entregan intactas a aplicación. Una clasificación directa o abstención inicial termina el caso con un intento; no se fuerza una consulta. No hay reintentos, reparaciones, llamadas de recuperación, warm-up ni segundo caso.

## Límites y autorización

- Máximo absoluto: dos intentos diagnósticos.
- Límites productivos: 45 segundos por inferencia, 5 por herramienta, 90 globales.
- Modelo: `llama3.1:8b`, digest `46e0c10c039e019119339687c3c1757cc81b9da49709a3b3924863ba87ca666e`.
- Servidor esperado: `http://localhost:11434`, Ollama 0.40.14.
- Temperatura 0; tools/format y parámetros restantes son los de producción.
- Autorización propia, vinculada a identidad de código/build, escenario, prompt, esquema/herramienta, configuración y metadatos esperados del modelo.

La identidad reutiliza la verificación de emisión TypeScript exacta existente: compara el build con una emisión en memoria, sin escribir archivos, y verifica fuentes, configuración y lockfile. Su verificación durante el caso detecta cambios relevantes de código o controles antes de cada envío. No demuestra integridad física de todas las dependencias instaladas ni controla cambios concurrentes del servidor. El uso dedicado y la conservación del entorno requieren disciplina operativa.

El transporte solo admite POST al `/api/chat` aprobado. Cada intento se reserva con escritura exclusiva y sincronización a disco antes de invocar fetch. Se comprueban nuevamente autorización, código, controles, AbortSignal y plazo monotónico antes del envío. Un tercer envío o una entrada concurrente quedan bloqueados.

Si la aplicación vence mientras una reserva se está persistiendo, se cierra primero el transporte y se espera esa reserva antes de liberar el lock. Su terminación tardía no puede generar una petición. Una operación de disco bloqueada puede prolongar el cierre más allá del deadline de clasificación, manteniendo el bloqueo; no habilita inferencias ni recuperación automática.

## Comprobación de solo lectura

Después de compilar:

```sh
npm run smoke:i006 -- --check
```

Esta acción lee y valida configuración, autorización, estado local e identidad del código/build. **No hace peticiones de red, no consulta Ollama, no crea directorios ni controles y no genera texto.** Muestra la identidad local actual y `modelMetadataVerified: false`, ya que usa los metadatos esperados, no una consulta en vivo. No actualiza la identidad histórica del resultado ni permite repetir el diagnóstico cerrado.

No interpreta `--check` como autorización. No admite `--force`, IDs de ejecución, directorios, modelos, escenarios o presupuestos alternativos por CLI. Variables de entorno incompatibles con la autorización también bloquean.

## Procedimiento histórico de ejecución — no repetir

La ejecución realizada requirió autorización expresa para hasta dos intentos diagnósticos adicionales al presupuesto experimental, referencia propia e identidad aprobada. Se habilitó únicamente el permiso diagnóstico durante esa ejecución y después se desactivó. Esta descripción conserva el procedimiento histórico; no autoriza otra ejecución ni la activación de permisos.

El siguiente comando identifica la única ejecución ya realizada; no volver a ejecutarlo:

```sh
npm run smoke:i006 -- --run
```

Sin autorización válida termina antes de cualquier consulta al servidor. Con autorización válida adquiere exclusión mutua y comprueba metadatos mediante `/api/version`, `/api/tags` y `/api/show`; estas consultas no consumen intentos de inferencia. Versión, digest, capacidad tools y hash de metadatos deben coincidir con lo aprobado. Un fallo previo a reclamar el caso no genera inferencias.

Tras reclamarlo, no hay repetición ni continuación automática, cualquiera que sea el resultado. La autorización histórica no reabre un diagnóstico usado, aunque su booleano siga activo. No borrar controles para repetirlo; cualquier nueva acción requiere revisión humana.

## Evidencias privadas y durabilidad

Ubicación fija: `evals/reports/i006-smoke/`, excluida de Git por la regla existente `evals/reports/`.

- `budget.lock`: reutiliza la primitiva de exclusión; es exclusivamente diagnóstico, no el lock del presupuesto I006.
- `started.json`: reclamación durable del único caso y su identidad.
- `authorization.json`: snapshot de aprobación propia.
- `attempt-1.json`, `attempt-2.json`: reservas durables previas al envío, con estado `RESERVED_POSSIBLE_DISPATCH`.
- `report.json` y `report.json.sha256`: resultado saneado e integridad.
- `closed.json`: cierre con hash del informe y contadores.

No se crea `evals/reports/i006/` ni su ledger. Una segunda ejecución, evidencia previa corrupta o incompleta, marcador perdido con otras evidencias, lock huérfano o fallo de persistencia bloquean. No se reconstruye un historial ni se libera consumo por falta de respuesta.

Las escrituras reutilizan creación exclusiva, fsync de archivo/directorio y permisos privados. Si falla la persistencia final pueden quedar solo marcador y reservas: eso no implica que no se enviara una petición. Ningún mecanismo local protege contra borrado deliberado de todas las evidencias, restauración de copias antiguas o avería física del disco.

No se guardan mensajes, prompts, argumentos completos, contenido recuperado, correlaciones arbitrarias, respuestas crudas ni excepciones. Se guardan identidades, categorías permitidas, estados y contadores. Los logs externos de Ollama están fuera del control de este comando.

## Interpretación

Se separan tres dimensiones:

- `technicalStatus`: protocolo válido observado, error de protocolo, HTTP, transporte, timeout o error inesperado. No afirma compatibilidad general del modelo.
- `scenarioStatus`: PASSED, FAILED, NOT_EXERCISED o INCOMPLETE.
- `operationalStatus`: OK o FAILED, para controles/persistencia.

Un resultado PASSED exige el recorrido completo esperado. Categoría incorrecta con JSON válido es fallo semántico; herramienta desconocida, argumentos inválidos o solicitudes adicionales son incumplimientos de política, no errores de formato. Una respuesta directa o abstención inicial deja sin ejercitar la herramienta. Los errores técnicos no se convierten en errores semánticos.

Códigos CLI: 0 para check válido o escenario completado correctamente; 2 para escenario incumplido/no ejercitado con protocolo válido; 1 para fallo técnico u operativo. Ante fallo final de escritura, inspeccionar las reservas antes de concluir consumo.

## Contabilidad separada

El informe identifica el ámbito `I006_SMOKE_COMPATIBILITY` y conserva:

- `reservedAttempts`: reservas iniciadas, sin devolución automática de slots.
- `dispatchesObserved`: invocaciones observadas del transporte real, incluidas las fallidas; no prueba que Ollama completara una inferencia.
- `validatedResponses`: respuestas del adaptador válidas según protocolo.
- `notDispatched`: reservas que este proceso sabe que no llegó a enviar.
- `uncertainDispatches`: envíos sin respuesta validada. Es una clasificación conservadora, también ante errores de protocolo/HTTP; no presupone consumo cero.

Si el proceso se interrumpe antes del informe, cada reserva durable representa un posible intento y el diagnóstico queda bloqueado. Una respuesta no persistida no autoriza repetirla.

El máximo diagnóstico es 2 y el experimental continúa siendo 120: con ambas autorizaciones, el máximo combinado potencial es **122**, sin confundir ese techo con consumo observado. Este comando no escribe ni calcula consumos en el ledger experimental. Para el total real se suman los registros diagnósticos y experimentales y se presentan aparte sus incertidumbres; el smoke nunca se oculta como calentamiento gratuito.

Superar este único caso no acredita los umbrales del dataset, decisiones generales de abstención ni resistencia semántica a prompt injection.

## Resultado cerrado y resumen versionado

El [resumen histórico saneado](i006-smoke-result.json) contiene identidad, referencia, modelo y digest, configuración, contadores, resultado y hash del informe. Es exclusivamente documental: no se consume por el CLI como autorización, marcador o historial operativo.

- Referencia: `I006-SMOKE-RUN-2026-11-17`.
- Run ID: `36a12f6d-a1a8-47d5-8242-1e36d90f6dc1`.
- Identidad diagnóstica ejecutada: `a478a04d42b5bb01fed9428936f4d8ce1c81e924991d44c8f9bd69354f9db103`.
- Dos intentos reservados, enviados y completados con respuestas validadas; cero reintentos, errores o intentos inciertos.
- Primera respuesta: llamada correcta a `getIncidentById("INC-142")`; una ejecución de herramienta, resultado FOUND.
- Segunda inferencia: clasificación estructurada BUG.
- Estado técnico VALID_OBSERVED, funcional PASSED y operativo OK.
- Duración del caso: 6,601 segundos (valor sin redondear: 6601,453667 ms).
- SHA-256 del informe privado: `8ea32c27484a6cbcaf545ba741f580a6643caa6f36b40f8a20da022f30237618`.

El código del smoke aún no estaba commiteado cuando se ejecutó. Se conserva la referencia Git base y los hashes exactos de fuentes y build que identifican lo ejecutado. El commit de cierre no sustituye retrospectivamente esa identidad. La coincidencia del hash del informe se ha verificado con su sidecar y el marcador de cierre, sin modificar originales.

### Clasificación de evidencias para Git

| Archivo local                       | Contenido y tratamiento                                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `report.json`, `report.json.sha256` | Informe saneado y su integridad; se mantienen privados por política, sin copiar el informe completo a Git. |
| `authorization.json`                | Snapshot operativo con el permiso que estuvo activo; privado y excluido.                                   |
| `started.json`, `closed.json`       | Marcadores operativos de reclamación/cierre; privados y excluidos.                                         |
| `attempt-1.json`, `attempt-2.json`  | Reservas operativas; privadas y excluidas.                                                                 |
| `budget.lock`                       | Lock transitorio; ya liberado, nunca versionable.                                                          |

Los siete archivos persistidos permanecen localmente en `evals/reports/i006-smoke/`, sin borrado ni modificación. No contienen prompts o respuestas crudas, pero su condición de evidencias privadas o controles operativos impide publicarlos. Solo se versiona el resumen documental seleccionado, sin campos de activación operativa.

El bloqueo de repetición se conserva por la configuración desactivada y las evidencias persistidas. Recompilar o realizar el commit de cierre no elimina esos controles; tampoco autoriza borrar archivos para repetir el caso. Ninguna nueva inferencia está autorizada.

Consumo real cerrado: **2 intentos diagnósticos**, separado del presupuesto experimental de 120. No se inicializa ni prepara la evaluación experimental, no se incorporan resultados a sus métricas y no se marca I006 Verified.
