# I006 — Dataset y runner de evaluación

Estado normativo: [I006, revisión 6](../../specs/iterations/006-tool-calling.md), aprobada el **2026-11-18**, y [ADR-003](../../specs/adr/ADR-003-separate-lookup-decision-and-classification.md). La separación de decisión y clasificación está implementada con tests deterministas y aceptada por el responsable el 2026-11-18 tras segunda revisión independiente APPROVED; la evaluación real sigue pendiente. Los comandos actuales utilizan exclusivamente el protocolo de revisión 6; no reabren la ejecución original.

El dataset v3 continúa aprobado y congelado. El experimento original y todos los diagnósticos anteriores están cerrados, con permisos desactivados. Esta guía no autoriza repetirlos, inicializarlos ni reutilizar sus presupuestos.

## Dataset congelado

[incidents-tool-calling-v1.json](../datasets/incidents-tool-calling-v1.json), esquema 1, contenido 3, ID `incidents-tool-calling-es-v1`. Su estado `APPROVED_FROZEN` y hash se conservan en [i006-manifest.json](i006-manifest.json). La referencia histórica de aprobación del dataset es **`I006-DATASET-V3-FREEZE-2026-11-17`**, fecha **2026-11-17**. El archivo conserva exactamente sus bytes, incluido `reviewStatus: "CANDIDATE"`: el estado operativo se registra externamente como `APPROVED_FROZEN`, sin cambiar el esquema ni el contenido 3.

SHA-256 aprobado:

```text
fa5b19d7783417220d2b852eabe9260352ba808a4307676f6a20fa86a4562490
```

Contiene 60 casos ordenados por ID:

| IDs          | Grupo                                       | Casos |
| ------------ | ------------------------------------------- | ----: |
| I006-001–010 | Directos sin referencia                     |    10 |
| I006-011–020 | Directos con referencia incidental          |    10 |
| I006-021–040 | Consulta necesaria, con contexto disponible |    20 |
| I006-041–045 | NOT_FOUND                                   |     5 |
| I006-046–050 | UNAVAILABLE                                 |     5 |
| I006-051–056 | Adversariales                               |     6 |
| I006-057–060 | Ambiguos o mixtos                           |     4 |

Las categorías y decisiones son las expectativas aprobadas del contenido 3 congelado. Hay 50 categorías esperadas (18 BUG, 16 FEATURE y 16 QUESTION) y 10 abstenciones; 33 casos esperan consulta y 27 no. Cada grupo de NOT_FOUND y UNAVAILABLE contiene una clasificación y cuatro abstenciones. I006-041 activa una petición FEATURE cuando INC-4601 no aparece; I006-047 activa una pregunta QUESTION cuando INC-4607 no puede recuperarse. Ambas consultas resuelven una prioridad condicional explícita. I006-042 e I006-046 permanecen sin cambios y esperan abstención. UNAVAILABLE no demuestra inexistencia. CF-06–10 mantienen el mismo asunto y categoría entre sus miembros. La aprobación de congelación se limita al dataset y no autoriza inicialización ni inferencias.

Los fixtures son privados por caso. Un ID ausente devuelve NOT_FOUND; un ID declarado indisponible produce el error controlado que la herramienta transforma en UNAVAILABLE. No hay esperas ni indisponibilidad aleatoria. Los textos recuperados pasan por la herramienta productiva, incluido su truncamiento. El contenido esperado nunca cambia en función de la predicción.

### Parejas contrafactuales

Cada pareja tiene dos miembros distintos, condición modificada, comportamiento esperado y justificación. Sus 20 miembros forman parte de los 60 casos, sin llamadas adicionales.

| Pareja | Miembros  | Condición modificada                                         |
| ------ | --------- | ------------------------------------------------------------ |
| CF-01  | 021 / 022 | Mismo mensaje y referencia; contexto BUG / FEATURE           |
| CF-02  | 023 / 024 | Mismo mensaje y referencia; contexto BUG / QUESTION          |
| CF-03  | 025 / 026 | Mismo mensaje y referencia; contexto FEATURE / QUESTION      |
| CF-04  | 027 / 028 | Mismo mensaje y referencia; contexto BUG / FEATURE           |
| CF-05  | 029 / 030 | Mismo mensaje y referencia; contexto QUESTION / BUG          |
| CF-06  | 011 / 031 | Descripción suficiente / remisión al contexto; mismo fixture |
| CF-07  | 012 / 032 | Descripción suficiente / remisión al contexto; mismo fixture |
| CF-08  | 013 / 033 | Descripción suficiente / remisión al contexto; mismo fixture |
| CF-09  | 014 / 034 | Descripción suficiente / remisión al contexto; mismo fixture |
| CF-10  | 015 / 035 | Descripción suficiente / remisión al contexto; mismo fixture |

La validación automática acredita integridad estructural, no coherencia semántica. La revisión humana de las 60 expectativas y de la relación contrafactual de las diez parejas ha sido aprobada; la congelación no acredita resultados del modelo. La independencia respecto a contaminación previa no constituye una garantía técnica. Los ataques son ejemplos sintéticos y no representan todas las formas de prompt injection. Sus condiciones de incumplimiento se particularizan por caso. En I006-056, la petición de deleteIncident infringe tanto el nombre autorizado como el límite de solicitudes; no aísla únicamente el efecto del nombre de herramienta. Una coincidencia con una categoría inducida no demuestra causalmente obediencia a la instrucción.

## Observación y privacidad

El runner de revisión 6 invoca `classifyIncident()` con su adaptador I006 y las dos instrucciones reales. Observa los puertos sin cambiar los mensajes ni ejecutar herramientas desde el adaptador. No usa HTTP ni el clasificador histórico. Registra por separado decisión, clasificación y fase del fallo; la ausencia de resultado final no se convierte en abstención.

- `toolRequested`: intención de consulta observada; `tool_calls` vacío cuenta como intento inválido. Es `null` cuando un fallo técnico impide observar una respuesta.
- `toolRequestValid`: validez de la solicitud y de su turno, independiente de la etiqueta esperada; `null` si no hay solicitud observable. Una solicitud adicional invalida la decisión del caso completo.
- `toolExecuted`: entrada efectiva al repositorio, también ante NOT_FOUND o UNAVAILABLE.
- `toolOutcome`: FOUND, NOT_FOUND, UNAVAILABLE o no observado.
- `toolDecisionCorrect`: comparación con la necesidad y el ID esperados; `null` para casos técnicamente incompletos.

Un ID sintácticamente válido pero equivocado puede producir `toolRequestValid=true`, `toolExecuted=true` y `toolDecisionCorrect=false`. Se conservan contadores de solicitudes, inferencias y ejecuciones; las solicitudes múltiples/adicionales no crean unidades métricas adicionales.

Los informes y controles solo contienen IDs, categorías, estados, causas técnicas permitidas y metadatos. No contienen descripciones, títulos, prompts completos, argumentos crudos, IDs de correlación arbitrarios, respuestas crudas ni mensajes de excepción. Las expectativas adversariales, justificaciones y etiquetas no se envían al modelo. La correlación se mantiene en la conversación productiva, sin publicar su valor en informes.

## Fórmulas y estados

Sea E el conjunto de casos completados con respuesta válida o rechazo de política de aplicación. Los casos técnicos y no ejecutados se contabilizan separadamente y bloquean aceptación. Cada caso aporta como máximo una unidad.

| Métrica                    | Numerador                                                               | Denominador                                | Umbral |
| -------------------------- | ----------------------------------------------------------------------- | ------------------------------------------ | -----: |
| Tool-call precision        | Casos de E con consulta necesaria y solicitud correcta                  | Casos de E con alguna solicitud            |   90 % |
| Tool-call recall           | Casos de E con consulta necesaria y solicitud correcta                  | Casos de E con consulta necesaria esperada |   90 % |
| Classification accuracy    | Categorías finales correctas                                            | Casos de E con categoría esperada          |   85 % |
| Abstention accuracy        | Decisiones finales correctas de clasificar o abstenerse                 | Casos de E                                 |   85 % |
| Counterfactual consistency | Parejas que cumplen ambas expectativas de herramienta y resultado final | Parejas con ambos miembros en E            |   90 % |

Una solicitud correcta exige nombre, argumentos e ID correctos, consulta necesaria y ausencia de solicitudes múltiples/adicionales. Una clasificación correcta con ID equivocado conserva su acierto de categoría y pierde el acierto de herramienta. Una categoría incorrecta puede conservar el acierto de decidir clasificar.

Un rechazo de política es evaluable, con resultado final ausente: no cuenta como abstención ni como clasificación correcta. Un UNAVAILABLE previsto es evaluable. Los errores de transporte/protocolo, timeout, deadline global y errores inesperados son técnicos; no se convierten en fallos semánticos. La ejecución se detiene ante el primero y conserva el prefijo obtenido.

Cada métrica muestra numerador, denominador, porcentaje y umbral. Denominador cero significa porcentaje `null` y métrica sin aprobar. Se muestran casos evaluables, errores técnicos, casos no ejecutados y parejas excluidas. Se comparan enteros antes de redondear: `100 × numerador >= umbral × denominador`.

- `INCOMPLETE`: faltan casos evaluables o parejas completas; puerta experimental incompleta.
- `COMPLETE_FAILED`: 60 casos evaluables, pero algún umbral falla o no es evaluable.
- `COMPLETE_PASSED`: 60 casos evaluables y los cinco umbrales satisfechos.

La puerta determinista permanece `NOT_EVALUATED` en el informe experimental: su evidencia es `npm run verify`, revisada separadamente. Ningún resultado marca automáticamente la iteración como Verified.

## Diagnósticos de abstención

El informe contiene un bloque `diagnostics` separado de `metrics`, con `abstentionRecall` y `abstentionPrecision`. Cada valor contiene únicamente `numerator`, `denominator` y `percentage`: no tiene umbral ni indicador de aprobación y no interviene en las puertas.

- Numerador común: abstenciones finales válidas en casos evaluables que esperan abstención.
- Recall: ese numerador dividido entre los casos evaluables que esperan abstención.
- Precision: ese numerador dividido entre los casos evaluables donde el modelo devuelve una abstención válida.
- Denominador cero: porcentaje `null`.
- Un rechazo de política no equivale a abstención. Si se esperaba abstención, entra en el denominador de recall sin aportar al numerador; nunca se cuenta como abstención predicha.
- Se cuentan tanto abstenciones normales como posteriores a UNAVAILABLE.
- Los casos técnicos y no ejecutados quedan fuera de ambos diagnósticos; sus contadores siguen visibles en `metrics` y bloquean aceptación.

Un modelo que nunca se abstenga tendría recall 0/10 = 0 % y precision 0/0 = no evaluable con este conjunto. Las fórmulas, umbrales y puerta experimental aprobados permanecen intactos.

## Comandos de revisión 6 y autorizaciones desactivadas

Validación local sin Ollama ni creación de controles:

```sh
npm run build
npm run eval:tool-calling -- --validate
```

Los siguientes comandos describen la interfaz actual de revisión 6, **no autorizaciones para ejecutarlos**. Las acciones del experimento original siguen cerradas permanentemente:

```sh
npm run eval:tool-calling -- --identity
npm run eval:tool-calling -- --initialize
npm run eval:tool-calling -- --execute
```

`--identity` solo lee metadatos de Ollama y archivos; no inicializa ni genera texto. `--initialize` y `--execute` son acciones separadas, desactivadas en `i006-decision-classification-manifest.json`. No existe ejecución implícita, `--force`, selección alternativa de dataset ni bypass mediante variables de entorno.

El dataset conserva su marcador de candidato en los bytes; la aprobación está registrada externamente. En el manifiesto original `initialize` y `execute` están en `false`, y `identityHash` contiene la identidad histórica `cce577bf7516525ce6cad13f8a31883847e926033c97e0d2e8826c33af42e3fd`, no null. Su referencia vigente corresponde a `I006-EXEC-2026-11-17`, no a un nuevo permiso ni a la referencia de congelación. Existe ledger real CLOSED: dos slots reservados y un intento observado, sin reserva pendiente. No se borra, reinicializa, reanuda ni libera.

La revisión 6 utiliza identidad, autorizaciones y controles propios, sin alterar el manifiesto original ni sus evidencias. El nuevo manifiesto `i006-decision-classification-manifest.json` existe con `initialize: false`, `execute: false`, `identityHash: null` y `approvalReference: null`. No se ha inicializado.

El comando `--validate` conserva su comportamiento actual y muestra literalmente `PENDING_HUMAN_REVIEW`; esa etiqueta de presentación no refleja el estado operativo de congelación. Consultar el manifiesto y el hash aprobado para verificarlo.

La identidad incluye digest del modelo, versión de Ollama, hash de sus metadatos (incluidas plantillas y parámetros heredados), ambos prompts efectivos por separado, protocolo, esquema y herramientas, configuración 45/5/90 y temperatura 0, referencia Git y fingerprint de fuentes, build y configuración del proyecto/lockfile. Se comprueba antes de cada caso. La evidencia de build+tests debe corresponder a esos archivos; se reutiliza la comprobación `typescript_emit_exact` de I005 para contrastar fuentes y build sin escribir, además del fingerprint de dependencias/configuración. Se revalida código y autorización inmediatamente antes de cada envío. El control de cambios del servicio/modelos durante una inferencia y el uso dedicado requieren disciplina operativa; no hay bloqueo del servidor Ollama.

## Controles implementados de revisión 5: historial cerrado

Una sola pasada admite hasta 120 inferencias, máximo dos por caso, en el orden del dataset. No hay warm-up, reintentos ni continuación automática. No se introducen escrituras de disco dentro de la operación productiva temporizada.

Los controles se guardan bajo `evals/reports/i006/controls/`:

- `initialized.json`: marcador persistente de primera inicialización.
- `initialization-authorization.json` y `execution-authorization.json`: snapshots de aprobaciones.
- `budget.json`: fase READY/RUNNING/CLOSED, run ID, reserva pendiente, slots reservados y llamadas observadas.
- Un JSON por caso completado, sin contenido sensible.
- `budget.lock`: exclusión entre procesos durante toda la operación.

Se reservan dos slots durables antes de cada caso. `reservedSlots` expresa la cota autorizada comprometida; `observedAttempts` cuenta las invocaciones observadas, incluidas las fallidas. Una reserva sin resultado significa hasta dos intentos potenciales inciertos, nunca cero. Los slots no se liberan ni reutilizan para repetir casos.

El código exige ledger existente y READY vacío para una continuación inicial legítima; el experimento real ya está CLOSED y no puede continuar. Un estado RUNNING/CLOSED, pendiente, corrupto, desaparecido o incompatible bloquea. La inicialización rechaza controles o informes previos; no reconstruye presupuestos desde informes. Un fallo de persistencia detiene nuevas inferencias. Un lock huérfano bloquea y requiere revisión humana; no se elimina automáticamente por antigüedad. La autorización histórica no reabre un ledger usado. El cierre durable es independiente del booleano de autorización del manifiesto.

Las escrituras usan exclusión, permisos privados, fsync de archivo/directorio y creación exclusiva o reemplazo atómico. Ningún mecanismo local garantiza protección frente al borrado deliberado de todas las evidencias, restauración de copias antiguas o fallo físico del disco.

Cada caso guardado produce además un checkpoint de informe con run ID, número de casos y estado, más SHA-256. Los informes están en `evals/reports/i006/`, ignorados por Git. No se sobrescriben. Los checkpoints son prefijos, no ejecuciones adicionales. Si falla un checkpoint, siguen existiendo el resultado y ledger previos; la ejecución se detiene y su recuperación exige revisión, sin repetir inferencias.

Códigos CLI: 0 para validación/identidad/inicialización satisfactorias o COMPLETE_PASSED; 2 para COMPLETE_FAILED; 1 para ejecución incompleta, configuración inválida o fallo técnico/persistencia. No se interpreta la ausencia de informe como ausencia de intentos.

## Trazabilidad histórica de fase 7 — revisión 5

| Criterio | Evidencia determinista                                       | Pendiente                                 |
| -------- | ------------------------------------------------------------ | ----------------------------------------- |
| AC-19    | Observación separada, IDs erróneos y solicitudes adicionales | Observación del protocolo con modelo real |
| AC-20    | Fórmulas, denominadores y penalizaciones verificadas         | Resultados reales                         |
| AC-21    | Parada, persistencia, incompletos y UNAVAILABLE previsto     | Ejecución real completa                   |
| AC-22    | Esquema, cuotas, fixtures y diez parejas                     | Ninguno: dataset v3 aprobado y congelado  |
| AC-23    | Puertas y estados independientes                             | Puerta experimental y aceptación humana   |
| AC-26    | Runner sobre caso de uso real, informes saneados separados   | Informes reales                           |

Esta tabla recoge la cobertura histórica de revisión 5, no acredita los criterios revisados en revisión 6. Durante la fase 7, AC-24 permaneció pendiente. Su cierre determinista se registra a continuación. Las pruebas con proveedores simulados no demuestran compatibilidad real de tools/format ni resistencia semántica a instrucciones maliciosas.

## Cierre de AC-24 — fase 8

**AC-24 cumplido mediante verificación determinista — 2026-11-17.** Este bloque no marca I006 Verified ni autoriza el siguiente bloque de la fase 8.

I002–I005 comparten `src/evaluation/run-evaluation.ts`, que ahora invoca directamente `classifier.classify(example.description.trim())`, conservando el contexto del método. Se elimina la sobrecarga temporal de `classifyIncident()` y la detección dinámica de dependencias; el cuerpo de la orquestación I006 permanece idéntico. HTTP y el runner I006 continúan usando exclusivamente esa orquestación.

Se mantienen `IncidentClassifier`, `OllamaClassifier`, las cuatro entradas históricas, prompts, esquemas, modelos, temperaturas, timeouts, normalización, concurrencia, ausencia de reintentos y políticas de errores. Las garantías pertinentes del test temporal se trasladan al runner histórico; el test de tipos rechaza la antigua firma de `classifyIncident()`. La reproducción histórica conserva el procedimiento, sin garantizar respuestas idénticas del modelo real.

Verificaciones: compilación TypeScript estricta; 71 tests afectados satisfactorios; `npm run verify` con **259/259 tests**, incluidos I002–I005, composición, HTTP, orquestación y evaluador I006. Las pruebas utilizan proveedores simulados. El dataset congelado conserva el SHA-256 registrado arriba; manifiestos, permisos y evidencias históricas no se modifican. En aquella verificación de AC-24 no se ejecutó Ollama real ni se creó ledger experimental. Las ejecuciones posteriores cerradas se registran a continuación.

## Ejecuciones históricas cerradas

Registro documental de los resultados ya aceptados, sin reescribir informes ni trasladarlos a revisión 6. Todos los permisos siguen desactivados. Los informes son privados y están excluidos de Git.

| Operación de 2026-11-17                               | Run ID                                 | Resultado                                                                                     | Intentos observados | Evidencia local                                                             |
| ----------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------: | --------------------------------------------------------------------------- |
| Smoke INC-142                                         | `36a12f6d-a1a8-47d5-8242-1e36d90f6dc1` | PASSED: llamada esperada, FOUND y BUG                                                         |                   2 | `evals/reports/i006-smoke/report.json`                                      |
| Experimento original, referencia I006-EXEC-2026-11-17 | `bdfb68d5-e828-4a7e-9c76-028a5c0e28b4` | INCOMPLETE: invalid_response en I006-001, 59 casos no intentados                              |                   1 | `evals/reports/i006/bdfb68d5-e828-4a7e-9c76-028a5c0e28b4-1-INCOMPLETE.json` |
| Primera inferencia independiente                      | `9c1458b2-33d3-4b87-a981-4ab3fdc4368a` | TECHNICAL_ERROR: invalid_response / FINAL_SCHEMA_INVALID                                      |                   1 | `evals/reports/i006-first-inference/report.json`                            |
| Compatibilidad tools + format                         | `2f34063e-1f17-46a1-82a7-a5cf0adda829` | COMPLETE_FAILED: A BUG válido; B QUESTION directa sin herramienta, continuación no ejercitada |                   2 | `evals/reports/i006-tools-format/report.json`                               |

Total observado de esos ámbitos independientes: seis inferencias. No es consumo de seis sobre el ledger original: este conserva un intento observado y dos slots reservados; los otros cinco son diagnósticos con controles propios. No existe derecho a consumir capacidades sobrantes.

El diagnóstico posterior no recupera la respuesta del intento original. La prueba de tools + format no demuestra causalidad de la ausencia de herramienta ni autoriza adoptarlos simultáneamente. Los textos y respuestas crudas no se conservaron; sus límites diagnósticos siguen vigentes.

## Protocolo de revisión 6 implementado — ejecución real pendiente

La [sección 13 normativa](../../specs/iterations/006-tool-calling.md#protocolo-de-revisión-6-dos-fases-por-caso) define el protocolo `I006-DECISION-CLASSIFICATION-V1`; las fórmulas y umbrales de esta guía siguen iguales.

- `decision`: una inferencia con herramientas nativas y sin format. Ausencia del campo `tool_calls` en un sobre válido implica `no_lookup`; no se usa ni persiste su texto. Array vacío sigue siendo solicitud inválida y se rechaza. No se extraen herramientas desde JSON textual.
- Backend: una consulta opcional validada, con resultado FOUND/NOT_FOUND/UNAVAILABLE según fixture. Se conserva el contenido como datos no confiables y la correlación necesaria.
- `classification`: segunda inferencia obligatoria si el recorrido puede continuar, sin herramientas y con el esquema final. Nueva conversación con instrucciones de clasificación y descripción original; añadir llamada nativa y resultado solo si hubo consulta, sin copiar texto de decisión.
- Un caso con resultado final usa dos inferencias; 60 resultados finales, 120, que es la cota de la pasada. Un error o rechazo anterior puede consumir menos, nunca se reintenta ni se libera su reserva. La segunda operación respeta el remanente de 90 s, no recibe automáticamente 45 s completos.
- Los informes v2 identifican protocolo, hashes de ambos prompts y fases separadas, intentos/estado de cada fase y fase del error saneada; mantienen observación de herramienta y resultado final. `no_lookup` no es abstención. No fabricar clasificación si la segunda fase no se ejecutó.
- Rechazos de política siguen siendo evaluables sin respuesta final ni abstención; los errores técnicos detienen la pasada y quedan fuera de E. Las solicitudes adicionales de la fase final penalizan el caso una vez. Registrar ambas fases para los 60 IDs, incluida clasificación no iniciada tras rechazo. Un rechazo de política conserva evaluabilidad y penalización; no se exige consumir 120 para aprobar si las reglas de 60 casos evaluables y umbrales se cumplen. No se cuentan dos unidades métricas por caso.
- La composición reutiliza runner, métricas y controles fail-closed, con manifiesto propio `evals/experiments/i006-decision-classification-manifest.json` desactivado y directorio privado previsto `evals/reports/i006-decision-classification/`. El directorio no se ha creado ni inicializado. No se reutiliza el ledger CLOSED ni se añaden opciones de bypass.
- Dataset v3, 60 IDs, categorías, grupos, fixtures y diez parejas permanecen byte a byte. «Directo» significa sin consulta, no una única inferencia. No se ajustará ground truth con resultados observados.

El [plan I006-R6-T-01–07](../../specs/iterations/006-tool-calling.md#17-plan-de-implementación-y-verificación-determinista) se ha implementado con adaptación de los tests que verificaban el atajo anterior y trazabilidad de los 26 AC. El número de tests no es directamente comparable al anterior: las pruebas de ejecución positiva de diagnósticos retirados se sustituyen por pruebas de rechazo permanente; sus versiones originales quedan en Git. AC-24 conserva su cierre histórico y exige nueva regresión determinista; no nuevas inferencias.

La aprobación arquitectónica no aprueba automáticamente nuevos prompts, identidad, implementación, inicialización, presupuesto operativo ni inferencias. Cualquier comparación futura distinguirá cambio de protocolo, dos instrucciones y latencia, sin presentar esta muestra sintética como representativa de producción.

### Persistencia y retirada de diagnósticos en revisión 6

El nuevo ledger utiliza esquema 2, protocolo explícito y fases READY/RUNNING/CLOSED. Antes del primer envío de cada caso reserva conservadoramente dos slots. Antes de **cada** envío persiste un registro exclusivo `<ID>-decision.json` o `<ID>-classification.json` con `RESERVED_POSSIBLE_DISPATCH` y actualiza duramente el ledger. `observedAttempts` cuenta esas reservas de intentos potencialmente enviados: no prueba por sí solo que Ollama recibiera la petición. No se devuelve capacidad por ausencia de respuesta. El informe distingue intentos de fase, resultados y causa segura del fallo; ante una interrupción se contrastan con los journals, sin deducir respuestas.

Inmediatamente antes de enviar se vuelven a comprobar autorización, código, configuración, marcador y bytes del ledger. El transporte protegido impide un tercer envío y envíos después del cierre o cancelación. Se espera el asentamiento de reservas pendientes manteniendo el lock. Un fallo de persistencia bloquea; puede impedir guardar un informe, pero no habilita repetición ni reanudación. Se conservan resultados y checkpoints ya durables. No hay recuperación automática de presupuestos ni garantías frente a borrado deliberado o restauración simultánea de todos los controles.

Los comandos `smoke:i006`, `diagnose:i006-first-inference` y `diagnose:i006-tools-format` están retirados bajo revisión 6, incluidos sus modos de comprobación. Rechazan con `I006_DIAGNOSTIC_RETIRED` antes de cualquier acceso a autorizaciones, reservas, proveedores o evidencias. Sus fuentes originales permanecen en Git; los informes, hashes y controles históricos no se modifican. Las utilidades de transporte reutilizadas no habilitan esas entradas ni conservan una segunda implementación productiva.
