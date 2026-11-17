# I006 — Compatibilidad independiente de tools + format

Estado: implementación pendiente de revisión. No se han autorizado inferencias reales.

Esta prueba independiente examina dos recorridos con el esquema final añadido a la primera
petición que ya contiene herramientas. No modifica el adaptador productivo ni reabre el
experimento I006, el smoke o el diagnóstico de primera inferencia, todos cerrados.

## Escenarios y configuración

Orden fijo A → B, sin selección de escenarios por CLI:

- A: texto exacto de I006-001, leído del dataset congelado `incidents-tool-calling-es-v1`,
  esquema 1, contenido 3; máximo una inferencia. Se observa la primera respuesta y se detiene
  deliberadamente antes de consultar el repositorio. Clasificación esperada: BUG.
- B: texto fijo `smokeCase.description` de INC-142, sin reutilizar autorizaciones anteriores;
  máximo dos inferencias. Solo continúa una solicitud nativa única validada por
  `readIncidentId()` como `getIncidentById("INC-142")`. Ejecuta el repositorio sintético real,
  exige FOUND y permite la segunda inferencia habitual. Clasificación esperada: BUG.

Dataset SHA-256: `fa5b19d7783417220d2b852eabe9260352ba808a4307676f6a20fa86a4562490`.
Modelo `llama3.1:8b`, digest `46e0c10c039e019119339687c3c1757cc81b9da49709a3b3924863ba87ca666e`,
Ollama 0.40.14, temperatura 0, mismo prompt, herramienta y esquema I006. Límites: 45 segundos
por inferencia, 5 por herramienta y deadline monotónico de 90 segundos por escenario.

Un envoltorio exclusivo comprueba el payload y añade únicamente
`format: toolCallingFinalSchema` a la primera petición, antes del transporte protegido.
Conserva mensajes, herramientas, opciones, headers y señales. La segunda petición pasa intacta:
sin `tools` y con el esquema que ya envía producción. No repara respuestas ni argumentos.

## Permisos e identidad

Autorización propia en `i006-tools-format-authorization.json`, desactivada por defecto.
Requiere referencia humana `I006-TOOLS-FORMAT-...` e identidad aprobada antes de habilitarla.
No lee permisos de ejecuciones anteriores ni ofrece opciones de bypass o reanudación.

```sh
npm run build
npm run diagnose:i006-tools-format -- --check
```

El check es de lectura, no consulta Ollama ni crea controles. Identifica código/build, commit,
compilador, configuración, protocolo de dos escenarios, dataset, textos mediante hashes,
prompt, esquema, herramienta y metadatos esperados del modelo. Los metadatos vivos se verifican
antes de una ejecución autorizada. Se vuelve a comprobar código, autorización, configuración,
dataset y controles antes de cada envío y al conservar cada resultado.

Solo después de autorización humana independiente podría ejecutarse una única vez:

```sh
npm run diagnose:i006-tools-format -- --run
```

No ejecutar ahora. La autorización debe cerrarse después de esa operación sin borrar evidencias.
Un cambio posterior de código o referencia Git cambia la identidad y exige nueva revisión.

## Contabilización y parada

La reserva global durable precede a cada envío. Se reutilizan `createSingleSendTransport()`
para A y `createGuardedTransport()` para B, con contadores propios de esta prueba.

- Defensa global: máximo cuatro reservas.
- Límites por escenario: A una y B dos. Por tanto el máximo efectivo es **tres**.
- La capacidad global sobrante no autoriza un cuarto envío, reintentos o repetir escenarios.
- Consumo observado previo separado: smoke 2, experimento 1 y primera inferencia 1.
  Máximo combinado efectivo tras esta prueba: siete intentos observados.

No hay warm-up, reintentos ni reanudación. Cualquier fallo técnico u operativo detiene toda la
pasada. Una desviación del escenario con protocolo válido se registra y permite pasar al
siguiente escenario, sin corregir la desviación ni repetirlo. A nunca ejecuta herramientas.
B no consulta otros IDs ni continúa sin la solicitud esperada y el resultado FOUND.

`reservedAttempts` es conservador ante persistencia incierta. `dispatchesObserved` cuenta
invocaciones del transporte proveedor; `validatedResponses` cuenta respuestas aceptadas por el
adaptador. `uncertainDispatches` es su diferencia, no prueba de cálculo remoto pendiente.
No se libera presupuesto por ausencia de respuesta.

## Informes e interpretación

Los resultados por escenario distinguen:

- `directClassificationValid`: clasificación directa estructuralmente válida en A.
- `nativeToolCallMatched`: solicitud nativa única y esperada en B.
- `continuationValid`: respuesta final estructuralmente válida en la continuación de B,
  clasificación o abstención. `finalResponse` conserva solo tipo y categoría cuando corresponda.
- `semanticCorrect`: categoría final BUG; null si no se obtuvo una clasificación pertinente.
- Estado `OBSERVED`, `TECHNICAL_ERROR` u `OPERATIONAL_FAILURE`, errores saneados y diagnóstico
  enumerado de `invalid_response` cuando exista; contadores, resultado de herramienta y latencia.

Campos no aplicables usan null. La abstención es protocolo válido pero no cumple estos escenarios.
Una categoría equivocada con esquema válido no demuestra incompatibilidad de tools + format.
Una solicitud adicional se rechaza y no provoca otra consulta o inferencia.

Resumen: `INCOMPLETE` ante parada técnica/operativa; `COMPLETE_FAILED` si se observaron ambos
escenarios pero falla alguna expectativa; `COMPLETE_PASSED` si se completan las tres capacidades
estructurales y ambas categorías esperadas. `compatibilityObserved` separa el recorrido técnico
de la corrección semántica. Ningún resultado autoriza promoción ni cambios productivos.

## Evidencias y límites

Directorio privado exclusivo `evals/reports/i006-tools-format/`, excluido de Git. Contiene
`started.json`, snapshot `authorization.json`, reservas `attempt-A-1.json`, `attempt-B-1.json`
y `attempt-B-2.json` según progreso, checkpoints `scenario-A.json` y `scenario-B.json`, informe
`report.json`, su `.sha256` y `closed.json`. Un `budget.lock` protege toda la pasada.

Cualquier evidencia previa o lock impide repetir. Un checkpoint debe persistir antes de empezar
B. Ante fallo de persistencia se conservan archivos parciales y no se intenta reconstruir ni
liberar presupuesto. Un informe que no puede persistirse no se declara guardado: la CLI comunica
un fallo operativo saneado. Los fallos no habilitan una nueva ejecución.

Se reutilizan escrituras exclusivas, sincronización de archivos/directorios, permisos privados y
verificación de build. El borrado deliberado de todos los controles o restaurar copias antiguas
queda fuera de las garantías de un mecanismo local.

No se guardan texto de incidencias, prompts, resultados crudos, argumentos, IDs de correlación,
nombres arbitrarios de herramientas, stacks ni mensajes de excepción. Solo resultados y
metadatos saneados construidos explícitamente. Los ejemplos y resultados del experimento cerrado
no se modifican ni se incorporan a nuevas métricas.

Una prueba positiva acredita únicamente estos dos recorridos bajo su identidad. No demuestra
compatibilidad general, precisión semántica ni resistencia a prompt injection. La latencia incluye
reserva, transporte y validación, no solo cálculo del modelo; puede verse afectada por carga en frío.
