# Instrucciones para agentes de desarrollo

## Fuentes de verdad

- Las especificaciones aprobadas son la fuente de verdad funcional.
- Los ADRs aprobados son la referencia para decisiones arquitectónicas.
- Antes de implementar, consultar [producto](specs/product.md), [arquitectura](specs/architecture.md), la especificación de la iteración y los ADRs relevantes.
- No modificar silenciosamente requisitos aprobados. Si la implementación exige cambiar un requisito o una decisión aprobada, proponer el cambio y obtener aprobación antes de aplicarlo.
- Ante contradicciones, indicarlas y resolverlas con el usuario antes de implementar el comportamiento afectado. No suponer acuerdos que no estén disponibles en la documentación o conversación.

## Desarrollo incremental

- Cada nueva iteración debe contar con su propia especificación antes de implementar.
- Mantener IDs de requisitos y criterios de aceptación estables; no reutilizar IDs retirados con otro significado.
- Relacionar los tests con los criterios de aceptación que cubren, mediante sus nombres o referencias explícitas.
- Mantener la documentación sincronizada con el comportamiento implementado. Distinguir el diseño aprobado del estado real de implementación.
- Usar referencias cruzadas y evitar duplicar contratos o reglas normativas.
- Mantener una arquitectura pragmática: no añadir infraestructura, dependencias ni abstracciones por necesidades hipotéticas.
- No registrar indiscriminadamente descripciones de incidencias, prompts ni respuestas del modelo.
- Los tests automatizados deben ejecutarse sin Ollama disponible.
- No crear commits automáticamente.

## Estado actual

Solo existe documentación. No implementar código de aplicación hasta recibir aprobación explícita tras su revisión. Los detalles de la primera iteración se encuentran en [001-classification.md](specs/iterations/001-classification.md).
