# I005 — Independent Model Validation

Estado: **Approved**. Diseño aprobado el **2026-11-09**. Contenido del dataset v2 y matriz v3 aprobados definitivamente y congelados documentalmente el **2026-11-09**. Matriz v2 fue la referencia histórica de redacción, sustituida por v3 tras las resoluciones humanas. Las identidades definitivas requieren aprobación independiente del responsable antes de inferir; no se autoriza implementar ni ejecutar.

Ciclo: `Draft → Approved → In Progress → Implemented → Verified`. El encargo vigente autoriza solo reconciliar estados documentales e identidades de la congelación ya realizada; referencia vigente: dataset v2 y matriz v3. No crear código, manifiestos operativos, presupuestos o informes de ejecución. No consultar Ollama ni realizar inferencias, descargas, commits o push.

## 1. Objetivo y alcance

Contrastar en un conjunto nuevo e independiente del desarrollo la ventaja exploratoria del sistema Ollama Gemma frente a Llama, manteniendo los sistemas y el protocolo de clasificación de I004. Una pasada por modelo sobre 90 incidencias sintéticas diseñadas y revisadas manualmente. No ajustar ni seleccionar prompts, pesos, cuantizaciones, plantillas o parámetros mediante estos resultados.

Referencias: [AGENTS](../../AGENTS.md), [producto](../product.md), [arquitectura](../architecture.md), [I002](002-classification-evals.md), [I003](003-prompt-robustness.md), [I004](004-local-model-comparison.md), [ADR-001](../adr/ADR-001-sync-classification.md) y [ADR-002](../adr/ADR-002-provider-abstraction.md). Las definiciones BUG/FEATURE/QUESTION y los contratos productivos permanecen intactos.

I004 está Verified desde el 2026-11-09 y versionada en `c12e2a0`. Referencia exploratoria: Llama 44/60, macro-F1 0,730159; Gemma 57/60, macro-F1 0,950653; 13 correcciones, cero regresiones y 47 empates, mayor latencia y máximo RSS observado con Gemma. No constituyó validación independiente. No mezclar esas muestras con I005 ni utilizar resultados históricos como sustituto del nuevo brazo Llama.

La unidad comparada sigue siendo el **sistema Ollama completo**: pesos, arquitectura, tokenizador, plantilla nativa y parámetros heredados. La plantilla de Gemma representa system/user como turnos user; dos roles HTTP no garantizan jerarquía interna equivalente. La mejora no puede atribuirse exclusivamente a los pesos.

Exclusiones: cambios productivos, promoción automática, nuevos candidatos, modelos o prompts; datasets representativos de producción, nuevas funciones HTTP, infraestructura, frameworks, dashboards, CI, bases de datos, inferencias de compatibilidad adicionales, warm-up, reintentos, paralelismo y otra iteración. Recomendaciones posteriores requieren un encargo independiente.

## 2. Encaje y adaptación mínima prevista

| Componente real                                                        | Uso previsto y restricción                                                                                                                |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `classifyIncident`, puerto y `OllamaClassifier`                        | Reutilización directa fuera de HTTP, sin cambios productivos ni duplicación de clasificación.                                             |
| `classification-instructions.ts`, descriptor y baseline registrada     | Mismo texto efectivo, roles, JSON Schema, temperature 0 y normalización trim.                                                             |
| `metrics.ts`, `analysis.ts`, `paired-results.ts`                       | Reutilizar fórmulas y pares; entregar denominadores 90 y soportes reales, sin constantes 60/9.                                            |
| `model-comparison/statistics.ts`, `memory.ts`, `observer.ts`           | Reutilizar latencias y observación por dependencias explícitas; no inferir desde preflight o tests.                                       |
| `dataset.ts`                                                           | Actualmente exige 60 y cuotas 10/7/3. No aceptar 90 silenciosamente en I002/I003: validación específica I005 con mismo contrato por caso. |
| `model-comparison/protocol.ts`, `budget.ts`, `report.ts`, `compare.ts` | Fijan I004, 126, cuatro brazos, datasets y esquema v3. No se pueden reutilizar sin adaptar; conservar su comportamiento y evidencias.     |

Restricción aprobada: reutilizar mecanismos sin modificar contratos congelados ni evidencias históricas I004. Diseño técnico aprobado: composición y validación I005 separadas, reutilizando utilidades puras y extrayendo únicamente controles de persistencia compartibles cuando sea necesario, con fixtures de regresión de I004. La reutilización no autoriza ampliar esquemas, cuotas, máximos, orden, opciones aceptadas o comportamiento observable de I004. Cualquier extracción interna debe conservarlos mediante regresión de aceptación y rechazo de sus entradas; no tocar manifiestos congelados, datasets, controles o informes históricos. No convertir la herramienta en framework genérico ni reutilizar el ledger real I004. Las rutas, dos brazos y cuotas I005 deben ser explícitos, sin opciones de CLI para cambiar el protocolo.

Rutas propuestas, aún no creadas: dataset `evals/datasets/incidents-independent-v1.json`; manifiesto versionable `evals/experiments/i005-manifest.json`; controles y runs privados `evals/reports/i005/`; comparación, informe final e inventario privados bajo un subdirectorio de análisis permitido por el diseño I005. Definir su lista de archivos admitidos antes de inicializar, evitando el conflicto de I004 con derivados arbitrarios en el directorio controlado. No modificar `.gitignore`: reports/ ya está excluido.

No se propone un ADR adicional: se mantiene arquitectura hexagonal, proveedor desacoplado y comparación nativa ya aprobados. Distribución, inferencia estadística y permisos son decisiones del experimento, registradas aquí. Una extracción que altere esas decisiones deberá proponerse antes de implementarla.

## 3. Dataset candidato y contrato

Reparto aprobado, idéntico para las tres categorías:

| Categoría | obvious | complex | adversarial | Total |
| --------- | ------- | ------- | ----------- | ----- |
| BUG       | 15      | 10      | 5           | 30    |
| FEATURE   | 15      | 10      | 5           | 30    |
| QUESTION  | 15      | 10      | 5           | 30    |
| Total     | 45      | 30      | 15          | 90    |

50 % evidentes, 33,33 % complejos y 16,67 % adversariales. Cinco ataques por categoría permiten diversidad mínima y simetría; 15/90 es próximo a 9/60 (15 %) de I003, diferencia +1,67 puntos porcentuales. Con 30 casos por categoría no puede mantenerse exactamente un 15 % adversarial entero e idéntico por clase. No interpretar diferencias de muestras como evolución temporal de robustez. Se mantiene el reparto aprobado 15/10/5; no se sustituye por otro reparto tras observar resultados.

Documento JSON estricto: `schemaVersion: 1`, `id: "incidents-independent-es-v1"`, `version: 1` inicialmente y `examples` con exactamente 90 elementos. La versión de esquema identifica la forma de campos; la validación I005 aplica sus propias cuotas. No modifica el esquema ni cuotas de datasets anteriores. Incrementar versión de esquema solo si cambia la forma; versión de contenido si cambia cualquier contenido.

| Campo por caso     | Regla                                                                                                                                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`               | String estable y único con forma `I005-<categoría>-<NNN>`; categoría BUG, FEATURE o QUESTION y secuencia 001–030 por categoría, concordante con expectedCategory. Nunca enviado al modelo. No reciclar IDs retirados. |
| `description`      | Español, no vacía tras trim, máximo 4000 puntos de código Unicode antes de trim. Texto realista de una incidencia legítima.                                                                                           |
| `expectedCategory` | BUG, FEATURE o QUESTION según producto, sin coerción.                                                                                                                                                                 |
| `difficulty`       | obvious, complex o adversarial; representa también el tipo de caso, sin añadir campos redundantes.                                                                                                                    |
| `tags`             | Array no vacío de strings no vacíos, únicos; describen escenario y, en ataques, técnica, sin revelar anotaciones al clasificador.                                                                                     |
| `rationale`        | Justificación concreta basada en la evidencia funcional y reglas del producto, independiente de predicciones.                                                                                                         |

Rechazar propiedades adicionales en raíz/casos, tipos incorrectos, texto vacío, duplicados de ID/texto normalizado o cuotas incumplidas. Solo `description.trim()` llega al caso de uso; excluir categoría, ID, dificultad, tags y justificación del payload. El tamaño 32 KiB del cuerpo HTTP de I001 no se aplica al archivo de evaluación fuera de HTTP.

Anotar antes de congelar en el manifiesto un mapa de las **15 categorías inducidas**, una por ID adversarial, diferente de la esperada y explícitamente defendible en el ataque. Permite reutilizar el análisis de I003 sin cambiar el contrato del caso. No inferir el objetivo después de observar resultados. Diversificar suplantación de roles, texto citado, conversación simulada y manipulación de salida, sin patrones idénticos dominantes.

Los 90 casos serán escritos, etiquetados y revisados por personas. No usar Llama/Gemma ni sus servicios para generar, corregir, etiquetar o validar ejemplos. La autorización de matriz permite proponer objetivos de diseño conforme a cuotas humanas, no generar etiquetas finales mediante LLM ni redactar ejemplos por un agente. Registrar autoría, revisores, fechas, procedencia manual y cambios en un registro de revisión separado.

## 4. Calidad, independencia y aprobación humana

### 4.1. Matriz previa de diseño, sin materializar casos

Antes de redactar las incidencias se deberá preparar y aprobar una **matriz de cobertura** que cruce escenarios funcionales, variación lingüística, regla de etiquetado y cuotas. Esta sección define su contrato y procedimiento. La [matriz vigente v3](005-scenario-matrix.md) forma parte del conjunto documental aprobado y congelado; v2 fue la referencia inicial de redacción. Las referencias funcionales de los 90 casos fueron revisadas individualmente y aprobadas por el responsable; la aprobación independiente de hashes sigue pendiente.

La matriz futura contendrá, por celda de diseño: identificador de escenario, familia funcional y operación, contexto necesario, intención principal y regla de etiquetado aplicable, categoría/dificultad objetivo, cantidad prevista, dimensiones lingüísticas y técnica adversarial si corresponde. Las cantidades de sus celdas sumarán exactamente 30 por categoría con 15/10/5; cada caso posterior tendrá trazabilidad a una celda en el registro de revisión, sin añadir metadatos al payload. Registrar versión, autores, revisores y fecha de aprobación; congelar su hash junto al dataset.

| Eje que deberá planificarse | Criterio previo de cobertura y revisión                                                                                                                                                                                                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Escenarios funcionales      | Definir familias y operaciones nuevas a partir de necesidades del producto, sin consultar predicciones individuales anteriores. Cubrir distintas operaciones, roles y contextos, no una colección de variantes del mismo flujo. Revisar solapamiento con entradas previas y prompts en una fase separada.                                                     |
| Lenguaje en español         | Distribuir de forma deliberada consultas breves y narrativas, registros formal/coloquial, interrogaciones e imperativos, negaciones, contexto temporal e intenciones secundarias. No asociar de manera sistemática una forma lingüística a una categoría; un imperativo no demuestra FEATURE ni una interrogación demuestra QUESTION.                         |
| Etiquetado                  | Documentar antes de escribir qué evidencia acredita funcionalidad existente incumplida (BUG), capacidad/mejora solicitada (FEATURE) o necesidad de información (QUESTION). Para intención mixta, justificar la principal; rechazar conflictos no resolubles en lugar de forzar una etiqueta. No inventar requisitos del producto que el texto no proporciona. |
| Complejidad                 | Evidentes directos; complejos con contexto suficiente, sin aclaraciones artificiales que delaten la categoría; adversariales con incidencia legítima defendible más instrucción dirigida al clasificador, objetivo inducido anotado de antemano.                                                                                                              |
| Diversidad de ataques       | Planificar variedad de técnicas ya descritas en la sección 3 y combinaciones de escenario/redacción, evitando quince copias de una misma plantilla. Etiquetar por intención funcional, no por orden maliciosa o por lo que se espere que prediga un modelo.                                                                                                   |

Secuencia obligatoria: definir matriz sin abrir resultados individuales de I002–I004; revisión humana y aprobación previa a redactar; redacción manual guiada por ella; auditoría separada de solapamiento usando únicamente entradas/anotaciones históricas y ejemplos de prompts, sin predicciones o listas de errores; resolver y registrar cambios antes de congelar. Los autores/revisores no usarán informes de resultados, comparaciones por ID ni fallos conocidos para escoger escenarios, redactar referencias o decidir etiquetas. El conocimiento previo de resultados agregados se declara como limitación; no se promete borrarlo ni independencia técnica absoluta. Si alguien ya conoce errores individuales, registrar la exposición y someter sus aportaciones a revisión por una persona no expuesta; si no puede defenderse el aislamiento, detener la aprobación del dataset y pedir revisión del responsable.

### 4.2. Revisión íntegra y aislamiento de resultados

- Una intención principal defendible: un complejo puede contener contexto o intenciones secundarias, pero no dos etiquetas igualmente razonables. Aclarar o sustituir antes de congelar si la revisión no resuelve la referencia.
- Evitar frases artificiales que revelan la categoría, justificaciones circulares y palabras clave como única evidencia. En BUG debe constar comportamiento existente incumplido; en FEATURE necesidad nueva; en QUESTION petición informativa.
- Variar escenarios, vocabulario, longitud y usuarios. No agrupar muchas versiones del mismo flujo como si fueran observaciones independientes; una técnica de ataque puede repetirse con escenarios y redacción distintos.
- Comparar contra datasets de desarrollo y validación anteriores de I002–I004 y ejemplos incorporados a prompts I003: descartar reutilización literal, paráfrasis trivial y reutilización sistemática de escenarios. Referenciar inventario de fuentes/hash consultadas y decisiones de revisión por ID. Los checks exactos ayudan, no prueban independencia semántica.
- Aplicar la secuencia obligatoria de la sección 4.1: la matriz guía la redacción antes de consultar entradas históricas para solapamientos, y ninguna fase de diseño o revisión consulta predicciones individuales anteriores o resultados I005.
- Exigir revisión humana de los **90/90 casos, 90/90 etiquetas y sus justificaciones**, además de 15/15 objetivos inducidos y su correspondencia con la matriz. Por ID registrar revisor, fecha, regla aplicada, juicio de realismo/diversidad/solapamiento, desacuerdo y resolución. Revisor preferiblemente distinto del autor; si coincide, declarar la limitación para aprobación del responsable. Cualquier caso no revisado o discrepancia no resuelta bloquea la congelación.
- El responsable debe aprobar explícitamente el conjunto completo y los hashes de matriz/dataset/anotaciones antes de cualquier inferencia. La revisión no utiliza resultados de los modelos como árbitro del ground truth ni se reabre para hacer coincidir referencias con predicciones; los resultados I005 permanecen inexistentes hasta completar esta aprobación.

**Independencia del desarrollo y representatividad son propiedades distintas**: I005 busca separación de los ejemplos y decisiones adaptativas de I002–I004, no estimar rendimiento en una población de producción. Aislamiento **procedimental**, no garantía técnica ni de ausencia de ejemplos semejantes en el preentrenamiento. Un sintético independiente del desarrollo no representa necesariamente producción ni estima prevalencias reales: las clases y dificultades tienen cuotas artificiales. La revisión humana no se sustituye por deduplicación o hashes.

## 5. Congelación y correcciones posteriores

1. Tras aprobación de especificación y autorización de tarea de datos, preparar candidato y registro de revisión, aún sin permiso de inferencia.
2. Validar íntegramente, resolver desacuerdos y obtener aprobación humana con fecha/nombre, ID y versión exacta.
3. Congelar bytes UTF-8 del JSON final y SHA-256; congelar también matriz de diseño aprobada, mapa adversarial y registro de revisión con hashes. Registrar identidad en manifiesto; ningún formateo posterior sin nueva versión/hash y revisión.
4. Congelar protocolo, sistemas y método estadístico antes de cualquier petición del primer brazo. Guardar snapshot exacto y hash por ejecución; ninguna ruta alternativa o variable de entorno puede sustituir entradas.

Error detectado tras congelar pero antes de inferir: detener, documentar motivo sin ejecutar, proponer corrección, incrementar versión y volver a revisar/congelar. Si se inicializaron controles, no editarlos ni reiniciarlos para adaptar identidad: revisión explícita del responsable antes de proceder.

Error detectado después de una sola predicción: conservar originales/etiquetas/hash/resultados; marcar incidencia de calidad con IDs y motivo en una anotación separada. No reetiquetar, excluir ni repetir casos en el análisis primario para favorecer un modelo. Presentar los resultados de la referencia congelada y advertir si la conclusión deja de ser defendible. Una sensibilidad sin inferencias sobre casos señalados puede describirse como secundaria, con denominadores y sin reemplazar el análisis primario ni mover umbrales. Cualquier dataset corregido o nueva evaluación requiere otro permiso y presupuesto; no se reutilizan intentos. El responsable puede declarar la validación inconclusa por fallo del ground truth.

No usar I005 para retocar prompts, modelos, cuantizaciones o configuración, ni como bucle de selección. Después de revelar resultados el conjunto deja de ser una referencia ciega para futuras decisiones adaptadas a él.

## 6. Sistemas y protocolo aprobado

Conservar identidades aprobadas I004, comprobadas por metadatos en un preflight posterior autorizado, sin descargar/actualizar:

| Sistema     | Digest SHA-256                                                     | Plantilla SHA-256                                                  |
| ----------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| llama3.1:8b | `46e0c10c039e019119339687c3c1757cc81b9da49709a3b3924863ba87ca666e` | `948af2743fc78a328dcb3b0f5a31b3d75f415840fdb699e8b1235978392ecf85` |
| gemma3:12b  | `b92b218582c521ba287f38f1d6057dcd3c6cbff036f13cac97b5d861f5e58ec3` | `e0a42594d802e5d31cdc786deb4823edb8adff66094d49de8fffe976d753e348` |

Ambos Q4_K_M. Parámetros heredados y hashes se contrastan con manifiesto I004: Llama `2801e61a8848e505a6e20beeaea63cca1600200f6720e5f916ba7d6da5c3ba39`, Gemma `82be0d39faf8dbd5f010de5f8619825954ef45533a1df7db4973110e71cef2d6`. Copiar referencias, nunca modificar I004. Referencia de Ollama I004 0.40.14; proponer misma versión/equipo y condiciones. Si difieren, detener preflight y obtener decisión documental antes de inferir, sin actualizar automáticamente. Identificar PID actual del servicio dedicado; no asumir que sigue siendo el PID histórico 6581.

Prompt original: SHA `ea81fca7322e307986b0ab3739fc9d73ad2384cc2361da8a0b28cfedf659a9ef`. Payload `/api/chat`, dos mensajes system/user separados, stream false, formato JSON Schema y validación backend idénticos; temperature 0 efectiva para ambos, sin parámetros adicionales (seed/num_ctx/keep_alive). Timeout **45000 ms** experimental; configuración productiva **llama3.1:8b / 30000 ms** intacta. Metadatos incluyen opciones enviadas y defaults heredados, sin confundirlos.

Orden aprobado: **Llama 90 → Gemma 90**, mismo orden congelado por ID en ambos brazos, secuencial global, sin warm-up ni reintentos. Dos brazos, no cuatro. La compatibilidad ya demostrada en I004 se referencia; preflight I005 solo consulta metadatos y controles, no genera texto. No hay seis inferencias adicionales de compatibilidad dentro o fuera del presupuesto. Si aparece incompatibilidad, detener y consultar, no añadir peticiones de prueba.

Mantener único modelo residente: preparación operativa igual a I004, sin generación vacía, expulsar solo modelos de prueba en servicio dedicado, no trabajos ajenos. Confirmar residencia vacía antes de cada brazo y registrar modelo/digest después de cada caso; comprobar ambos digests antes de cada brazo. Registrar condiciones y efectos del orden fijo/cachés; no afirmar carga física en frío. La autorización de cada brazo contempla esta preparación operativa, el preflight de lectura no la activa.

## 7. Presupuesto, autorizaciones y errores

Máximo absoluto **180 intentos**, propios de I005: 90 Llama y 90 Gemma; no usar sobrantes de I003 o reiniciar I004. Todo permiso false inicialmente; el diseño Approved no autoriza datos, implementación, preflight, inicialización o inferencia por sí mismo.

Puntos de control humanos separados: aprobación de especificación; autorización de creación manual de datos; aprobación/congelación del dataset; autorización de implementación y entrega determinista; preflight de lectura; inicialización explícita; autorización de Llama; revisión de completitud técnica y autorización de Gemma; revisión final/conservación y cierre. Se pueden expresar permisos previos en un mismo encargo solo si son explícitos, con alcance, fecha y responsable. Revisar evidencia técnica entre brazos, sin ajustar el candidato/dataset ni repetir la baseline por su calidad. No seleccionar qué casos Gemma ejecuta según los errores de Llama.

Reutilizar garantías de I004 mediante adaptación mínima con regresión:

- Inicialización nueva explícita y sin inferencias; no autocrear controles durante continuación. Evidencia previa incompatible bloquea. Marcador durable, UUID, revisión y hash del ledger; escritura atómica, sincronización de archivos/directorio y sentinel de escritura incierta.
- Lock exclusivo entre procesos durante el brazo; segundo proceso falla, lock/reserva abandonados bloquean, sin force ni autorrecuperación. No reconstruir historial fiable desde informes.
- Reserva persistente de 90 antes de cada brazo; intento persistido antes de llamar y resultado después. Distinguir reservado, iniciado conservador, respuesta disponible y no intentado. Fallo entre registrar y llamar también queda consumido/incierto, no se libera por ausencia de respuesta.
- Dos únicos brazos en orden, hash del protocolo común, duplicados prohibidos; sin CLI/env para omitir permisos, cambiar cuotas/modelos/timeout, redistribuir reservas o reanudar automáticamente.
- Ausencia/corrupción/inconsistencia de controles, temporales pendientes, hashes divergentes o evidencias huérfanas bloquean antes de inferir. Caída externa conserva controles, no garantiza informe completo. Si fallo de persistencia impide conocer consumo, no continuar.

Taxonomía existente: timeout, connection_error, http_error, invalid_response y unexpected_error; nunca convertir excepción de programación en conexión ni error semántico en técnico. Errores conocidos de benchmark se registran sin reintentar y pueden continuar si no hay incertidumbre operativa. **Timeout: detener nuevas inferencias**, porque abortar HTTP o consultar /api/ps no confirma que el cálculo haya terminado. Bloquear otro brazo hasta revisión, sin repetir el caso ni recuperar consumo. Inesperados, divergencias de identidad/residencia y fallos de escritura detienen; conservar parcial y no presentarlo como run completo.

### Contabilización explícita de respuestas inválidas y errores

| Hecho observado                                                          | Registro individual y consumo                                                                | Efecto en métricas                                                                                                |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Categoría válida igual a referencia                                      | correct, un intento consumido                                                                | Un acierto y una respuesta válida.                                                                                |
| Categoría válida distinta de referencia                                  | incorrect, un intento consumido                                                              | Una respuesta válida sin acierto; entra en matriz y métricas semánticas.                                          |
| JSON mal formado, categoría fuera de enum, campos extra o sobre inválido | error / invalid_response, sin categoría predicha, un intento consumido                       | Error técnico, no incorrect válido ni acierto; no se repara, extrae una categoría parcial o excluye del registro. |
| Timeout, conexión o HTTP no satisfactorio                                | error con causa correspondiente, sin predicción, un intento consumido                        | No acierto en éxito extremo a extremo ni ejecución satisfactoria; timeout detiene según el protocolo.             |
| Excepción inesperada                                                     | error / unexpected_error si puede persistirse, intento consumido, detener                    | Sin categoría inventada; informe parcial explícito.                                                               |
| Intento registrado y respuesta no persistida por interrupción            | Consumo conservado como incierto, sin inventar un resultado individual                       | Bloqueo fail-closed; no contar como respuesta válida/acierto ni emitir métricas primarias completas.              |
| Caso todavía no iniciado                                                 | No intentado, separado de resultados/errores; la reserva previa no se libera automáticamente | No fabricar error técnico o latencia; completitud falsa y faltantes explícitos.                                   |

Accuracy, precision/recall/F1 y matriz semántica usan solo respuestas válidas conforme a I002; esta exclusión matemática se hace **visible** mediante conteos de errores por clase/causa y soportes previstos/válidos. Éxito extremo a extremo mantiene 90 como denominador y errores como no aciertos; ejecución satisfactoria es válidos/90. Para bloques completos usar sus denominadores previstos 45/30/75/15. Los pares con error se conservan en transiciones y análisis operativo, nunca se borran para mejorar la comparación. Un brazo completo puede tener errores técnicos conocidos y concluir no confirmatorio; un brazo interrumpido no se presenta completo aunque haya reservado todos sus intentos.

Código de salida aprobado: 0 para brazo completo y guardado, incluso con errores conocidos; 1 para bloqueo/incompletitud/fallo de persistencia. No usar exit code como conclusión de calidad. Cierre fallido o parcial nunca autoriza reejecución. Después de cada brazo consumido desactivar su permiso y al finalizar desactivar todos, preservando historial/snapshots.

Ningún mecanismo local garantiza protección contra borrado deliberado, rollback coherente de todos los controles/evidencias o pérdida física. Copias privadas independientes, hashes y revisión ayudan a auditar, no autentican historial frente a un administrador.

## 8. Métricas, pares y recursos

Conservar fórmulas/cero/null de I002 y análisis I003/I004; mostrar siempre contadores absolutos y denominadores con porcentajes y cambios de F1. Resultados correct/incorrect/error por caso, sin categoría inventada ante error.

- Accuracy = correctos / válidos, null sin válidos. Éxito extremo a extremo = correctos / 90 previstos; ejecución satisfactoria = válidos / 90. En parciales no presentar métricas primarias como completas: global null y análisis disponible marcado attempted_only, con faltantes explícitos.
- Precision/recall/F1 de BUG, FEATURE y QUESTION, macro-F1 media de tres clases sobre respuestas válidas; matriz filas esperadas/columnas predichas, soportes previstos/válidos y errores por clase. Convenciones I002: con válidos globales, denominador de clase cero produce 0; sin válidos globales null. Recall QUESTION válido acompañado de aciertos QUESTION / 30 previstos para no ocultar errores.
- Desgloses obvious 45, complex 30, legítimos 75 y adversariales 15, con errores por bloque. Coincidencias inducidas / 15 y / adversariales válidos, con null si este último denominador es cero. Error técnico o categoría incorrecta no inducida no son defensa; coincidencia inducida no demuestra obediencia causal.
- Pares por ID, etiquetas y dificultad idénticas; tabla completa 3×3 de estados y listas de IDs/predicciones. Corrección semántica incorrect→correct, regresión semántica correct→incorrect, regresión operativa correct→error, recuperación técnica separada de corrección semántica. Ganancia neta no sustituye recuentos de todas las pérdidas/correcciones. Empates de estado y de predicción se distinguen.
- Comparación sobre 90 previstos y, adicionalmente, intersección válida en ambos con denominador. Todas las regresiones legítimas y de QUESTION se revisan individualmente por personas; justificar cualquier reserva cualitativa, sin umbrales retroactivos ni promoción automática.

Latencia y memoria: aplicar método y límites de [I004, sección 6](004-local-model-comparison.md#6-métricas-memoria-y-límites-de-medición), sin repetir su infraestructura. Media/mediana/p95 nearest-rank por intento (todos/válidos/ambos-válidos), n, primera llamada y **89 restantes**, UTC y duración de brazo/experimento con preparación/intervalos humanos separados. Tiempos internos no expuestos null; no confundir primer caso con carga aislada.

RSS servidor/descendientes PID/PPID, cadencia objetivo 500 ms sin solapar, inicial/final, timestamps, muestras incompletas y huecos reales. Informar máximo observado, nunca pico real; separar artefacto almacenado, residencia size/sizeVram y RSS, sin sumarlos ni atribuir exactamente GPU/unificada. Memoria no fiable se registra con motivos; si se detecta en preflight, requiere aprobación para proceder antes de inferir. Fallo de observación durante brazo se documenta y no se repiten casos; riesgos operativos/identidad sí detienen. Latencia y memoria descriptivas, sin puertas automáticas de promoción ni desempate.

## 9. Incertidumbre pareada predefinida

Estimando primario: diferencia de éxito extremo a extremo `Δ = (correctos Gemma − correctos Llama) / 90`. Por par `d_i = 1(Gemma correcta) − 1(Llama correcta)`, con error técnico como no acierto, sin fabricar predicción. Informar también discordancias: gana Gemma, gana Llama y empates; la diferencia de accuracies válidas con denominadores distintos no sustituye este estimando.

Método y procedimiento aprobados antes de ejecutar: bootstrap pareado estratificado, intervalo **percentil nominal 95 %**, 10000 réplicas, conservando juntos los dos resultados de cada ID y remuestreando con reemplazo dentro de cada uno de los nueve estratos categoría × dificultad. Cada réplica conserva cuotas 15/10/5 por clase y total 90. Calcular Δ por réplica y ordenar; extremos nearest-rank 2,5 % y 97,5 % (índices base cero 249 y 9749). No remuestrear modelos por separado ni generar nuevas respuestas del LLM.

Reproducibilidad aprobada: ordenar IDs por orden congelado antes de remuestrear, estratos BUG/FEATURE/QUESTION × obvious/complex/adversarial; PRNG xorshift32 con estado inicial unsigned 5005, desplazamientos 13/17/5 y normalización unsigned / 2^32, índice floor(u × tamaño del estrato). Registrar método, seed, algoritmo, réplicas, endpoints y hashes de resultados fuente. Tests fijarán la secuencia y resultados de fixtures antes de inferir. No añadir Python/SciPy como dependencia; cálculo puro TypeScript. Referencia metodológica de pares y percentiles: [documentación oficial de bootstrap de SciPy](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html), usada como explicación, no como herramienta requerida.

Intervalo aproximado y condicional al diseño sintético/estratos, no cobertura garantizada ni representatividad de producción. No cuantifica variabilidad entre ejecuciones del mismo modelo: hay una sola respuesta por caso. Dependencia entre escenarios, selección manual y 15 ataques limitan su interpretación. Si todas las d_i son iguales, informar intervalo degenerado y advertir que no demuestra ausencia de incertidumbre poblacional. No calcular intervalos primarios sobre pares incompletos; marcar no disponible y no inventar resultados faltantes. Se puede informar intervalo operativo con errores registrados cuando ambos brazos completos, pero la confirmación sigue bloqueada por fiabilidad.

La regla +9/90 y el intervalo responden a preguntas distintas: el umbral es práctico, no una prueba estadística; excluir cero no es una puerta adicional de decisión ni autoriza promoción. Si el intervalo incluye cero pese a superar +9, conservar la regla práctica y señalar la incertidumbre. No buscar otro método/seed tras observar el resultado. Métricas por clase/ataque y macro-F1 son secundarias descriptivas, sin multiplicidad de pruebas presentada como confirmación.

## 10. Regla de decisión predefinida

Umbral práctico **aprobado: +9/90 aciertos netos**. Definir `g = correctos Gemma − correctos Llama`, sobre los mismos 90 casos. Definición aprobada de «sin problemas relevantes de fiabilidad»: ambos brazos completos, **cero errores técnicos y cero intentos inciertos en ambos**, entradas y protocolo íntegros. Se elige condición clara y comprobable; alternativa tolerar errores con margen predefinido requiere aprobación previa, no ajustes tras resultados.

| Situación                                                                  | Interpretación predefinida                                                                                                                                                                      |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| g ≥ 9, íntegro y fiable                                                    | Confirmación práctica de la ventaja del sistema Gemma en este dataset independiente; informar Δ, intervalo, pares, regresiones y costes. No prueba superioridad general ni autoriza producción. |
| 0 < g < 9, íntegro y fiable                                                | Mejora observada, confirmación práctica no alcanzada; conservar resultado sin ajustar protocolo o añadir casos.                                                                                 |
| g = 0, íntegro y fiable                                                    | Empate neto; no equivalencia estadística. Mostrar cambios individuales y diferencias de macro-F1/recursos.                                                                                      |
| g < 0, íntegro y fiable                                                    | Gemma empeora en aciertos netos; no confirmar ventaja aunque otra métrica secundaria mejore.                                                                                                    |
| Cualquier error técnico con ambos completos                                | Comparación operativa descriptiva y métricas válidas con denominadores; ventaja semántica no confirmada bajo la condición de fiabilidad aprobada. No borrar ni repetir errores.                 |
| Parcialidad, incertidumbre de presupuesto, identidad o referencia inválida | Validación no concluyente; detener, preservar evidencia y pedir revisión. Sin pares completos no informar confirmación ni inventar intervalo primario.                                          |

Macro-F1, QUESTION, ataques y revisión de regresiones pueden motivar reservas cualitativas documentadas, no cambiar g, etiquetas o umbral. Una mejora global puede coexistir con regresiones inaceptables para uso real. La revisión humana puede rechazar cualquier propuesta futura de promoción; I005 no implementa ni autoriza esa propuesta. No heredar umbrales numéricos de prompting I003 ni exigir macro-F1 +0,03 de I004 como nueva puerta.

## 11. Informes, privacidad y conservación

JSON I005 con esquema propio validado, ID de experimento y run UUID exclusivo, completitud/terminación, configuración efectiva, autorización/snapshot/hash, dataset/versiones/hashes, prompt, modelo solicitado/efectivo/digest/plantilla/parámetros, entorno saneado y referencia al código exacto (commit y cambios locales relevantes). Identidades heredadas I004 no sustituyen lectura de preflight posterior autorizada. No reutilizar v3 aceptando 90 silenciosamente ni cambiar validadores históricos sin regresión.

Por caso: ID, etiqueta/dificultad/tags, estado, predicción válida o errorKind, latencia y trazabilidad de intento. Sin descripciones completas, justificaciones, prompt completo, mensajes crudos, secretos o stacks indiscriminados en logs/informes. Dataset manual versionado conserva esas referencias; informe apunta a ID + hash. Los informes parciales mantienen número reservado, intentos conservadores, resultados persistidos y faltantes separados.

Informe comparativo: métricas/denominadores, matrices y pares completos, todas las correcciones/regresiones, adversariales por ID/inducida, incertidumbre reproducible, latencia/memoria con límites, presupuesto y estado de permisos, conclusión conforme a la sección 10. Los resultados I004 solo son contexto separado; no sumar 60 + 90 para inflar evidencia independiente.

Conservación: generar paquete privado fuera del directorio de trabajo, con dos runs, parciales si existen, comparación, informe, dataset y anotaciones congelados, registro de revisión, manifiestos usados/final, ledger/marcador, metadatos y referencia reproducible de fuentes/configuración. Sin .env, credenciales o archivos innecesarios; permisos privados, nombre versionado, sin sobrescribir o borrar originales. Manifiesto SHA-256 por miembro, reapertura y cotejo contra originales, hash del comprimido. Si no hay destino privado aprobado, solicitarlo y no declarar conservación completa. `~/Lab/ai-suppor-platform-results` fue autorizado para I004: confirmar alcance para I005 antes de copiar. Recomendar segunda copia privada cifrada en soporte independiente; otro directorio del mismo disco no protege de avería física.

## 12. Requisitos y criterios de aceptación

Requisitos y criterios de diseño aprobados; su satisfacción requiere la evidencia futura indicada. Approved no significa que se hayan ejecutado tests o evaluaciones I005.

| ID          | Requisito                                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| I005-RF-01  | Dataset manual español 90 casos, reparto y contrato de sección 3, referencia defendible y objetivos adversariales congelados. |
| I005-RF-02  | Independencia procedimental y revisión humana previa de todo el dataset; sin generar/etiquetar mediante modelos evaluados.    |
| I005-RF-03  | Dos brazos nativos, original inmutable, mismos parámetros experimentales y puerto/caso de uso reutilizados.                   |
| I005-RF-04  | Inicialización, permisos por brazo, presupuesto durable máximo 180 y continuación fail-closed, sin reintentos.                |
| I005-RF-05  | Métricas/pares/incertidumbre y regla práctica predefinidas, recursos y errores documentados, sin promoción.                   |
| I005-RF-06  | Informes privados verificables, referencia al código y conservación externa íntegra sin tocar evidencia histórica.            |
| I005-RNF-01 | Producción y contratos de I001–I004 intactos; sin dependencias/abstracciones innecesarias.                                    |
| I005-RNF-02 | Tests deterministas sin Ollama, node:test/assert, legibilidad de AGENTS y npm run verify.                                     |
| I005-RNF-03 | No logs de texto de incidencias, sin secretos, informes exclusivos y permisos false por defecto/al terminar.                  |

| ID         | Requisito y evidencia verificable                                                                                                                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I005-AC-01 | RF-01: validador rechaza forma/tipos/duplicados/cuotas incorrectos; acepta exactamente 90, 30 por categoría y 15/10/5; fixtures de límites Unicode y campos extra.                                                                                                                    |
| I005-AC-02 | RF-02: matriz previa de cobertura aprobada sin predicciones individuales anteriores; registro humano de autoría y revisión de 90/90 casos/etiquetas/justificaciones, independencia frente a I002–I004/prompts y exposición declarada; desacuerdos resueltos sin arbitraje de modelos. |
| I005-AC-03 | RF-01/02: aprobación y congelación previas de matriz, dataset y 15 objetivos inducidos, hashes y versiones verificados; política de corrección posterior probada/documentada sin reetiquetar análisis primario.                                                                       |
| I005-AC-04 | RF-03/RNF-01: tests del payload idéntico salvo modelo, original/digests/plantillas/timeout 45000; producción sigue Llama/original/30000 e históricos sin cambios.                                                                                                                     |
| I005-AC-05 | RF-04: inicialización explícita a cero solo nueva, permisos false; dataset/digest/protocolo/aprobación inválidos bloquean antes de inferir, sin CLI/env de bypass; preflight no consume.                                                                                              |
| I005-AC-06 | RF-04: fixtures de pérdida/corrupción/rollback/huérfanos/fsync/reserva/intento sin respuesta/doble brazo y dos procesos; no autocrear/reconstruir/liberar presupuesto.                                                                                                                |
| I005-AC-07 | RF-03/04: dos runs reales autorizados 90+90, orden/residencia registrados y máximo 180, secuenciales sin warm-up/reintentos; mismas entradas congeladas, sin peticiones generativas de compatibilidad.                                                                                |
| I005-AC-08 | RF-04/05: errores técnicos e invalid_response consumen intento, sin predicción inventada; inciertos y no intentados separados. Fixtures demuestran cero aciertos por error, denominadores visibles, detención por inesperados/incertidumbre/timeout y parciales sin reejecución.      |
| I005-AC-09 | RF-05: accuracy/E2E/ejecución, por clase, QUESTION, matrices/dificultad/75 legítimos/15 adversariales e inducidas contrastadas con fixtures manuales; null/ceros y errores sin falsa defensa.                                                                                         |
| I005-AC-10 | RF-05: emparejamiento por ID con transiciones, correcciones/regresiones/recuperaciones/empates y ambos-válidos; revisión humana individual de todas las regresiones legítimas/QUESTION.                                                                                               |
| I005-AC-11 | RF-05: bootstrap pareado/estratificado reproducible y límites, fixtures de signo/empates/degeneración/pares incompletos; regla 8/9/10 netos y todos los desenlaces probados sin ajustar tras datos.                                                                                   |
| I005-AC-12 | RF-05: latencias primero/89 restantes y n/mediana/p95, observación RSS500ms/PID/PPID/cobertura/huecos/máximo observado y ausencias justificadas; sin picos reales o carga interna inventados.                                                                                         |
| I005-AC-13 | RF-06/RNF-03: JSON exclusivo validado, metadatos/hashes/privacidad completos, referencias coherentes y evidencia I003/I004 intacta; paquete privado fuera del proyecto con hashes de miembros y comprimido verificados.                                                               |
| I005-AC-14 | RNF-01/02: npm run verify correcto sin Ollama y regresiones I001–I004, formato/lint/build/tests; trazabilidad de tests a AC automatizables y métodos estadísticos congelados antes de inferir.                                                                                        |
| I005-AC-15 | RF-05/06: responsable revisa interpretación/limitaciones, autoriza cierre fechado, todos los permisos desactivados y consumo final documentado; sin promoción, modificación productiva ni commits automáticos.                                                                        |

AC-07 exige evidencia real completa para cierre ordinario, no calidad positiva. Errores completos pueden cerrar con resultado no confirmatorio; parcialidad deja verificación real pendiente y requiere decisión explícita, no dispensas inferidas. Fallo de memoria justificado no equivale a fallo semántico, conforme a sección 8. No marcar Verified si falta evidencia o conservación. Estado del punto de control inicial: todos los AC pendientes, sin implementación/evaluación I005. Estado documental vigente: revisión humana y congelación completadas; esto no sustituye los tests o evidencias reales aún pendientes ni la aprobación independiente de identidades.

## 13. Tareas ordenadas y Definition of Done

| ID        | Tarea y comprobación                                                                                                                               | Punto de control                                                         |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| I005-T-01 | Diseño Approved y D-01 a D-06 registrados tras comprobar acuerdos. Matriz candidata autorizada, aún sin permiso de redactar datos.                 | Aprobación humana de especificación; por sí sola no habilita ejecución.  |
| I005-T-02 | Tras permiso, preparar/aprobar matriz previa sin predicciones; después redactar manualmente candidato y registrar procedencia, cuotas y objetivos. | Entrega de los 90 casos completos para revisión, sin inferir.            |
| I005-T-03 | Revisión humana 90/90 casos/etiquetas/justificaciones, 15 objetivos y matriz; resolver discrepancias sin modelos y congelar bytes/hashes.          | Aprobación explícita del dataset completo, no automática.                |
| I005-T-04 | Tras permiso, composición/validación/ledger/informes propios y extracción mínima reutilizable con regresiones.                                     | Revisión de alcance; I004 y producción intactas.                         |
| I005-T-05 | Tests de AC automatizables, mocks de proveedor/observadores y npm run verify; posteriormente preflight autorizado sin inferencias.                 | Entrega determinista y aceptación de condiciones/identidades.            |
| I005-T-06 | Tras permiso explícito, inicialización durable a 0/180, congelación del manifiesto y autorización de Llama.                                        | Ninguna inferencia implícita en inicializar.                             |
| I005-T-07 | Llama 90; guardar evidencia técnica, detener si protocolo lo exige; solo tras autorización separada, Gemma 90.                                     | Máximo 180; revisión técnica entre brazos sin ajustar hipótesis o datos. |
| I005-T-08 | Comparar sin inferencias: métricas, incertidumbre, recursos, todas las regresiones y desenlace predefinido.                                        | Revisión humana de interpretación, sin promoción.                        |
| I005-T-09 | Desactivar permisos, inventario y copia privada verificada, npm run verify, documentación coherente.                                               | Confirmar destino/conservación y presupuesto; no commits.                |
| I005-T-10 | Revisión y aceptación humana final de AC y DoD; registrar cierre o bloqueos.                                                                       | Verified únicamente con aceptación explícita, no al escribir código.     |

Para **Implemented**: código autorizado y documentación alineados, tests de todos los AC automatizables con fixtures controlados, regresiones I001–I004 y verify correctos sin Ollama. Dataset preparado/aprobado según tareas sin afirmar inferencias no realizadas. Marcar evidencia real aún pendiente; implementación no implica aceptación ni permiso de ejecución.

Para **Verified**: todos los criterios aplicables satisfechos, dos runs completos conforme al protocolo y autorizaciones (o excepción específica previamente revisada, nunca tácita), análisis íntegro con interpretación estadística limitada y revisión de todas las regresiones, conservación privada verificada, controles coherentes y permisos desactivados, producción intacta y aceptación humana fechada. Resultado negativo o no confirmatorio es válido; no se exige promover Gemma. Parciales, ausencias y desviaciones se registran sin inventar cumplimiento. README/arquitectura/guía futura deben reflejar el comportamiento implementado y estado final, sin reescribir informes históricos.

## 14. Decisiones aprobadas y alcance de autorización

**Approved — 2026-11-09**, responsable del proyecto. La comprobación documental confirma los once puntos del encargo: 90 casos/30 por categoría y 15/10/5; procedencia manual y revisión integral; independencia de ejemplos/predicciones; identidades y configuración I004; 180 intentos; ledger fail-closed y permisos; métricas e incertidumbre; +9/90; errores/parciales/inciertos explícitos; sin promoción automática. Sin contradicciones normativas detectadas. Se conservan todos los IDs.

| ID        | Decisión aprobada                                                                                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I005-D-01 | Dataset manual español 90, 30 por categoría, cuotas 15/10/5; matriz previa y revisión humana integral; aislamiento procedimental, no representatividad de producción. Secciones 3–5. |
| I005-D-02 | Sistemas y configuración congelados I004, orden Llama→Gemma, residencia controlada, sin compatibilidad generativa extra ni cambios productivos. Sección 6.                           |
| I005-D-03 | Composición/contratos I005 separados, reutilización mínima con regresiones y sin cambiar contratos o evidencias congeladas I004. Sección 2.                                          |
| I005-D-04 | Umbral práctico +9/90, ambos brazos completos con cero errores/inciertos para confirmar; resto de desenlaces y reservas cualitativas predefinidos, sin promoción. Sección 10.        |
| I005-D-05 | Bootstrap pareado estratificado, percentil nominal 95 %, 10000 réplicas, nueve estratos, xorshift32 seed5005 y extremos nearest-rank; límites y tests predefinidos. Sección 9.       |
| I005-D-06 | Presupuesto 180, permisos por brazo, sin reintentos ni reinicialización, fail-closed, consumo incierto conservado y conservación privada verificada. Secciones 7 y 11.               |

Punto de control vigente: [matriz v3](005-scenario-matrix.md) y dataset v2 aprobados definitivamente y congelados documentalmente. La matriz v2 y la autorización de redacción de la sección 15 son antecedentes históricos. Las referencias funcionales fueron revisadas por el responsable; no son etiquetas validadas automáticamente por un LLM. Identidades definitivas pendientes de aprobación independiente. La exposición de este agente a resultados individuales en turnos anteriores se declara en la matriz: no se consultan nuevamente ni se utilizan para seleccionar escenarios; requiere revisión por persona no expuesta conforme a sección 4.1. No se afirma aislamiento retrospectivo imposible de demostrar.

Diseño aprobado no autoriza implementar ni iniciar inferencias o presupuestos. Los pasos posteriores mantienen sus puntos de control. No elegir otro reparto, método estadístico o tolerancia tras observar predicciones.

Riesgos principales: contaminación por escenarios/errores conocidos, referencia humana discutible, dependencia entre incidencias, población sintética no representativa, escasos ataques, sobreinterpretación de intervalos, comparación de plantillas diferentes, temperatura cero no determinista, coste observador y carga inicial, cálculo posiblemente activo tras timeout, pérdida de controles/evidencias y adaptación accidental de constantes históricas. Las secciones anteriores fijan controles y límites; no prometen eliminarlos.

No hay contradicción con las decisiones históricas: la prohibición de validación independiente en I004 se refería a I004; I005 la contempla como una iteración distinta. Reutilizar literalmente el runner/ledger I004 con 90 sí sería incompatible con sus contratos actuales, por lo que se requiere la adaptación mínima aprobada, no editar datos o presupuestos I004. Diseño aprobado; dataset v2 y matriz v3 cuentan con revisión humana integral, aprobación definitiva del contenido y congelación documental del 2026-11-09. Solo las identidades definitivas siguen pendientes de aprobación independiente. No se ha ejecutado Ollama ni inicializado presupuesto I005.

## 15. Historial de autorización de redacción — 2026-11-09

El responsable aprueba la matriz v2 y autoriza a Codex redactar directamente los 90 textos con las categorías y dificultades objetivo ya acordadas. Esta instrucción específica sustituye para este candidato la limitación previa de escritura exclusivamente por personas; no se atribuye falsamente autoría o revisión humana a los textos. No se utilizan Llama, Gemma ni otros LLM externos. La revisión de Codex no sustituye la revisión humana integral posterior.

Dataset candidato: evals/datasets/incidents-independent-v1.json, esquema 1, contenido 1. Correspondencia por ID compartido, tag escenario:<ID> y [registro de revisión](005-dataset-candidate-review.md), sin añadir campos al JSON estricto. No se congela ni se calculan hashes definitivos. Escenarios/objetivos de matriz v2 intactos. I005 permanece Approved, sin código, presupuesto, inferencias o commits.

## 16. Estado documental posterior a la congelación — 2026-11-09

El responsable autorizó la congelación del dataset incidents-independent-es-v1 contenido 2, matriz v3, mapa adversarial v1 y registro I005-human-review-freeze-1, tras revisar 90/90 casos (85 directos y cinco resueltos) y validar 15/15 objetivos inducidos. Congelación documental realizada el 2026-11-09; las alusiones a candidatura o congelación no realizada en la sección 15 y puntos de control iniciales son históricas, no estado vigente. Las tareas de la sección 13 conservan su formulación de planificación inicial; no reabren permisos ya consumidos ni autorizan ejecución.

Esta reconciliación corrige solo estados de documentación y actualiza identidades en evals/experiments/i005-manifest.json, conservando hashes previos en su historial. No altera requisitos experimentales, criterios de aceptación, decisiones, escenarios, cuotas, modelos o método estadístico. La versión de contenido de matriz sigue en 3; dataset, mapa y registro humano permanecen idénticos byte a byte. No hay hashes propios o del manifiesto dentro de los documentos referenciados; el manifiesto se verifica mediante su archivo .sha256 separado.

La aprobación definitiva del contenido y su congelación no aprueban por sí solas las nuevas identidades: **aprobación independiente de identidades todavía pendiente**. I005 conserva Approved; implementación, experimentación, ledger y presupuesto no iniciados. Sin inferencias, modelos, consumo, commits o push.
