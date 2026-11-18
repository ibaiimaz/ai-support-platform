# ADR-003: separar decisión de consulta y clasificación final

- Estado: Approved, decisión humana del 2026-11-18.
- Ámbito: [I006, revisión 6](../iterations/006-tool-calling.md), DEC-I006-029.
- Implementación: completada con tests deterministas el 2026-11-18; aceptada por el responsable el 2026-11-18 tras segunda revisión independiente APPROVED; evaluación real pendiente. Este ADR no autoriza inferencias.
- Sustituye exclusivamente el atajo de resultado final en la primera inferencia de revisión 5,
  actualizando DEC-I006-005/012. Mantiene [ADR-001](ADR-001-sync-classification.md) y
  [ADR-002](ADR-002-provider-abstraction.md).

## Contexto

El flujo implementado de revisión 5 admite clasificación directa en una primera petición con
herramientas y sin `format`, o consulta y segunda petición estructurada. El experimento original
se cerró INCOMPLETE ante `invalid_response` en I006-001. Un diagnóstico independiente posterior
identificó `FINAL_SCHEMA_INVALID`, sin conservar la respuesta cruda y sin demostrar cuál fue la
propiedad rechazada ni que el intento original devolviera lo mismo.

La prueba independiente tools + format se cerró COMPLETE_FAILED: A produjo BUG válido, pero B
respondió QUESTION directamente y no solicitó INC-142. Esto no acredita la preservación del
recorrido nativo ni demuestra por sí solo causalidad del formato. Sus [referencias históricas](../../evals/experiments/i006-usage.md#ejecuciones-históricas-cerradas)
permanecen inmutables. No se adopta tools + format simultáneo en producción.

## Decisión

Separar dos responsabilidades dentro del mismo caso de uso y puerto específico de clasificación:

1. Decidir la consulta con herramientas nativas habilitadas, sin `format`. Validar sobre y
   llamadas. Una respuesta técnicamente válida sin campo nativo `tool_calls` produce
   `no_lookup`; su texto no es clasificación ni instrucción de herramienta.
2. Ejecutar opcionalmente una herramienta autorizada en backend, conservando toda su política.
3. Clasificar siempre en una segunda inferencia, si no hubo rechazo/fallo previo y queda tiempo:
   sin herramientas y con el esquema estricto de clasificación/abstención y validación local.
   Usar instrucciones de clasificación, descripción original y turno/resultado de herramienta
   cuando exista; no copiar automáticamente el texto de decisión.

La [tabla normativa de validez](../iterations/006-tool-calling.md#validez-de-la-primera-respuesta-nativa)
distingue `no_lookup`, solicitudes válidas, rechazos de política y fallos técnicos. Una lista
nativa vacía no equivale a ausencia de campo: conserva el rechazo de solicitud inválida.

Mantener `ClassificationLlm.infer()` y ampliar su unión interna con `LookupDecision`/`no_lookup`,
con validación por fase. No crear un puerto genérico, llamadas de reparación ni otro framework.
Las instrucciones efectivas se componen e identifican por separado mediante los módulos
`lookup-decision-instructions.ts` y `classification-final-instructions.ts`.

## Consecuencias

Toda clasificación final utiliza salida estructurada; los fallos de decisión y clasificación se
observan por separado. Se elimina la dependencia del formato de clasificación en el texto libre
de la primera respuesta, sin relajar el protocolo ni la autorización de herramientas.

Se añaden una inferencia y su latencia en los casos sin consulta: 60 casos que alcancen resultado final
consumen 120 inferencias (cota de la pasada), frente a 93 previstas en revisión 5 si se cumplieran sus 33 consultas
esperadas. Es una comparación de planificación, no un resultado observado de ambas arquitecturas.
Los casos con consulta siguen usando dos inferencias. Se conserva el deadline de 90 segundos,
límites individuales 45/5 y presupuesto restante; dos llamadas no garantizan dos ventanas de 45 s.

`no_lookup` puede omitir semánticamente una consulta necesaria; JSON Schema tampoco garantiza
categorías correctas ni resistencia a prompt injection. Ambas puertas y revisión humana siguen
siendo necesarias. El resultado HTTP y el dominio no cambian.

Los IDs de AC se conservan y se revisan sus expectativas, especialmente AC-01/09/14/17/26.
Dataset v3, etiquetas, fixtures, pares y hash permanecen intactos. La nueva ejecución necesitará
otra identidad, autorización, manifiesto desactivado inicialmente y espacio de controles propio,
reutilizando la implementación fail-closed existente. No se reabre ni se libera presupuesto cerrado.

## Alternativas consideradas

- Mantener revisión 5: menor latencia sin herramienta, pero las respuestas finales de la primera
  inferencia siguen sin restricción de generación por esquema.
- Añadir simultáneamente tools y format: hipótesis probada sin cumplir ambos recorridos;
  descartada para adopción productiva en esta decisión.
- Reforzar solo el prompt: no impone conformidad estructural; ya existían instrucciones de JSON.
- Protocolo de acciones JSON propio: cambia el objetivo de herramientas nativas y no aporta una
  simplificación suficiente que justifique otra traducción o arquitectura en esta iteración.

## Alcance de esta aprobación

La aprobación documental se amplió posteriormente a implementación y pruebas deterministas.
La incompatibilidad de los diagnósticos históricos se resolvió mediante retirada explícita
autorizada: las entradas rechazan ejecución antes de cualquier efecto y sus originales siguen
en Git. No se modifican autorizaciones históricas ni evidencias. El nuevo manifiesto de
revisión 6 permanece desactivado; no se inicializa ni autoriza ninguna pasada experimental.
