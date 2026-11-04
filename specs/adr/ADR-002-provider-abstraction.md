# ADR-002: desacoplar el proveedor de LLM

- Estado: decisión aprobada en conversación; documentación pendiente de revisión.
- Ámbito: [arquitectura](../architecture.md) e [iteración 001](../iterations/001-classification.md).

## Contexto

Ollama local es el primer proveedor. Los tests deben funcionar sin él y debe ser posible sustituirlo sin modificar el caso de uso.

## Decisión

Definir un único puerto orientado a la tarea de clasificar incidencias. El caso de uso depende de ese puerto; el adaptador Ollama implementa el protocolo, construye mensajes, controla el timeout, valida las respuestas y traduce los fallos a errores técnicos independientes del proveedor.

El dominio define las categorías y el tipo de clasificación sin depender del proveedor. El adaptador construye su JSON Schema desde esa definición común y lo utiliza para structured outputs y validación local, sin conversores genéricos. Las causas técnicas permanecen diferenciadas internamente; su traducción al contrato público corresponde a HTTP según la especificación de la iteración.

La composición se realiza explícitamente al arrancar. No se introduce una interfaz genérica de chat, un framework de agentes ni un contenedor de dependencias. El contrato conceptual y las responsabilidades se mantienen en la arquitectura.

## Consecuencias

El proveedor simulado permite probar el caso de uso y HTTP de forma aislada. Otro proveedor requiere un adaptador y un cambio de composición. Existe un pequeño coste de separación y es necesario conservar una taxonomía de errores común.

## Alternativas

Llamar directamente a Ollama desde la ruta reduce inicialmente archivos, pero mezcla HTTP público y protocolo externo. Una abstracción genérica de LLM añadiría capacidades que esta operación no necesita. Se elige un puerto específico para mantener el alcance reducido.
