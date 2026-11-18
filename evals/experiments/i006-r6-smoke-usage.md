# I006 revisión 6 — smoke manual de dos recorridos

Estado: **cerrado STOPPED el 2026-11-18**, por desviación funcional en I006-001. Referencia `I006-R6-SMOKE-RUN-2026-11-18`. Se ejecutó una única vez; no se autoriza repetición ni reanudación. No modifica ni reabre la evaluación completa o diagnósticos históricos retirados.

## Guion e identidad

Guion único: [scripts/i006-r6-smoke.js](../../scripts/i006-r6-smoke.js). JavaScript ESM manual; sin nuevo comando npm, módulos productivos, dependencias ni framework. Importa la composición, orquestación, transporte protegido, persistencia, lock y comprobación de código/build existentes. Sus exportaciones permiten pruebas simuladas; no hay selectores CLI de modelo, casos, presupuesto o directorios.

- Identidad diagnóstica aprobada para la ejecución histórica cerrada: `c9fe02642def0e8f7fc487100cd8cfb0be8c54e7315665aa8c2c544faf2a9830`.
- SHA-256 del guion: `746da5479f9351d4d33becea5b655a39d893c3237ed67911db0a123b49258182`.
- Implementación: commit `ee8e8b87fa0707d314ba59e880ea6181717dc9ef`, identidad `2ede2557caba18117260d701db5528c9f4eff58fa50d9c494ad2bfd03b9b9f0b`.
- Modelo `llama3.1:8b`, digest `46e0c10c039e019119339687c3c1757cc81b9da49709a3b3924863ba87ca666e`, Ollama `0.40.14`.
- Temperatura 0, protocolo de revisión 6 sin alterar mensajes, herramientas, format ni respuestas; límites 45/5/90 segundos.
- Dataset v3 y hash congelado originales. Se lee el texto exacto de I006-001; no se envían etiquetas ni justificaciones.

La identidad incluye hashes de guion, escenarios, dataset y código/build, referencia Git y referencia a la identidad efectiva de implementación, que fija prompts, protocolo, configuración y metadatos del modelo. Un cambio relevante exige revisión; no se actualizan identidades automáticamente. Un commit posterior también cambia la referencia y requiere nueva preparación.

## Escenarios y presupuesto

| Orden | Caso                                                              | Recorrido esperado                                                                                                     | Límite        |
| ----- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------- |
| A     | I006-001, texto congelado                                         | no_lookup → clasificación BUG; ninguna herramienta                                                                     | 2 inferencias |
| B     | Texto fijo INC-142 del smoke histórico, sin reabrir sus controles | Una solicitud nativa getIncidentById con ID normalizado INC-142 → repositorio sintético real FOUND → clasificación BUG | 2 inferencias |

Presupuesto propio máximo: **4 intentos**; consumo final **1 reservado, enviado y validado**, cero intentos inciertos. Los tres no consumidos no se reutilizan. Máximo dos por escenario y una herramienta en B, ninguna en A. Sin reintentos, warm-up ni reanudación. Se detiene ante la primera desviación técnica, operativa o funcional. Los observadores no reparan respuestas; detienen antes de consultar el repositorio si la primera decisión no coincide con el recorrido esperado. Los resultados de este smoke no forman parte de las métricas de 60 casos ni de su presupuesto de 120.

## Comprobaciones deterministas y referencia histórica

```sh
node --check scripts/i006-r6-smoke.js
node --test test/diagnostics/i006-r6-smoke.test.js
# --check estaba vinculado al commit original; el commit de cierre bloquea esa identidad.
```

`--check` solo lee archivos locales y contrasta fuentes/build sin escribir. No consulta Ollama, no crea directorios, marcadores ni presupuestos. El test JavaScript manual se ejecuta expresamente con el comando anterior; no está incluido en el patrón de tests TypeScript compilados de `npm run verify`. Este último sigue verificando formato, lint, compilación y regresión del proyecto.

## Procedimiento histórico de ejecución — cerrado, no repetir

1. Aprobar expresamente esta identidad y una nueva referencia de ejecución.
2. Declarar la dedicación exclusiva de Ollama y verificar su PID. Autorizar únicamente los campos correspondientes de [i006-r6-smoke-authorization.json](i006-r6-smoke-authorization.json): identidad, referencia, PID, `dedicated: true` y `execute: true`. En el cierre se conserva identidad, referencia y PID históricos; `execute` está desactivado.
3. Repetir `--check`, contrastar identidad y ausencia de evidencias anteriores.
4. Ejecutar una única vez, solo tras autorización:

   ```sh
   node scripts/i006-r6-smoke.js --run
   ```

5. No repetir el comando ante fallo o interrupción. Conservar evidencias y cerrar el permiso bajo la autorización correspondiente. El marcador impide repetir aunque el permiso permanezca activo.

Antes de crear controles y antes de cada reserva, el guion comprueba la identidad efectiva de implementación con endpoints de metadatos, PID/ejecutable/puerto de Ollama, ausencia de API en el puerto 3000, ausencia de clientes TCP ajenos identificables y residencia vacía o exclusivamente del modelo/digest aprobado. No inicia, detiene, carga ni descarga modelos mediante preflight. Falla cerrado si no puede verificarlo. Estas comprobaciones complementan la declaración humana de exclusividad; no prueban exclusión absoluta ni evitan carreras con clientes externos. Se requiere mantener reservado el servicio durante toda la operación.

## Evidencias y límites

Directorio real conservado: `evals/reports/i006-r6-smoke/`, excluido de Git. Contiene los originales de la ejecución cerrada. Al iniciar una ejecución autorizada, el lock exclusivo protege el recorrido y se crean marcador `started.json`, identidad y snapshot de autorización. Cualquier evidencia previa, parcial o incierta bloquea una nueva ejecución; no hay recuperación automática.

Cada envío necesita antes su journal exclusivo `attempt-N.json`, escritura y sincronización a disco. Los journals y marcador se contrastan de nuevo antes de enviar. Una reserva fallida se registra como incierta si es posible guardar el informe; no se reutiliza. Se registran separadamente reserva durable, envío observado y respuesta validada. Un envío observado no demuestra recepción o ejecución completa por el servidor.

Al finalizar se guardan `report.json`, SHA-256 y `closed.json`. Informes saneados: IDs fijos, estados, categorías, contadores, latencias y errores/diagnósticos permitidos, sin prompts, descripciones, argumentos, contenido recuperado, respuestas crudas ni excepciones arbitrarias. Un fallo de almacenamiento puede impedir el informe o cierre: los marcadores y reservas supervivientes siguen bloqueando; no se declara éxito operativo ni se repite. No hay protección absoluta ante borrado deliberado o pérdida simultánea de todos los controles locales.

Los diagnósticos retirados, sus autorizaciones e identidades permanecen intactos. La evaluación completa conserva `initialize: false`, `execute: false`, identidad nula y ausencia de ledger de revisión 6.

## Resultado cerrado y conservación

- Run ID: `b57b3106-fe89-47ae-8719-00d7a827ae5e`.
- Resultado: `STOPPED`, `FUNCTIONAL_DEVIATION`. I006-001 devolvió una solicitud nativa estructuralmente válida en lugar de `no_lookup`.
- Una inferencia reservada, enviada y validada; cero reintentos, errores técnicos o reservas inciertas. Cero herramientas ejecutadas, ninguna segunda inferencia y escenario INC-142 no iniciado. No se obtuvo clasificación final.
- Latencia observada de primera inferencia: 5699,156791 ms; total registrado: 5718,67975 ms. Incluyen comprobaciones instrumentadas, no representan tiempo puro de cómputo.
- SHA-256 del informe: `b630ff0121b04b00077ceac07f649390eac2f298329207ce2971bf150e307830`.
- `execute: false`. Marcadores `started.json` y `closed.json`, journal, identidad, snapshot de autorización e informe/hash se conservan localmente; no se versionan. No se conservó el nombre ni los argumentos de la solicitud inesperada.

El guion se versiona sin cambiar sus bytes ni la identidad de la ejecución original. Su referencia de commit está fijada a la implementación original: el commit de cierre bloquea el check/arranque por cambio de identidad. No se modifica esa referencia para volver a ejecutarlo. Sus tests usan fixtures independientes del estado real de permisos/evidencias y verifican el rechazo específico tras cambiar la referencia Git. El estado de I006 no pasa a Verified y la puerta experimental permanece pendiente.
