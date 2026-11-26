# I007 — Cierre técnico de RT-002

Implementación: 2026-11-25. Cierre documental: 2026-11-26.
Estado: **Implementado y aceptado técnicamente tras revisión independiente favorable**. Base: 27cc98a, RT-001 cerrado. RT-002 se implementa bajo autorización nominal
sobre cuatro fuentes, ocho suites históricas y cuatro documentos, con tests y este informe nuevos.
La revisión independiente queda aceptada por el responsable, sin hallazgos pendientes.
No se declara aceptación funcional de I007. RT-001 no se reabre.

## Arquitectura resultante

```text
main.ts (solo arranca al ejecutarse como entrypoint)
  loadConfig + loadRagConfig
  createApplicationDependencies [composition.ts]
    createKnowledgeDependencies [knowledge/composition.ts]
    createClassificationDependencies [composition.ts, conservada]
    → { dependencies: { classification, knowledge }, close }
  buildApp(dependencies, logger)
    registerErrors + logging común
    registerClassifyRoute
    registerKnowledgeRoute
  listen 127.0.0.1:3000 + SIGINT/SIGTERM
  onClose → retirar listeners propios + close agregado
```

buildApp solo recibe puertos y límites explícitos; no crea recursos ni conoce modelos/configuración.
Las rutas, esquemas, casos de uso y adaptadores permanecen intactos. La composición central retiene
factorías concretas independientes, sin contenedor DI, puerto genérico o framework. Su inyección
opcional de dos factorías permite probar fallos de composición sin proveedores reales.

La CLI de ingestión/migración y el evaluador siguen usando la factoría independiente knowledge.
No importan HTTP, main o la composición global; un test recorre su clausura TypeScript para comprobarlo.
Importar main no llama a listen, configura señales ni crea proveedores. startApplication admite
composición y construcción simuladas para probar los fallos sin abrir el servidor real.

## Recursos y fallos

El cierre independiente knowledge memoriza una promesa para pool.end; el cierre central memoriza
otra para knowledge.close. Repetición, concurrencia y rechazo del cierre no provocan reintentos.
El proveedor se prepara antes del pool; la construcción del pool sigue siendo lazy, sin conexiones.
Si falla preparar clasificación después de crear knowledge, la factoría central espera su cierre
antes de rechazar. Si knowledge falla antes de devolver una composición, no se crea clasificación.

main conserva los recursos compuestos durante preparación/listen y añade onClose antes de escuchar.
Ante fallo de buildApp, ready o listen intenta cerrar app cuando existe y ejecuta el cierre agregado
en finally. El cierre ordinario y por señal retira los listeners propios y libera recursos una vez.
Los tests simulan listen y preparación, no envían señales reales ni inferencias. Si app.close falla,
se intenta igualmente el cierre agregado. Los errores públicos de arranque/cierre son genéricos.

Límites: no se garantiza liberación física de un pool cuyo end falla o no termina; se propaga el
rechazo y no se reintenta. Una excepción de limpieza puede sustituir la excepción original durante
el rechazo del arranque, sin exponer detalles públicos. No hay nuevo timeout global de apagado;
Fastify puede esperar peticiones activas. La inyección de factorías presupone que cada factoría
responde de recursos que no haya devuelto. No se introduce un sistema genérico de adquisición.

## Adaptación individual de garantías históricas

| Archivo                                          | Adaptación y garantías conservadas                                                                                                                                                                                                                   |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| test/http/app.test.ts                            | Sustituye la importación de buildApp por un fixture que proporciona ambas capacidades; mantiene todas las aserciones de categorías, validación, estados, errores y logging.                                                                          |
| test/http/tool-calling.test.ts                   | Mismo fixture; conserva límites, herramientas, abstenciones, deadlines, privacidad y rechazo del puerto histórico. El contrato de ambas capacidades de buildApp real se prueba además explícitamente.                                                |
| test/ollama/adapter.test.ts                      | Solo cambia la importación del constructor de app; mantiene los tres recorridos HTTP con proveedor simulado y todas las garantías del adaptador histórico.                                                                                           |
| test/ollama/invalid-response-diagnostics.test.ts | Solo cambia el constructor por fixture; conserva diagnósticos internos, kind y ausencia de diagnóstico/datos sensibles en HTTP.                                                                                                                      |
| test/unit/production-composition.test.ts         | Solo cambia el constructor por fixture; mantiene composición real de clasificación, instrucciones, protocolos y privacidad.                                                                                                                          |
| test/robustness/composition.test.ts              | Usa fixture; sustituye la forma textual antigua de main por composición central de ambas configuraciones y su paso a createApp con logger. Conserva ausencia de OllamaClassifier en main, hashes/prompts I003, separación de candidatos y payloads.  |
| test/model-comparison/execution.test.ts          | Sustituye únicamente aquella expectativa textual por composición central y paso a createApp; conserva import de composition, ausencia de OllamaClassifier y todas las aserciones I004 de modelo/prompt/esquema/temperatura/timeout/reproducibilidad. |
| test/knowledge/http.test.ts                      | Sustituye montaje manual Fastify/registro de errores/ruta por buildApp con ambas capacidades; conserva todos los contratos y agrega comprobación de que el logging común emite metadatos sin contenidos.                                             |

El fixture nuevo test/http/application-fixture.ts añade knowledge simulado a las suites que prueban
solo clasificación, sin alterar respuestas del proveedor de clasificación ni ejecutar RAG durante
esas pruebas. No crea una sobrecarga productiva ni una implementación alternativa. El test nuevo
application-lifecycle prueba el main predeterminado con la composición central, además de los caminos
inyectados: las comprobaciones de arranque no dependen únicamente de cadenas de texto.

## Protección histórica

Se capturaron SHA-256 de 471 rutas antes de modificar (inventarios disponibles, evidencia privada
I007, fixture, package/lock y .DS_Store) en un temporal técnico fuera de Git. Se distingue:

- Inventario I007 de 352 archivos: solo src/composition.ts puede cambiar aquí, por autorización expresa.
- Freeze I006 R7 de 38 archivos: evolucionan las fuentes actuales main/composition/http-app autorizadas;
  el archivo freeze y sus identidades no cambian. Antes ya diferían main, package y lock frente al freeze.
- Inventarios de conservación I003 87/v2 89: son registros históricos, no identidades del árbol actual.
  Las fuentes/tests/documentación nominalmente autorizados pueden evolucionar; no se reescriben
  inventarios ni las copias privadas conservadas para fingir identidad con sus bytes antiguos.
- Inventario de ejecución I006 R7 de 71 archivos: no se modifica; no hay reactivación o nuevas evidencias.
- El conjunto de 412 archivos está mencionado en la guía de cierre I006. La búsqueda acotada en
  documentación, log de rutas con nombres inventory/protect y árbol del commit 42771e8 no localiza
  su inventario nominal. No se reconstruye ni se declara verificada su integridad completa.
  La autorización actual permite exclusivamente evolucionar la lista nominal concedida.

Se mantiene el fixture inmutable I006 y el rechazo del árbol actual por el mecanismo original.
No se restauran manifiestos, recalculan hashes históricos ni modifican permisos o evidencias.
package.json, package-lock.json y .DS_Store quedan intactos. La captura temporal no es un respaldo.

## Identidad futura de evaluación

RT-001 conserva su alcance y esquema: su clausura importa knowledge/composition.ts y ahora recoge
su cierre idempotente. Cambian sourceHash y buildHash para evaluaciones futuras. No se añaden main,
http/app ni composition global al inventario porque no se ejecutan desde esa entrada de evaluación.
No cambian lockfileHash ni configurationHash. No se reescriben identidades de baseline/A/B/Oracle o RT-001.
La comprobación --check solo prepara/verifica offline; no autoriza una evaluación funcional.

## Verificación

La suite dirigida pasa 105/105 con dobles de prueba, servidores locales simulados y sin Ollama real.
Cubre clasificación, knowledge, adaptador, privacidad, I003/I004, ciclo de vida y RT-001. Los tests nuevos
verifican ambas rutas, inyección, construcción sin conexiones/inferencias, fallo de composición parcial,
build/ready/listen/close, señales sin duplicar listeners, cierres repetidos y rechazo de pool.end,
independencia de CLI/evaluador y contrato tipado sin sobrecarga de clasificación sola.

Los logs conservados confirman que la verificación completa terminó antes de la interrupción.
Estos resultados corresponden al implementador; no se atribuyen a un revisor independiente.

| Comprobación                                       | Resultado conservado                                      |
| -------------------------------------------------- | --------------------------------------------------------- |
| Suite dirigida                                     | 105/105 satisfactorios                                    |
| Ciclo de vida y HTTP knowledge                     | 14/14 satisfactorios; nueve tests nuevos de ciclo de vida |
| npm run verify, con RAG_TEST_DATABASE_URL excluido | 382 tests: 381 satisfactorios, 0 fallos, 1 omitido        |
| TypeScript estricto, lint y formato                | Correctos, incluidos en verify                            |
| Evaluador --check                                  | Offline, inference false, correspondencia VERIFIED        |
| git diff --check                                   | Correcto                                                  |

PostgreSQL real es la integración omitida: implicaría migraciones/ingestas no autorizadas.
**Su validación final sigue pendiente.** Los dobles de prueba no sustituyen esa comprobación.
Los tests de regresión incluyen las garantías históricas y la separación RT-001; no son una
evaluación funcional de los modelos ni acreditan aceptación funcional de I007.

Logs técnicos locales: /tmp/i007-rt002-verify.log, /tmp/i007-rt002-targeted.log,
/tmp/i007-rt002-lifecycle.log y /tmp/i007-rt002-check.log. No se incorporan a Git.
No se repiten pruebas durante este cierre: solo cambian documentos y se comprueban formato y diff.

## Resultado final de identidad e integridad

La comprobación offline conservada verifica 13 módulos propios y 13 artefactos compilados.
Respecto a RT-001, solo cambia el módulo inventariado src/knowledge/composition.ts; la clausura
y el esquema permanecen iguales. Las lecturas posteriores confirman coincidencia de las fuentes,
artefactos y configuración actuales con ese registro, sin ejecutar de nuevo el evaluador.

| Identidad futura  | SHA-256                                                          |
| ----------------- | ---------------------------------------------------------------- |
| sourceHash        | 95cb09b75d7235e7b63347cdc9da1428ac7ddd7bf4723663228d409104d3d503 |
| buildHash         | 516a0998e0534987bfab40517b32d9f0d6ea760abc1c3ffdf7652f16de8e2163 |
| lockfileHash      | 5ce05952a3350131a6aac568083dd8b97772dc6da7ab01f540056b483b679a45 |
| configurationHash | 4e9cedd282640a5847205556a0986db9574c49d5223294f91d89a57f87de7f6e |

lockfileHash y configurationHash coinciden con RT-001. Los valores nuevos son identidades del
código RT-002, no sustitutos de hashes históricos. Se mantienen las limitaciones de RT-001:
no se atestiguan todos los bytes de dependencias externas ni se elimina la ventana entre
verificación y uso frente a modificaciones deliberadas concurrentes.

La comparación de las 471 rutas capturadas antes de implementar identifica únicamente tres
cambios, todos autorizados: src/main.ts, src/composition.ts y src/http/app.ts. En el inventario
de 352 archivos, solo cambia src/composition.ts por autorización nominal; los otros 351
conservan sus hashes. Esto no significa que las otras fuentes autorizadas de RT-002 no cambien:
knowledge/composition.ts y los tests/documentos afectados no pertenecen a esa captura concreta.

Las modificaciones existentes se limitan a las cuatro fuentes, ocho suites y cuatro documentos
nominalmente autorizados, detallados arriba. Se añaden únicamente el fixture HTTP, los tests de
ciclo de vida y este informe. El freeze R7 y sus hashes originales, el fixture inmutable,
los manifiestos y las evidencias conservadas permanecen intactos. Los inventarios de conservación
I003 no se regeneran para hacer coincidir sus fuentes históricas con el árbol evolucionado.
El mecanismo original I006 conserva el rechazo del árbol actual, comprobado en la regresión.

package.json, package-lock.json y .DS_Store siguen intactos respecto a 27cc98a/la captura inicial.
La limitación del inventario nominal de 412 archivos no localizado permanece abierta: no se
reconstruye, no se declara íntegramente verificado ni se amplía el alcance nominal autorizado.

## Revisión independiente y aceptación técnica

El 2026-11-26 el responsable acepta la revisión independiente de RT-002, con veredicto favorable
y sin hallazgos pendientes de corrección, y autoriza el commit de cierre. Los resultados de la
sección Verificación (105/105 dirigidos, 14/14 de ciclo de vida/HTTP y 381 satisfactorios más una
omisión en la suite completa) corresponden al implementador y sus logs conservados. No se
atribuyen esas cifras a las comprobaciones independientes del revisor.

Según la comunicación del responsable, durante la revisión se observaron fallos listen EPERM
por las restricciones del sandbox para abrir sockets locales. La ejecución posterior satisfactoria
del archivo de tests afectado resolvió esa limitación de entorno; no se necesitó alterar el código
para ocultar el fallo. No se dispone aquí del log, ruta nominal del archivo ni recuento de esa
ejecución del revisor, por lo que no se inventan esos detalles ni se confunde el episodio con los
logs de la implementación. No se generaliza EPERM como explicación de otros errores.

RT-002 queda cerrado y aceptado técnicamente, conservando las limitaciones del ciclo de vida,
la identidad y el inventario nominal de 412 archivos no localizado. PostgreSQL real continúa
pendiente de validación final autorizada; su omisión no se convierte en prueba satisfactoria.
La aceptación técnica de RT-002 no concede aceptación funcional de I007, ni autorización para
inferencias o despliegue. El experimento C no se inicia.

El cierre mediante commit incluye únicamente la implementación autorizada, tests y documentación;
excluye evidencias privadas, dist y .DS_Store. No se ejecutan inferencias, evaluaciones funcionales,
ingestas o migraciones ni se realiza push. Las evidencias originales permanecen intactas.
