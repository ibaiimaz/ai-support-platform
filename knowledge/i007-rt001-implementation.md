# I007 — Cierre técnico de RT-001

Fecha: 2026-11-25. RT-001 aceptado tras segunda revisión independiente favorable.
Las autorizaciones nominales sobre package.json cubren el destino de eval:knowledge y,
mediante la ampliación expresa de R1, el script build para limpieza automática y compilación.
No se levanta la protección general de archivos históricos.
RT-002 y las métricas del experimento C no forman parte de esta intervención.

## Estructura resultante

- src/knowledge/: motor RAG, dominio/puertos, adaptadores, configuración, composición y CLI
  administrativa intactos; sin módulos exclusivos de evaluación.
- src/evaluation/knowledge/evaluation.ts: traslado de src/knowledge/evaluation.ts, solo imports nuevos.
- src/evaluation/knowledge/main.ts: launcher con comprobación de identidad; runner.ts conserva la
  CLI trasladada desde src/knowledge/evaluation-main.ts. code-identity.ts verifica fuentes/build.
  Mismos modos --check, --review y --run, sin ejecución funcional en RT-001.
- test/evaluation/knowledge/evaluation.test.ts: los once tests anteriores, solo rutas actualizadas.
- test/evaluation/knowledge/separation.test.ts: cuatro tests nuevos de separación, guarda negativa,
  CLI offline y fixture de retención/parcial durable.
- test/evaluation/knowledge.test.ts: entrada de descubrimiento para el glob existente de npm test.
  No duplica aserciones; permite incluir los tests del subdirectorio sin ampliar la excepción package.
- src/evaluation/durable-files.ts: intacto; la evaluación lo importa desde su nueva ubicación.

## Primera entrega — equivalencia e identidad (antes de R1/R2)

Se contrastó el AST del evaluador con HEAD excluyendo imports: cuerpo idéntico. Se compararon los
once tests trasladados con los originales: idénticos al sustituir únicamente rutas. La CLI conserva
flujo, observación, SQL, errores, persistencia y cálculo de métricas; solo cambia ubicación/imports y
el inventario de fuentes. No se extrae un motor alternativo ni se añaden dependencias.

El inventario conserva el orden de sus diez entradas y usa rutas completas: domain, ports, config,
markdown, ollama, postgres, use-cases bajo src/knowledge; evaluation y main bajo
src/evaluation/knowledge; composition bajo src/knowledge. La primera entrega propuso la siguiente identidad de fuentes, sustituida por el esquema 2
descrito en las correcciones posteriores; no es la identidad vigente:

eb5e6899d9519b458f47a9e991d56ff4b0592558020892c16a71fc5a8d5321cd.

No se atribuye a ninguna ejecución histórica ni se escribe en informes previos. El codeHash
anterior de A/B se conserva en sus evidencias; reproducir ese código exige su revisión Git original.

## Regresión y límites

Los tests preservados cubren fórmulas y denominadores, revisión humana, privacidad opt-in,
exposición, identidad antes/después y entre casos, timeout, parada y fallo de persistencia.
El fixture nuevo verifica literalmente contexto limitado, respuesta/citas, IDs recuperados,
resultados parciales persistidos en temporal, métricas esperadas y ninguna continuación tras fallo.
La CLI --check se ejecuta con fetch prohibido y endpoints locales inutilizables, sin generar evidencias.

La prueba arquitectónica recorre imports locales (incluidos tipos), reexports e imports dinámicos
literales de todos los módulos de producción y sus dependencias transitivas. Rechaza imports dinámicos
opacos y requiere revisar la guarda si se añaden paths/baseUrl o aliases internos. No inspecciona
internamente las dependencias npm ni pretende aislar código hostil que construya un cargador arbitrario.
No sustituye la revisión humana de arquitectura.

En la primera entrega se retiraron manualmente tres artefactos obsoletos generados en dist para evitar
entradas y tests antiguos: tsc no elimina salidas de fuentes borradas. No se borraron fuentes ni
evidencias históricas. R1 sustituye esa solución insuficiente por limpieza automática del build.

La integración PostgreSQL real se omite: esta autorización prohíbe migraciones e ingestas.
Los tests deterministas usan puertos y transporte simulados. No se consulta Ollama ni se conecta
al corpus experimental para verificar la refactorización.

## Protección

Los 352 archivos históricos del inventario previo mantienen sus hashes. package-lock.json,
freeze I006 R7, fixture inmutable y mecanismo original de identidad permanecen intactos.
package.json cambia únicamente los dos scripts expresamente autorizados: eval:knowledge y build. Prompt A, defaults 5/4/0,45, dataset/corpus,
modelos, permisos, manifiestos y evidencias experimentales no se modifican. El archivo ajeno
.DS_Store permanece fuera del alcance, sin staging ni cambios realizados por esta intervención.

La documentación vigente actualizada es README de knowledge, arquitectura, análisis RT y deuda técnica.
Las descripciones de experimentos previos se conservan como historia, no se reescriben sus identidades.
La segunda revisión independiente de RT-001 queda aceptada por el responsable; I007 no se declara
funcionalmente aceptada. La integración PostgreSQL real queda pendiente de validación final autorizada.

## Verificaciones de la primera entrega

- Suite dirigida knowledge/evaluación: 42 tests, 41 satisfactorios y 1 omitido (PostgreSQL real).
- Entrada exclusiva de evaluación: 15/15 tests satisfactorios, incluidos los once trasladados.
- `env -u RAG_TEST_DATABASE_URL npm run verify`: 369 tests, 368 satisfactorios, 0 fallos y
  1 omitido. Incluye regresión histórica I001–I006, fixture congelado y rechazo del árbol actual.
- Formato, lint, compilación TypeScript estricta y git diff --check correctos. Se corrigieron
  cuatro separaciones de líneas señaladas por lint únicamente en el test nuevo antes del pase final.
- `npm run eval:knowledge -- --check`: 20 casos, 10 documentos, inference false; identidades de
  dataset/corpus iguales a las registradas. El test de entrypoint añade prohibición explícita de fetch.
- Logs técnicos locales: /tmp/i007-rt001-targeted.log y /tmp/i007-rt001-verify.log; no son evidencia
  experimental ni se incorporan a Git. No se hizo staging, commit o push.

## Correcciones de revisión independiente — R1 y R2

**R1:** scripts/build.js usa rmSync sobre la ruta fija dist/ relativa a su propia ubicación y
spawnSync de Node para invocar el TypeScript instalado. No recibe rutas de limpieza de argumentos
ni variables de entorno, no usa shell, no añade dependencias y propaga el código de salida.
package.json conserva los comandos públicos; solo build pasa a node scripts/build.js, además del
cambio eval:knowledge ya autorizado. package-lock permanece idéntico. El test crea una instalación
mínima temporal con salidas antiguas, ejecuta el script real y comprueba eliminación, conservación
de un archivo fuera de dist y ejecución única del test trasladado. No requiere limpieza manual.

**R2:** main.ts verifica la correspondencia antes de importar dinámicamente runner.ts. Este último
conserva la CLI de la primera entrega y sus métricas; exige identidad verificada para --run.
code-identity.ts resuelve la clausura TypeScript desde la entrada y emite en memoria sin escribir,
con el tsconfig y compilador instalados. Contrasta los bytes de cada artefacto relevante en dist,
incluyendo main, runner, verificador, durable-files y módulos RAG importados transitivamente.
Registra inventarios deterministas de rutas/hashes de fuentes y artefactos separados; también
package.json, package-lock.json, tsconfig.json, scripts/build.js y versiones Node/TypeScript.
Comprueba versión TypeScript frente al lockfile, rechaza configuraciones extends/references no
inventariadas y cambios durante la verificación. Antes de cada embedding/generación se vuelve a
contrastar el inventario, sin reintentos. --run rechaza execArgv y NODE_OPTIONS no vacíos para no
admitir hooks/flags de transformación no verificados. No se alteran los controles históricos.

Los informes futuros pasan explícitamente a schemaVersion 2 con codeIdentity schemaVersion 1:
sourceHash, buildHash, lockfileHash, configurationHash, versiones e inventarios. No se redefine
codeHash: permanece como dato histórico de informes v1, no se emite con un significado nuevo ni
se utiliza como garantía de identidad ejecutada. Los modos --check y --run verifican el build actual;
--review mantiene compatibilidad offline con informes v1/v2 sin exigirles la identidad actual.
La revisión de fixtures serializados de ambos esquemas no modifica sus bytes originales.

La identidad completa se obtiene mediante --check. La tabla al final registra los hashes separados
observados para este código, no un hash del documento ni una identidad inmutable de toda la instalación.
Los hashes nuevos no se atribuyen a ejecuciones anteriores.
Las pruebas de R2 modifican solo fixtures temporales: persistencia con build obsoleto, compilación
actualizada con nuevos hashes de fuente/build, JavaScript sustituido, lockfile y comprobaciones
posteriores. No se modifican fuentes, artefactos o informes históricos para demostrar los rechazos.

Límites: se verifica la correspondencia de módulos propios, no los bytes internos de cada dependencia
npm, TypeScript o del runtime/OS. Registrar lockfile/versión no atestigua toda la instalación. Las
lecturas puntuales no garantizan inmutabilidad frente a un actor local que modifique y restaure
archivos entre comprobaciones ni eliminan la ventana entre comprobación y uso; reservar el árbol
y el proveedor. La compilación en memoria tiene coste de preparación, sin cambiar retrieval o
parámetros de inferencia. La comprobación de identidad no concede autorización experimental.

### Validación de las correcciones

Las pruebas específicas de evaluación/separación/R1/R2 pasan 19/19. La primera regresión completa
tras las correcciones pasa 373 tests: 372 satisfactorios, 0 fallos y 1 omitido (PostgreSQL real,
excluido para respetar la prohibición de migraciones). Se comprueba además en el log completo que
los once tests trasladados aparecen exactamente una vez. Formato, lint y TypeScript estrictos pasan.
La última verificación vuelve a pasar con el mismo resultado tras añadir codeIdentity también a
started.json, donde queda persistida antes del primer intento aunque no se escriba el agregado.

El comando offline muestra 13 módulos propios y 13 artefactos verificados, incluida persistencia.
Los 352 archivos protegidos, lockfile, freeze, fixture y evidencias A/B/Oracle conservan sus hashes.
Los informes históricos v1 y sus revisiones no se modifican; las pruebas de revisión v1/v2 usan
solo fixtures temporales. El mecanismo original I006 conserva rechazo del árbol actual.

Archivos adicionales de las correcciones: scripts/build.js; code-identity.ts y runner.ts en
src/evaluation/knowledge; identity.test.ts en test/evaluation/knowledge. Se adaptan main.ts,
separation.test.ts, la entrada de descubrimiento y el script build autorizado. Se actualizan guía,
arquitectura y este registro. No se añaden dependencias ni se modifica package-lock.json.
Logs: /tmp/i007-rt001-r1-r2-targeted.log, /tmp/i007-rt001-r1-r2-verify.log y
/tmp/i007-rt001-r1-r2-check.log. Sin inferencias, ingestas, migraciones, staging, commit o push.
Las correcciones fueron aceptadas tras la segunda revisión independiente favorable, según la
comunicación del responsable. R1 y R2 se consideran resueltos.

Identidades observadas por --check tras las correcciones (solo para este código, no históricas):

| Campo        | SHA-256                                                          |
| ------------ | ---------------------------------------------------------------- |
| sourceHash   | 8e4a1651ac6482bf2b54f5fec1058fc58747c5a38d9dd78b814e41b7c3bfdf67 |
| buildHash    | 1ba72643a525a1fa162d28b77a8d9be498f5602fda14d4f40885d1cb7a9e487f |
| lockfileHash | 5ce05952a3350131a6aac568083dd8b97772dc6da7ab01f540056b483b679a45 |

El build ordinario actual ya no deja las tres entradas obsoletas del traslado. La limpieza se
verificó tanto en el fixture de transición como en dist del proyecto, sin limpieza manual posterior.

## Aceptación y atribución de verificaciones

El responsable acepta la segunda revisión independiente y autoriza el cierre mediante commit.
El resultado comunicado es favorable, con R1 y R2 resueltos. No se dispone aquí de un detalle
adicional de comandos, logs o recuentos ejecutados por el revisor; no se le atribuyen las cifras
de las verificaciones del implementador descritas arriba (19/19 dirigidas; 372 satisfactorios,
0 fallos y 1 omitido en la regresión completa).

La aceptación técnica de RT-001 no acredita integración PostgreSQL real en esta intervención,
aceptación funcional de I007 ni autoriza inferencias. Se mantienen las limitaciones de identidad
documentadas y la validación PostgreSQL pendiente, sin ejecutar migraciones o ingestas.
RT-002 y las métricas nuevas continúan diferidos.
