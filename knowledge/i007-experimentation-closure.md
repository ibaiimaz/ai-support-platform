# I007 — Cierre de experimentación funcional

Fecha: 2026-11-25. Estado de I007: **Implemented**, sin aceptación funcional ni declaración Verified.
La fase de experimentación funcional queda cerrada por instrucción del responsable. No se autorizan
más ejecuciones por este documento. Se mantienen prompt A, Top-K 5, contexto máximo 4 y similitud
mínima 0,45; los valores 6/6 de B no se consolidan en producción.

## Resultados y alcance

| Ejecución      | Run ID                               | Resultado funcional revisado                          | Alcance                                                                            |
| -------------- | ------------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Baseline       | 60d21e02-a6f0-40b4-b50c-741c569bcca9 | 17/20; 12/13 respuestas, 5/7 abstenciones             | Revisión ratificada; fallos 008, 016 y 017                                         |
| A              | 713bde35-9d5e-433e-a7f6-79dda464b4ee | 18/20 provisional; 12/13 respuestas, 6/7 abstenciones | Cambia solo prompt; corrige 017, fallos 008 y 016                                  |
| B              | 80a59d92-34e4-4335-be50-14945c3a47ee | 19/20 provisional; 12/13 respuestas, 7/7 abstenciones | Cambia Top-K/contexto a 6/6; corrige 016, fallo 008                                |
| Oracle Context | f21cb300-3977-4507-bdcf-3dbb6a5052e6 | Respuesta correcta al único caso 008                  | Diagnóstico con dos fragmentos seleccionados manualmente; no añadir a métricas RAG |

Los porcentajes funcionales proceden de revisión semántica, no de la coincidencia automática de
estados. A/B no muestran regresiones funcionales observadas; no son validación independiente.
Las revisiones conservan su atribución asistida por ChatGPT, sin afirmar una auditoría humana
independiente ni convertir estos resultados en aceptación funcional de la iteración.

Referencias: [baseline y A](i007-experiment-a.md), [diagnóstico de retrieval](i007-experiment-b-diagnosis.md),
[revisión de B y diseño Oracle](i007-experiment-b-review-oracle.md).
Los procedimientos anteriores son históricos: sus autorizaciones están consumidas, no permiten repetir.

## Oracle Context cerrado

Autorización: I007-DIAGNOSTIC-ORACLE-001. Una generación reservada, enviada y observada;
cero embeddings, recuperación vectorial, reintentos e intentos inciertos. Latencia: 5687,457 ms.
Usa exactamente webhooks:0 y roles:1 de B, en ese orden; pregunta original, prompt A, qwen3:8b,
esquema y parámetros del mismo adaptador de producción. Modelo/digest verificados antes/después.

La respuesta indica cerrar sesión y volver a entrar para activar permisos y Administración >
Integraciones para configurar webhooks. Cita ambos fragmentos y está fundamentada en ellos.
La revisión asistida por ChatGPT comunicada por el responsable la considera correcta.

Revisión adicional privada: evals/reports/i007/I007-ORACLE-CONTEXT-001/semantic-review.json.
Se vincula por SHA-256 al resultado y a la entrada originales. SHA-256 de esta revisión:
054d108b9952d04a6c4c75bb00c94d6315caf127fc7e1ad01a98092dfef55c9d.
semantic-review-integrity.json conserva los hashes de los ocho archivos preexistentes sin editarlos.
El CLI de revisión ordinaria requiere un informe de lote RAG; no se fabrica uno para este diagnóstico.
Se utiliza evidencia adicional de revisión, con persistencia durable exclusiva y hashes vinculantes.
El cierre y marcador originales permanecen intactos y bloquean repetir el guion.

## Evidencia suficiente y utilización efectiva

Baseline/A no entregan roles:1. B sí lo entrega íntegro, pero su respuesta no aplica la renovación de
sesión. Oracle muestra que el modelo puede responder correctamente con contexto seleccionado
manualmente. Son hechos distintos: recuperar la evidencia necesaria no garantiza utilizarla.

El ruido contextual y la posición de los fragmentos son posibles factores explicativos. Oracle cambia
simultáneamente cantidad, composición y posición; no permite aislar sus efectos ni demostrar una causa.
Una única generación no acredita generalización, robustez estadística ni una mejora del retrieval.
No se modifica la etiqueta de 008 ni se sustituye su fallo en B por el acierto diagnóstico.

## Seguridad y exposición

A y B conservan ASR provisional 0/3 extremo a extremo y 0/2 con exposición a la carga propia.
018 no recibe su carga propia; 019/020 sí. En B, 018 recibe una carga cruzada de updates:1.
La exposición a cualquiera de las tres cargas anotadas entre todos los casos pasa de 8/20 a 17/20.
Son denominadores y preguntas distintas; no contar ausencia de exposición como resistencia del
modelo. No se afirma seguridad general ante prompt injection. Oracle no contiene estas cargas.

## Conservación y continuación

Informes y resultados originales de baseline/A/B, diagnóstico de embedding y Oracle permanecen
privados y excluidos de Git. Se añaden revisiones; no se reescriben originales ni métricas históricas.
La documentación conserva identidades y referencias para reconstruir los recorridos anteriores.
No se han cambiado defaults, prompt, corpus, dataset, modelos, contratos o configuración persistente.

El análisis posterior de RT-001/RT-002 se implementó y cerró en 27cc98a/2309812, con revisión
independiente favorable. C se consolidó en 834d1c2 y sus anotaciones v2 están aprobadas. El
[cierre técnico definitivo](i007-closure.md) registra integración PostgreSQL 16.12/pgvector 0.8.1
satisfactoria (402/402 tests, ninguna omisión), sin nuevas evaluaciones funcionales.

El análisis retrospectivo C conserva la cobertura por contexto verificado, pero deja Chunk Recall de
baseline/A no disponible: faltan identidades verificables para fragmentos fuera del contexto retenido.
B retiene todos los fragmentos recuperados y permite calcular recall 97,44 %. Similitudes históricas
ausentes no se reconstruyen. No se modifican informes ni resultados originales.
Este cierre no autoriza nuevas evaluaciones, inferencias, ingestas, migraciones ni despliegue.
