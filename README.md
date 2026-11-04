# AI Support Platform

Proyecto educativo backend para explorar aplicaciones que integran LLM mediante iteraciones pequeñas y especificaciones revisadas antes de implementar.

La primera iteración clasificará descripciones de incidencias como `BUG`, `FEATURE` o `QUESTION` mediante una API REST síncrona y Ollama local. No existe todavía código de aplicación ni comandos de instalación, ejecución o pruebas. Esta documentación no autoriza su implementación.

## Documentación

- [Producto](specs/product.md): visión, alcance y reglas generales.
- [Arquitectura](specs/architecture.md): diseño aprobado para la primera implementación.
- [Iteración 001](specs/iterations/001-classification.md): contrato, requisitos, aceptación y tareas.
- [ADR-001](specs/adr/ADR-001-sync-classification.md): clasificación síncrona.
- [ADR-002](specs/adr/ADR-002-provider-abstraction.md): separación del proveedor.
- [AGENTS.md](AGENTS.md): instrucciones permanentes de desarrollo.

## Proceso de trabajo

Cada iteración tiene una especificación revisada antes de implementar. Los requisitos y criterios de aceptación mantienen IDs estables para relacionarlos con los tests. Los cambios funcionales o arquitectónicos aprobados se proponen antes de aplicarse y se reflejan en la documentación correspondiente.

La base documental se presenta para revisión. La implementación requiere aprobación explícita posterior. Cuando exista código, este README incorporará los requisitos de entorno y los comandos comprobados de instalación, configuración, ejecución y pruebas.
