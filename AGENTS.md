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

## Legibilidad y mantenibilidad

- Priorizar la comprensión y el mantenimiento por desarrolladores humanos sobre la concisión. No reducir líneas a costa de la claridad.
- Evitar cuerpos no vacíos de funciones, métodos, bucles y estructuras de control en una sola línea. Usar bloques con llaves y saltos de línea en las estructuras de control.
- Distribuir los miembros de interfaces, tipos de objeto y clases en líneas separadas, salvo expresiones triviales donde una forma compacta resulte claramente más legible.
- Separar visualmente funciones, clases e interfaces. Agrupar las importaciones y dejar una línea en blanco antes del resto del módulo.
- Introducir líneas en blanco entre bloques lógicos con responsabilidades distintas, evitando saltos innecesarios.
- Usar nombres descriptivos y estructuras fáciles de seguir. Mantener funciones pequeñas cuando ayude a comprenderlas, sin fragmentarlas artificialmente.
- Usar Prettier como formateador oficial: ancho orientativo de 100 caracteres, dos espacios, punto y coma, comillas simples en TypeScript y las demás convenciones predeterminadas. El ancho no es un límite estricto para literales o documentación.
- Aplicar `npm run format` y comprobar con `npm run format:check`. No editar manualmente el formato para contradecir al formateador.
- ESLint exige llaves, una sentencia por línea, separación de declaraciones/importaciones y miembros de clases; también evita `var`, importaciones duplicadas y comparaciones sin igualdad estricta. La configuración es deliberadamente pequeña y no sustituye a la compilación TypeScript estricta.
- Ejecutar `npm run verify` como verificación automatizada de cada iteración: formato, lint, compilación y tests. La comprobación de formato forma parte de la Definition of Done.
- La calidad de los nombres, la separación de responsabilidades, el tamaño adecuado de funciones y las excepciones triviales de legibilidad requieren revisión humana. No introducir refactorizaciones funcionales o arquitectónicas al aplicar formato.

## Estado de las iteraciones

Consultar el estado y la autorización vigente en la especificación de cada iteración. Usar el ciclo `Draft → Approved → In Progress → Implemented → Verified`. `Implemented` indica implementación y comprobaciones completadas; `Verified` requiere revisión y aceptación explícita del responsable del proyecto.
