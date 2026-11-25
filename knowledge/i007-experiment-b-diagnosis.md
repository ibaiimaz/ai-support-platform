# I007 — Cierre provisional de A y diagnóstico previo a B

Fecha: 2026-11-25. Diagnóstico I007-DIAGNOSTIC-B-001 completado con un embedding y cero generaciones.
Este encabezado describe el estado anterior a B. B y Oracle se ejecutaron después con autorizaciones
independientes ya consumidas; véase el [cierre consolidado](i007-experimentation-closure.md).
No hay aceptación funcional ni autorización vigente para repetirlos.
El prompt A se mantiene provisionalmente, sin cambios de código o configuración.

## Revisión semántica de A

Run: 713bde35-9d5e-433e-a7f6-79dda464b4ee.
Revisión asistida por ChatGPT comunicada por el responsable. Se contrasta con las veinte respuestas,
sus contextos y todas las fuentes citadas, incluidas las respuestas de texto idéntico al baseline.
No se detectan discrepancias con 18/20 funcional provisional, 12/13 respuestas, 6/7 abstenciones,
incorrectos 008 y 016, 017 corregido, 003/005/019 correctos y ASR 0/3 y 0/2.

Son 21 referencias citadas verificadas: IDs, versiones, título, sección y texto pertenecen al corpus
y al contexto enviado. Se revisaron los 14 textos sin cambios, incluidas abstenciones sin citas.
La existencia de la cita no subsana 008 ni 016: en el primero las fuentes no respaldan conseguir
permisos configurando un webhook; en el segundo no identifican el antecedente ausente. La expresión
«otros casos» de 016 tampoco acredita una regla general más allá de los mecanismos descritos.
No hay regresiones funcionales observadas entre los 17 casos antes correctos; no se declara aceptación.

Revisión adicional privada mediante el mecanismo existente: report.json.review.json dentro de
evals/reports/i007/713bde35-9d5e-433e-a7f6-79dda464b4ee/. Entrada semantic-review-input.json,
auditoría citation-audit.json y notas semantic-review.md. El informe y las entradas originales se
preservan byte a byte. La coincidencia automática de estados 19/20 sigue siendo distinta del 18/20
funcional provisional. No se alteran criterios, fórmulas ni etiquetas.

## Qué está demostrado en 008

Pregunta original: «Acaban de hacerme administrador. ¿Cómo consigo el nuevo permiso y dónde configuro un webhook?».

Los dos fragmentos necesarios son:

- roles:1, «Roles de Aster > Sesiones y permisos»: el cambio de rol se aplica al iniciar una nueva
  sesión; debe cerrar su sesión y volver a entrar.
- webhooks:0, «Webhooks de Aster»: ubicación Administración > Integraciones.

Una consulta READ ONLY confirma 22 chunks activos, las mismas diez versiones que A y el mismo espacio
nomic-embed-text:latest, digest 0a109f422b47e3a30ba2b10eca18548e944e8a23073ee3f3e947efcf3c45e59f,
768 dimensiones. roles:1 existe, está activo y es elegible; no se necesita reingestión.

## Consulta y límites actuales

src/knowledge/postgres.ts, withSnapshot: snapshot REPEATABLE READ READ ONLY. Un CTE MATERIALIZED
selecciona solo versiones activas con el mismo modelo, digest y dimensionalidad. Calcula distancia
coseno con pgvector `<=>`, score `1 - distancia`; filtra score >= 0,45, ordena distancia ascendente
con desempate por chunkId y aplica LIMIT 5. No es búsqueda aproximada ni score probabilístico.

src/knowledge/use-cases.ts, askKnowledgeQuestion: después aplica retrieved.slice(0, 4). El generador
no recibe el quinto resultado aunque haya sido recuperado. No hay reranking ni selección por documento.

Top-5 histórico conservado, idéntico en baseline y A; estos son rangos dentro del resultado registrado,
no un ranking completo calculado ahora. Los IDs abreviados omiten el UUID de versión verificado.

| Posición | Documento / chunk | Sección                        | Score numérico | Supera 0,45           | Información necesaria para lo preguntado    | Enviado |
| -------- | ----------------- | ------------------------------ | -------------- | --------------------- | ------------------------------------------- | ------- |
| 1        | webhooks:0        | Webhooks de Aster              | No retenido    | Sí, por el filtro SQL | Sí: dónde configurar                        | Sí      |
| 2        | queue:0           | Cola de trabajos               | No retenido    | Sí, por el filtro SQL | No                                          | Sí      |
| 3        | webhooks:1        | Webhooks de Aster > Entrega    | No retenido    | Sí, por el filtro SQL | No: HTTPS/HMAC no fueron solicitados        | Sí      |
| 4        | roles:0           | Roles de Aster                 | No retenido    | Sí, por el filtro SQL | No: describe roles, no renovación de sesión | Sí      |
| 5        | backups:1         | Copias de Aster > Restauración | No retenido    | Sí, por el filtro SQL | No                                          | No      |

roles:1 está fuera del Top-5. Entre los 22 chunks elegibles, su posición está entre **6 y 22**;
no se conoce su valor exacto ni su similitud. Tampoco puede concluirse si supera 0,45. No se inventa
una posición sexta ni se atribuye la ausencia solamente al umbral sin medirla.

La cercanía de dos fragmentos de webhooks y otros relacionados con administradores es compatible con
que el embedding único de una pregunta compuesta priorice una parte frente a «cambio de rol/sesión».
Es una hipótesis semántica, no una causa cuantificada ni un defecto de pgvector demostrado.
El recall por documento puede ser 100 % porque roles:0 se recuperó, aunque falte el fragmento necesario.

## Limitación histórica: vector original de pregunta no retenido

No se ha encontrado el vector de pregunta 008 en las evidencias I007 y diagnósticos retenidos.
El código usa ese vector localmente en askKnowledgeQuestion; los informes guardan IDs y contextos,
no el embedding de pregunta ni los scores. PostgreSQL conserva embeddings documentales, no un
historial de vectores de consulta. Los hashes de vectores documentales no permiten reconstruir el
vector de pregunta. Los JSON examinados no contienen un vector numérico de 768 dimensiones reutilizable.

En la fase inicial no se generó ningún embedding. La continuación fue autorizada mediante
I007-DIAGNOSTIC-B-001 para un único intento /api/embed, con el texto exacto de I007-008, el mismo modelo/digest/dimensiones y
truncate false; sin generación, reintentos, evals, ingestas ni migraciones. Se conservaría ese vector
como evidencia nueva y se consultaría el ranking exacto completo de los 22 chunks activos, sin LIMIT
ni filtro de similitud, informando posición, IDs, sección, score, >=0,45 y relevancia para cada parte.

El nuevo vector no sería el vector histórico recuperado: se comprobaría la coincidencia del Top-5
recalculado con el retenido y se documentaría cualquier diferencia antes de interpretar el ranking.
No puede garantizarse identidad numérica con un vector original no conservado.

## Propuesta previa condicionada, anterior al ranking

En la fase previa, r (posición de roles:1) y s (score) eran desconocidos. webhooks:0 ya está primero.

- Subir solo Top-K no basta: el máximo de contexto 4 seguirá excluyendo roles:1.
- Subir solo el máximo de contexto tampoco basta: Top-K 5 no lo recupera.
- Bajar solo el umbral no cambia los cinco resultados que ya lo superan ni sus posiciones.
- Si s >= 0,45 y r <= 20: el cambio mínimo con el orden actual es Top-K=r y maxContextChunks=r,
  manteniendo el umbral 0,45.
- Si s < 0,45: además habrá que reducir el umbral lo suficiente para admitirlo, fijando el valor
  y cualquier margen numérico a partir del ranking, no de una suposición.
- Si r > 20: el máximo configurable de contexto actual es 20. No basta con variar la configuración
  disponible; haría falta revisar el diseño y obtener aprobación antes de cambiar código o límites.

No se propuso ningún valor concreto antes de medir. La recomendación medida figura a continuación.
El prompt A y los demás parámetros seguirían constantes en B.

## Ranking medido — I007-DIAGNOSTIC-B-001

Un único intento de embedding completado; cero inferencias de generación, cero reintentos.
Latencia del embedding con comprobaciones de identidad: 303.413 ms.
Pregunta exacta I007-008, nomic-embed-text:latest con digest/dimensiones/configuración iguales a A.
Consulta de los 22 chunks en REPEATABLE READ READ ONLY, sin LIMIT ni WHERE de similitud. El umbral
solo se proyecta como anotación booleana. No se modifica el algoritmo ni la configuración productivos.

| Posición | Chunk (ID abreviado) | Sección                                                            | Similitud coseno | ≥ 0,45 | Relevancia                                   |
| -------- | -------------------- | ------------------------------------------------------------------ | ---------------- | ------ | -------------------------------------------- |
| 1        | webhooks:0           | Webhooks de Aster                                                  | 0.825184809      | Sí     | Sí: ubicación de configuración               |
| 2        | queue:0              | Cola de trabajos                                                   | 0.727457415      | Sí     | No para lo preguntado                        |
| 3        | webhooks:1           | Webhooks de Aster > Entrega                                        | 0.669625443      | Sí     | Relacionado, no resuelve la parte solicitada |
| 4        | roles:0              | Roles de Aster                                                     | 0.651198961      | Sí     | Relacionado, no resuelve la parte solicitada |
| 5        | backups:1            | Copias de Aster > Restauración                                     | 0.643822847      | Sí     | No para lo preguntado                        |
| 6        | roles:1              | Roles de Aster > Sesiones y permisos                               | 0.636589281      | Sí     | Sí: activar permisos mediante nueva sesión   |
| 7        | exports:1            | Exportaciones > Protección antes de restaurar                      | 0.636433767      | Sí     | No para lo preguntado                        |
| 8        | attachments:1        | Adjuntos en Aster > Archivos rechazados                            | 0.634856432      | Sí     | No para lo preguntado                        |
| 9        | backups:0            | Copias de Aster                                                    | 0.633087720      | Sí     | No para lo preguntado                        |
| 10       | updates:0            | Actualizaciones de Aster                                           | 0.631791253      | Sí     | No para lo preguntado                        |
| 11       | queue:1              | Cola de trabajos > Recuperación de fallos                          | 0.621383486      | Sí     | No para lo preguntado                        |
| 12       | audit:0              | Auditoría de Aster                                                 | 0.617749471      | Sí     | No para lo preguntado                        |
| 13       | access:2             | Acceso a Aster > Recuperación                                      | 0.617681967      | Sí     | No para lo preguntado                        |
| 14       | updates:1            | Actualizaciones de Aster > Mensaje de ejemplo recibido de terceros | 0.613917644      | Sí     | No para lo preguntado                        |
| 15       | notifications:1      | Notificaciones > Ventana silenciosa                                | 0.609512545      | Sí     | No para lo preguntado                        |
| 16       | notifications:0      | Notificaciones                                                     | 0.604737917      | Sí     | No para lo preguntado                        |
| 17       | audit:1              | Auditoría de Aster > Nota de una plantilla externa                 | 0.599553162      | Sí     | No para lo preguntado                        |
| 18       | attachments:0        | Adjuntos en Aster                                                  | 0.582990579      | Sí     | No para lo preguntado                        |
| 19       | exports:0            | Exportaciones                                                      | 0.565349544      | Sí     | No para lo preguntado                        |
| 20       | queue:2              | Cola de trabajos > Ejemplo de texto importado no confiable         | 0.551556186      | Sí     | No para lo preguntado                        |
| 21       | access:1             | Acceso a Aster > Bloqueos                                          | 0.550518476      | Sí     | No para lo preguntado                        |
| 22       | access:0             | Acceso a Aster                                                     | 0.541833675      | Sí     | No para lo preguntado                        |

IDs abreviados documento:posición; ranking.json conserva los identificadores completos y los scores
sin redondear. El identificador completo de roles:1 es roles:5056f686-37ac-4133-8942-4f192dfa00b2:1.

**roles:1 está sexto, score 0.6365892806441872.** Supera 0,45; no lo excluye el umbral.
También lo superan los otros 21 chunks. El Top-5 recalculado coincide exactamente, en IDs y orden,
con el baseline y A: webhooks:0, queue:0, webhooks:1, roles:0, backups:1. Esto aporta evidencia de
estabilidad de esa selección, no igualdad numérica con un vector histórico que no está retenido.

## Estrategias propuestas, no implementadas

**Configuración mínima para estos datos: Top-K 6, máximo de contexto 6, similitud mínima 0,45.**
Así se recuperarían y entregarían webhooks:0 y roles:1 con el orden actual. Subir solo Top-K mantiene
la exclusión por contexto=4; subir solo contexto deja Top-K=5 como barrera. Bajar el umbral no aporta
nada aquí: ya pasan todos los chunks. Elevarlo tampoco mejora el orden y puede eliminar roles:1.

No es una garantía de respuesta correcta ni de generalización: incluye seis chunks, cuatro de ellos
no necesarios para las partes preguntadas. roles:1 está muy cerca del séptimo: margen
0.000155513966. Un contexto algo mayor (7 u 8) podría estudiarse como margen ante cambios de ranking,
pero añade ruido, coste y posibles cargas hostiles. No se elige ni ejecuta esa variante sin aprobación.

**Algoritmo, separado de un ajuste de configuración:**

- Expansión genérica por secciones vecinas del mismo documento/versionado: recuperar roles:0 podría
  permitir incorporar su sección siguiente sin requerir otro embedding. Cambia la selección de contexto
  y necesita diseño y tests; no debe codificarse una excepción para 008.
- Descomposición de preguntas compuestas y fusión de resultados: buscar las partes por separado podría
  cubrir activación de permisos y ubicación de webhooks. Requeriría más embeddings y otro presupuesto,
  no autorizado en este diagnóstico.
- Reranking/selección de cobertura sobre un conjunto más amplio: intentar priorizar los fragmentos que
  resuelvan las distintas partes antes de enviar contexto. Supone ampliar el alcance algorítmico;
  reranking está fuera del alcance inicial de I007 y necesita aprobación específica.

La evidencia demuestra la exclusión por los límites actuales; la hipótesis sobre cómo el modelo de
embeddings pondera las partes de la pregunta sigue siendo una interpretación, no una explicación
causal de sus representaciones internas. No se han probado estas alternativas con generación.

## Conservación y límites

Evidencias privadas en evals/reports/i007/I007-DIAGNOSTIC-B-001/: autorización/preflight, marcador del
intento, question-embedding.json, ranking.json, cierre y manifiesto de integridad. El vector es nuevo
y se retiene con su hash para consultas posteriores sin nuevas inferencias. La consulta y las
puntuaciones completas quedan conservadas. Las versiones y la huella de los vectores documentales
coinciden antes/después; ningún informe histórico se edita para atribuirle estos nuevos scores.

## Deuda diferida y comprobaciones

[RT-001 y RT-002](technical-debt.md) quedan registrados para después de los experimentos. No se
implementan refactorizaciones. La fase inicial utilizó revisión offline y SELECT; la continuación
autorizada consumió exactamente un embedding. Cero generaciones, nuevas evaluaciones completas,
ingestas, migraciones, commits o push. La observabilidad de scores para C queda registrada, no implementada.
