# I006 — Dataset y runner de evaluación

Estado de esta entrega: fase 7 y revisión semántica aprobadas; dataset contenido v3 **aprobado y congelado** desde el **2026-11-17**, con estado operativo `APPROVED_FROZEN`. No hay resultados reales ni autorización para inferencias. La especificación normativa sigue siendo [I006, revisión 5](../../specs/iterations/006-tool-calling.md).

## Dataset congelado

[incidents-tool-calling-v1.json](../datasets/incidents-tool-calling-v1.json), esquema 1, contenido 3, ID `incidents-tool-calling-es-v1`. Su aprobación y congelación se registran en [i006-manifest.json](i006-manifest.json), referencia **`I006-DATASET-V3-FREEZE-2026-11-17`**, fecha **2026-11-17**. El archivo conserva exactamente sus bytes, incluido `reviewStatus: "CANDIDATE"`: el estado operativo se registra externamente como `APPROVED_FROZEN`, sin cambiar el esquema ni el contenido 3.

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

El runner invoca `classifyIncident()` con el adaptador I006 y el prompt productivo actuales. Observa los puertos sin cambiar los mensajes o ejecutar herramientas desde el adaptador. No usa HTTP ni el clasificador histórico.

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

## Comandos y autorizaciones

Validación local sin Ollama ni creación de controles:

```sh
npm run build
npm run eval:tool-calling -- --validate
```

Los siguientes comandos son procedimientos disponibles, **no autorizaciones para ejecutarlos**:

```sh
npm run eval:tool-calling -- --identity
npm run eval:tool-calling -- --initialize
npm run eval:tool-calling -- --execute
```

`--identity` solo lee metadatos de Ollama y archivos; no inicializa ni genera texto. `--initialize` y `--execute` son acciones separadas, desactivadas en `i006-manifest.json`. No existe ejecución implícita, `--force`, selección alternativa de dataset ni bypass mediante variables de entorno.

La revisión y congelación del contenido 3, su hash y su referencia humana ya están registradas. El dataset mantiene el marcador de candidato en sus bytes; su aprobación y congelación se registran externamente en el manifiesto (`APPROVED_FROZEN`) para no mutar los bytes aprobados. Antes de autorizar cualquier fase experimental falta aprobar su identidad efectiva y autorizar expresamente la fase correspondiente. El modelo y URL proceden de la configuración normal, pero deben coincidir con esa identidad aprobada. La referencia de congelación no es una autorización de ejecución: `initialize` y `execute` permanecen en `false`, `identityHash` permanece en `null` y el máximo sigue siendo 120 inferencias. No se ha creado ledger experimental.

El comando `--validate` conserva su comportamiento actual y muestra literalmente `PENDING_HUMAN_REVIEW`; esa etiqueta de presentación no refleja el estado operativo de congelación. Consultar el manifiesto y el hash aprobado para verificarlo.

La identidad incluye digest del modelo, versión de Ollama, hash de sus metadatos (incluidas plantillas y parámetros heredados), prompt efectivo, esquema y herramientas, configuración 45/5/90 y temperatura 0, referencia Git y fingerprint de fuentes, build y configuración del proyecto/lockfile. Se comprueba antes de cada caso. La evidencia de build+tests debe corresponder a esos archivos; el fingerprint detecta cambios, pero no demuestra por sí solo que un build anterior se compiló desde las fuentes actuales. El control de cambios del servicio/modelos durante una inferencia y el uso dedicado requieren disciplina operativa; no hay bloqueo del servidor Ollama.

## Presupuesto, persistencia e interrupciones

Una sola pasada admite hasta 120 inferencias, máximo dos por caso, en el orden del dataset. No hay warm-up, reintentos ni continuación automática. No se introducen escrituras de disco dentro de la operación productiva temporizada.

Los controles se guardan bajo `evals/reports/i006/controls/`:

- `initialized.json`: marcador persistente de primera inicialización.
- `initialization-authorization.json` y `execution-authorization.json`: snapshots de aprobaciones.
- `budget.json`: fase READY/RUNNING/CLOSED, run ID, reserva pendiente, slots reservados y llamadas observadas.
- Un JSON por caso completado, sin contenido sensible.
- `budget.lock`: exclusión entre procesos durante toda la operación.

Se reservan dos slots durables antes de cada caso. `reservedSlots` expresa la cota autorizada comprometida; `observedAttempts` cuenta las invocaciones observadas, incluidas las fallidas. Una reserva sin resultado significa hasta dos intentos potenciales inciertos, nunca cero. Los slots no se liberan ni reutilizan para repetir casos.

La continuación requiere ledger existente y READY vacío. Un estado RUNNING/CLOSED, pendiente, corrupto, desaparecido o incompatible bloquea. La inicialización rechaza controles o informes previos; no reconstruye presupuestos desde informes. Un fallo de persistencia detiene nuevas inferencias. Un lock huérfano bloquea y requiere revisión humana; no se elimina automáticamente por antigüedad. La autorización histórica no reabre un ledger usado. El cierre durable es independiente del booleano de autorización del manifiesto.

Las escrituras usan exclusión, permisos privados, fsync de archivo/directorio y creación exclusiva o reemplazo atómico. Ningún mecanismo local garantiza protección frente al borrado deliberado de todas las evidencias, restauración de copias antiguas o fallo físico del disco.

Cada caso guardado produce además un checkpoint de informe con run ID, número de casos y estado, más SHA-256. Los informes están en `evals/reports/i006/`, ignorados por Git. No se sobrescriben. Los checkpoints son prefijos, no ejecuciones adicionales. Si falla un checkpoint, siguen existiendo el resultado y ledger previos; la ejecución se detiene y su recuperación exige revisión, sin repetir inferencias.

Códigos CLI: 0 para validación/identidad/inicialización satisfactorias o COMPLETE_PASSED; 2 para COMPLETE_FAILED; 1 para ejecución incompleta, configuración inválida o fallo técnico/persistencia. No se interpreta la ausencia de informe como ausencia de intentos.

## Trazabilidad de fase 7

| Criterio | Evidencia determinista                                       | Pendiente                                 |
| -------- | ------------------------------------------------------------ | ----------------------------------------- |
| AC-19    | Observación separada, IDs erróneos y solicitudes adicionales | Observación del protocolo con modelo real |
| AC-20    | Fórmulas, denominadores y penalizaciones verificadas         | Resultados reales                         |
| AC-21    | Parada, persistencia, incompletos y UNAVAILABLE previsto     | Ejecución real completa                   |
| AC-22    | Esquema, cuotas, fixtures y diez parejas                     | Ninguno: dataset v3 aprobado y congelado  |
| AC-23    | Puertas y estados independientes                             | Puerta experimental y aceptación humana   |
| AC-26    | Runner sobre caso de uso real, informes saneados separados   | Informes reales                           |

AC-24 no se modifica en esta fase. I002–I005 conservan sus archivos y procedimientos históricos. Las pruebas con proveedores simulados no demuestran compatibilidad real de tools/format ni resistencia semántica a instrucciones maliciosas.
