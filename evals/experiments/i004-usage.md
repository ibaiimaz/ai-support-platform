# I004 — Guía operativa y cierre

Estado: **Verified — 2026-11-09**. Compatibilidad y benchmark completados el 2026-11-06: **126/126 intentos consumidos**, cero errores técnicos o timeouts. Llama obtuvo 44/60 aciertos y Gemma 57/60; las evidencias privadas están conservadas y verificadas fuera del proyecto según la sección de cierre. Todos los permisos de inferencia están desactivados. No repetir fases, reinicializar el ledger ni descargar modelos. Los procedimientos de preparación y ejecución siguientes se conservan como referencia histórica, sin autorizar nuevas operaciones. La [especificación](../../specs/iterations/004-local-model-comparison.md) es la fuente de verdad; I003 sigue cerrado y Llama continúa en producción.

## Instalación y verificación determinista

Con Node 22 compatible y dependencias del proyecto instaladas:

```sh
npm run verify
```

Incluye formato, lint, compilación estricta y tests con proveedores/observadores simulados y directorios temporales. No necesita Ollama. Los tests no activan permisos reales ni dependen de su estado mutable. La comparación productiva conserva su modelo por defecto llama3.1:8b, prompt original y timeout 30000 ms; I004 construye Config local con 45000 ms. No modifica process.env ni toma OLLAMA_MODEL/OLLAMA_TIMEOUT_MS como permisos o selección experimental.

## Archivos versionables y evidencias privadas

- `i004-manifest.json`: protocolo, referencias congeladas, dos modelos y aprobaciones por fase/modelo. Todos los permisos de inferencia false; casos aprobados e identidades/entorno congelados tras preflight. El runner rechaza estas condiciones antes de crear observadores o clasificadores reales.
- `i004-compatibility-cases.json`: **tres casos revisados y aprobados por el responsable el 2026-11-06**, uno por categoría. No cambia ningún dataset I003. El manifiesto incluye su hash exacto y `compatibility.review.approved: true`, aprobada por el responsable el **2026-11-06**. Textos, IDs, etiquetas y hash conservados.
- Los informes originales, snapshots exactos de manifiesto y `budget.json` residen en `evals/reports/i004/`, bajo la exclusión de Git existente. La comparación y el informe agregado están junto a ese directorio, también excluidos de Git. El ledger real registra los cuatro brazos completos: seis intentos de compatibilidad y 120 de benchmark, consumo final **126/126**. La inicialización descrita abajo ya se realizó y no debe repetirse.

La aprobación documental de I004 no permite editar aprobaciones como atajo para inferir. Cada aprobación operativa necesita instrucciones explícitas del responsable, fecha y nombre. No existe flag --force, modo automático de aprobación ni variable que habilite ejecución.

## Procedimiento histórico: inicialización y continuación fail-closed

Antes de la primera ejecución, una sola vez y sin inferencias:

```sh
npm run build
npm run eval:model-comparison -- --initialize
```

No requiere descargar modelos, consultar Ollama, rellenar digests ni editar manualmente archivos internos. Valida manifiesto/inputs y crea exclusivamente controles de I004 a **0/126**. No habilita permisos, no reserva un brazo y no ejecuta preflight o modelos. Se ejecutó una sola vez, antes de compatibilidad; repetirla ahora se rechaza. También está probada con fixtures temporales.

La inicialización se rechaza si existen controles, informes, snapshots de ejecución, temporales o evidencias desconocidas. Se permite conservar únicamente el preflight reconocido de solo lectura (nombre `preflight-readonly-*.json`, modo read_only_preflight, cero inferencias/descargas/arranques/paradas/cambios de permisos, endpoints de metadatos). No se reconstruye presupuesto desde ese informe ni desde ningún resultado.

Crea `budget-initialization.json` y `budget.json`, ligados por UUID de instancia, revisión y SHA-256 exacto del ledger. La inicialización incompleta permanece en estado initializing o con escritura pendiente y bloquea. Las ejecuciones normales son exclusivamente **continuaciones**: exigen ambos archivos coherentes; nunca crean un ledger vacío ante ENOENT. Incluso si faltan ambos controles, una continuación falla. Repetir --initialize no reinicia un experimento existente, ni siquiera uno sin inferencias.

Cada progreso mantiene la instancia, aumenta revisión y es monotónico: no borra brazos, baja intentos o reescribe resultados ya guardados. Guarda antes de invocar al clasificador, sin liberar por ausencia de respuesta. Verifica evidencias vinculadas y rechaza archivos de ejecuciones huérfanas o controles restaurados que no concuerdan. Un ledger/marcador ausente, corrupto, incoherente, una reserva incierta, una escritura pendiente o una evidencia desconocida bloquean antes de ejecutar el callback que podría observar/inferir.

La exclusión mutua usa creación exclusiva de budget.lock. Un proceso concurrente falla; un lock abandonado bloquea, no se elimina automáticamente. No hay --force, reparación, migración de ledgers anteriores o reanudación automática. Ante fallo, conservar todos los archivos y solicitar revisión humana; no borrar controles para empezar de nuevo ni reconstruir un historial fiable a partir de informes. Cualquier recuperación requiere un encargo y evidencia suficientes, no un permiso implícito para recuperar presupuesto.

### Persistencia y límites

Se utiliza FileHandle.sync (fsync), temporal exclusivo, rename y sincronización del directorio. Antes de modificar controles se persiste `budget-persistence.pending`; se retira solo cuando ledger y marcador han quedado sincronizados. Un fallo intermedio conserva temporal/señal o discrepancia y bloquea, aunque el JSON parezca legible. Tras fallo de persistencia, la misma operación no puede intentar salvar otra versión automáticamente.

La retirada final de la señal es limpieza posterior al commit de ambos controles: no se exige otro fsync para esa retirada; si reaparece tras un corte, solo producirá un bloqueo conservador. Si el sistema de archivos no admite la sincronización requerida, la operación falla; no se degrada silenciosamente a escritura sin sincronizar. Usa APIs estándar de Node y se prueba en temporales, sin base de datos ni dependencias nuevas; no promete las mismas garantías de hardware en todo sistema de archivos.

**Límite explícito:** ningún mecanismo local garantiza protección frente a borrado deliberado, edición de controles, restauración conjunta de copias antiguas o pérdida simultánea de todos los controles y evidencias. El hash detecta incoherencia entre archivos conservados, no autentica un historial contra un administrador. Restaurar solo un ledger antiguo no concuerda con el marcador; restaurar ambos puede detectarse si quedan evidencias incompatibles, pero no se promete detectar un rollback coherente de todo el estado. Mantener copia privada independiente; nunca suponer que no hubo inferencia porque falte respuesta.

## Procedimiento histórico: preflight con autorización específica

1. Los tres casos, etiquetas e independencia del benchmark están aprobados el 2026-11-06. Conservarlos. Si el responsable pide modificar un caso antes de congelarlo, actualizar su hash en el manifiesto y volver a revisar; nunca tocar los 60 casos congelados. La revisión ya está registrada con approved, approvedBy y date.
2. Obtener autorización separada para inspección local y, si falta Gemma, descarga/instalación. Esta herramienta no descarga modelos. Disponer de un servidor local dedicado: no detener ni expulsar usos ajenos o producción.
3. Identificar PID del servidor que escucha en el puerto aprobado. El observador verifica ese PID con lsof y que corresponde a Ollama; las herramientas del sistema deben estar disponibles. Anotar `environment.serverPid` y confirmar `dedicated` solo con autorización real.
4. Consultar metadatos, sin generar tokens: versión de Ollama, tags/digests y show de ambos modelos, plantillas, parámetros, cuantización y contexto máximo. Revisar explícitamente la semántica de roles de cada plantilla nativa. No adaptar plantillas o prompts. Un cambio de versión necesario requiere aprobación antes de congelar los dos brazos.
5. Rellenar `models` con digest completo, templateSha256, parametersSha256, texto de parameters, quantization, modelContextLength y storedBytes, junto a versión/huella del host. El módulo `observer.ts` exporta `createObserver(manifest).snapshot(model)` para obtener estos metadatos mediante lectura; **no llamarlo en esta fase sin autorización de preflight**. La instantánea incluye host y hostSha256; no debe inventarse un hash o copiarse el de otro equipo. Snapshot no llama a chat/generate/pull ni a prepare.
6. Probar disponibilidad del método RSS sin inferir y revisar límites. Si no es viable, obtener decisión humana de proceder sin memoria fiable y registrarla en `environment.memoryUnavailable` antes del primer brazo; un fallo sin ese permiso bloquea preflight. No inventar valores. Esta aprobación forma parte de la huella común y no se cambia a mitad del experimento para salvar una ejecución.
7. Congelar el manifiesto y confirmar hashes, entorno y presupuesto propio. Se incluyen ambas identidades y el método común en protocolSha256; los permisos operativos pueden habilitarse separadamente sin cambiar esa huella. Cualquier otro cambio entre brazos bloquea continuar.

Datos sanitizados de metadata sí se registran; no se registran incidencias o respuestas crudas. parameters corresponde a defaults del modelo, no al texto del incidente ni al prompt de aplicación. El contexto máximo de show no se presenta como contexto efectivo: este último se observa con ps y puede no estar disponible.

## Procedimiento histórico de ejecución: presupuesto agotado, permisos desactivados

Tras compilar y solo con aprobación explícita de compatibilidad por modelo, el operador registra `authorization.compatibility[modelo]` con approved true, approvedBy y fecha YYYY-MM-DD. La revisión de casos y todos los metadatos también deben estar completos. No habilitar benchmark a la vez por conveniencia.

```sh
npm run build
npm run eval:model-comparison -- --phase compatibility --model llama3.1:8b
npm run eval:model-comparison -- --phase compatibility --model gemma3:12b
```

Orden obligatorio Llama→Gemma. Primer error técnico de compatibilidad detiene toda la fase, incluso si la primera categoría era semánticamente incorrecta. Una etiqueta incorrecta pero JSON válido cuenta como respuesta compatible. Se requieren 3/3 válidas de cada modelo, 6/6 en conjunto, antes de solicitar autorización de benchmark. No se ejecuta automáticamente ni usa compatibilidad como calentamiento oculto.

Solo con nueva autorización y compatibilidad completa se registran las aprobaciones benchmark:

```sh
npm run eval:model-comparison -- --phase benchmark --model llama3.1:8b
npm run eval:model-comparison -- --phase benchmark --model gemma3:12b
```

Cada comando prepara residencia vacía mediante `ollama stop` únicamente para los dos modelos aprobados; no llama a chat vacío, precarga o warm-up. Rechaza otros modelos residentes sin expulsarlos. Observa residencia tras cada caso; otro modelo/digest detiene. Registra esta preparación, primera petición y condiciones observadas: no garantiza cachés frías ni residencia continua entre instantáneas.

El timeout es 45 s por llamada, incluida carga. En benchmark errores técnicos conocidos quedan registrados sin repetir; inesperados o cambios de identidad/residencia detienen. Tras timeout, el observador real devuelve inactividad no confirmada: `/api/ps` informa residencia, no garantiza que una solicitud abortada dejara de calcular. **Se conserva un parcial y se detiene antes de otra inferencia**, sin reintentar ni reiniciar. Esto aplica el protocolo conservador aprobado; no es una nueva taxonomía del clasificador.

## Presupuesto y parcialidad

Cuatro brazos únicos, en este orden: compatibilidad Llama 3, compatibilidad Gemma 3, benchmark Llama 60, benchmark Gemma 60. Máximo 126, independiente del ledger I003. No se redistribuyen sobrantes ni se permiten reanudaciones.

El ledger se bloquea exclusivamente, reserva el brazo y guarda progreso antes de invocar cada clasificación y después de obtener cada resultado, incluidos errores. En una caída entre escritura e invocación, el contador persistido es conservador: puede incluir un intento cuyo inicio no se pudo confirmar; nunca se recupera ese presupuesto automáticamente. Distinguir reservado, registrado antes de invocar, resultados disponibles y no intentados. No presentar una reserva de 60 como 60 inferencias realizadas.

`allowsNext` solo indica que el brazo terminó y, si era compatibilidad, no tuvo errores técnicos. En benchmark completo puede ser true con errores: la tasa de ejecución satisfactoria está en las métricas, no en ese flag.

Un error inesperado/observación crea informe parcial con complete false y métricas globales null. El análisis de resultados disponibles se etiqueta attempted_only; execution conserva el denominador previsto y los no intentados. Si la escritura del informe falla o el proceso se interrumpe, el ledger/reserva y snapshot existentes son evidencia parcial, nunca un run completo. Un lock o reserva pendiente requiere revisión humana; no se borran para repetir. No hay recuperación automática.

Exit codes: compatibilidad 0 solo con las 3 respuestas válidas del brazo, 1 al primer error técnico; benchmark 0 si completo/guardado aunque tenga errores conocidos, 1 ante incompletitud o fallo previo/escritura. Calidad negativa no altera el código ni autoriza repetir.

## Comparación sin inferencias

Una vez existan los cuatro brazos completos, con informes originales intactos:

```sh
npm run eval:models:compare -- evals/reports/i004/LLAMA_RUN.json evals/reports/i004/GEMMA_RUN.json
```

Los dos argumentos son los informes benchmark, primero Llama. El comando es de solo lectura: valida esquema v3, snapshot exacto del manifiesto y su SHA, referencias del dataset, ledger, hashes y cuatro runs. Rechaza parciales, alteraciones o modelos ajenos. Produce JSON por stdout, sin descripciones; el operador puede conservarlo localmente sin sobrescribir evidencia.

Incluye pares, transiciones, bloques y denominadores, todos los errores, regresiones/correcciones legítimas, QUESTION y adversariales por ID, intersección válida y latencias. Señal neta ≥5/60 y complementaria macro-F1 ≥0,03 separadas, sin puertas heredadas ni selección automática. Mostrar contadores absolutos con porcentajes al preparar el informe humano. Un error o categoría incorrecta no inducida no es defensa; coincidencia inducida no demuestra causalidad. Los resultados reales están disponibles y su revisión final está completada; I004 está Verified, sin autorización de promoción.

El timeline agrega preparación y ejecución de los cuatro comandos y duración de calendario desde el primero hasta el último, incluidos intervalos humanos. Instalación y preparación anteriores al primer comando quedan null/no observadas, no se inventan. No interpretar duración de calendario como cómputo.

## Latencia y memoria

Latencia externa por intento incluye transporte/posible carga/validación, con todos los intentos, válidos, primer caso y resto separados. Mediana convencional, p95 nearest-rank; n=0 da null. Los tiempos internos de carga/tokenización/generación quedan null con razón explícita: el adaptador no los expone y no se modifica para el experimento.

RSS de servidor/runners se identifica por PID/PPID, muestreo objetivo 500 ms sin solapar lecturas, incluyendo inicial/final; guarda muestras, unidades, huecos, fallos y máximo observado. No monitoriza argumentos de procesos ni confunde Node con Ollama. Si hay muestras incompletas/no atribuibles, no declara RSS comparativo fiable; conserva máximo observado parcial y motivo. No aplica un umbral de huecos arbitrario ni inventa pico real. Puede contar páginas compartidas y no atribuye de forma exacta GPU o memoria unificada.

Distinguir storedBytes (artefacto), size/sizeVram reportados por Ollama (residencia), RSS de procesos y máximo muestreado. truePeakBytes es null. No sumarlos como un total de RAM. Condiciones/efectos de observación y ausencia justificada de medidas forman parte del informe; las mediciones de compatibilidad no sustituyen las del benchmark. Ambas mediciones reales quedan registradas por separado.

## Procedimiento de conservación aplicado y límites

Al concluir, desactivar ambos modelos en ambas fases del manifiesto, conservando aprobaciones históricas/snapshots y sin cambiar huellas de informes. Mantener código, manifiesto usado/final, casos revisados, hashes de ambos modelos/prompt/benchmark, metadatos relevantes de entorno y cuatro informes originales/ledger/análisis bajo `evals/reports/i004/`.

Preparar archivo privado versionado, por ejemplo `i004-evidence-YYYY-MM-DD-v1-private.tar.gz`, con inventario SHA-256 y verificación de cada miembro; excluir credenciales, .env, node_modules, dist y textos de incidencias innecesarios, conservando entradas sintéticas necesarias en privado. No borrar originales, cambiar Git ignore o subir datos. Copia en el mismo disco no es respaldo físico suficiente: proponer segunda copia privada cifrada en almacenamiento independiente y verificar allí el hash del archivo. Esta guía no ejecuta ninguna copia ni inferencia.

## Recuperación documental — 2026-11-09

Los cuatro brazos originales están completos: compatibilidad 6/6 válida, benchmark Llama 44/60 y Gemma 57/60, cero errores técnicos, 126/126 consumidas. Todos los permisos están desactivados. Los comandos anteriores documentan el procedimiento histórico; no autorizan repetir fases ni reinicializar controles.

Auditoría y comparación exclusivamente de archivos: `npm run eval:models:compare -- evals/reports/i004/c677a894-c254-4c51-99a8-335a25ab154c.json evals/reports/i004/66b1c2cf-096d-4c13-a1d9-a0931152d7ce.json`. No utiliza Ollama ni cambia el ledger. El resultado coincide con `evals/reports/i004-benchmark-comparison-2026-11-06.json`, conservado intacto. Informe humano: `evals/reports/i004-benchmark-report-2026-11-09.md`. Los derivados se guardan junto a i004/, no dentro de su lista estricta de archivos de ejecución; todos siguen privados y excluidos de Git. No colocar archivos arbitrarios en el directorio controlado ni saltarse sus comprobaciones.

La recuperación se completó y la revisión final y copia privada verificada permitieron el cierre Verified del 2026-11-09, documentado a continuación; ninguna señal numérica autoriza promoción.

## Cierre — 2026-11-09

I004 Verified tras revisión final y conservación de 96 archivos en `~/Lab/ai-suppor-platform-results/i004-evidence-2026-11-09-v1-private.tar.gz` (185061 bytes, 0600), verificados contra originales y manifiesto SHA-256 interno. SHA del comprimido: `ab91efdd710b4a7dae5015e48913dc1d29b26cf2652bd9d2249562bc11373ba2`; archivo .sha256 acompañante. Instantánea documental anterior al recibo de cierre, sin modificar informes históricos. No constituye garantía frente a pérdida física del mismo disco: mantener segunda copia privada independiente y comprobar el hash tras transferirla. Presupuesto 126/126, todos los permisos false, ninguna repetición autorizada. Producción sigue con Llama; validación independiente de Gemma es una recomendación pendiente de nueva aprobación, sin iniciar otra iteración.
