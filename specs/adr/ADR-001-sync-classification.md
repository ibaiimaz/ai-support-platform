# ADR-001: comenzar con clasificación síncrona

- Estado: Approved. Decisión y documentación aprobadas por el responsable del proyecto.
- Ámbito: [iteración 001](../iterations/001-classification.md).

## Contexto

La primera operación recibe una descripción y devuelve una categoría. El objetivo educativo exige una implementación pequeña, verificable y sin base de datos ni colas.

## Decisión

Resolver la clasificación dentro de la misma petición HTTP. La API devuelve el resultado o un error técnico, con un timeout explícito del proveedor. No se crean trabajos, identificadores de tarea ni endpoints de consulta de estado.

## Consecuencias

El cliente obtiene un contrato directo y las pruebas no requieren infraestructura adicional. La conexión queda abierta durante la inferencia y la latencia depende del hardware, de la carga y del arranque del modelo. El timeout limita la espera; no representa una garantía de latencia del modelo.

## Alternativas

Un flujo asíncrono con cola permitiría procesar trabajos largos y consultar su estado, pero introduciría persistencia, estados y operación adicional sin requisitos actuales que lo justifiquen. Se reconsiderará solo mediante una nueva decisión aprobada si cambian las necesidades.
