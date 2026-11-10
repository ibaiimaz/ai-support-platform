# I005 — Guía de la implementación del evaluador independiente

## Estado y fuentes de verdad

**Estado vigente: `Verified` — 2026-11-10**, por aprobación humana expresa del responsable:
«APRUEBO FORMALMENTE I005 Y AUTORIZO SU MARCADO COMO VERIFIED».
El [registro de cierre](#cierre-formal--2026-11-10) de esta guía documenta la aceptación final.

La [especificación aprobada](../../specs/iterations/005-independent-model-validation.md),
el [manifiesto congelado](i005-manifest.json) y su sidecar conservan sus bytes e identidades.
Sus estados de diseño son históricos; el cierre se registra aquí sin alterar los seis
artefactos congelados. Las aprobaciones operativas históricas permanecen en
[i005-operation.json](i005-operation.json) y los snapshots. El ledger durable cierra ambos
brazos: todos los permisos efectivos están desactivados, con **180/180 intentos** consumidos.
Esta aceptación no autoriza nuevas inferencias ni promoción a producción.

## Herramientas y límites

Tras `npm run build`, la única comprobación de preparación disponible sin efectos externos es:

```sh
npm run eval:independent -- --validate
```

Autentica el manifiesto y su sidecar, las cinco referencias congeladas, tamaños y SHA-256;
valida los 90 ejemplos, cuotas, IDs, referencias de matriz y 15 objetivos inducidos. Comprueba
la configuración operativa y muestra identidades y permisos, sin consultar Ollama, crear
el directorio de resultados o inicializar presupuesto. No equivale a un preflight de modelos.

No existen flags para seleccionar otro dataset, ignorar hashes, variar opciones, reanudar,
forzar, repetir o ejecutar compatibilidad. Las variables de entorno productivas no autorizan
I005 ni cambian su configuración efectiva.

### Procedimiento histórico, sujeto a autorizaciones separadas

Los siguientes comandos se documentan para revisión; **no deben ejecutarse con la autorización
actual**:

```sh
npm run eval:independent -- --initialize
npm run eval:independent -- --phase validation --model llama3.1:8b
npm run eval:independent -- --phase validation --model gemma3:12b
```

1. Solicitar preflight de lectura y comprobar ambos modelos/digests, plantillas, parámetros,
   cuantización, versión de Ollama, equipo y disponibilidad de observación RSS. La referencia
   del entorno es la de I004; una diferencia requiere decisión humana, sin actualizar identidades.
2. Confirmar PID actual y uso dedicado en `i005-operation.json`. Una imposibilidad de medir
   memoria exige aprobación explícita de `environment.memoryUnavailable` antes de inferir.
3. Registrar autorización humana de inicialización con responsable y fecha; `--initialize`
   solo admite un directorio nuevo vacío y crea presupuesto cero y marcador durable.
   No consulta al proveedor ni autoriza ninguno de los brazos.
4. Registrar autorización independiente de Llama. La preparación autorizada del brazo reutiliza
   los controles nativos de residencia de I004; no hace warm-up ni peticiones generativas vacías.
   Verifica ambos sistemas antes de comenzar. Mantiene original I001, `/api/chat`, system/user,
   temperatura 0, `stream: false`, timeout 45000 ms y orden congelado de los 90 casos.
5. Revisar el informe Llama íntegro y su SHA-256. Solo entonces registrar aprobación humana
   `llamaReview` vinculada a ese hash y autorización separada de Gemma. La completitud de
   Llama, por sí sola, no concede permiso; un informe completo con errores conocidos requiere
   igualmente revisión. Un brazo incompleto o incierto bloquea la continuación.
6. Ejecutar Gemma una sola vez, sobre las mismas entradas y configuración. No adaptar el prompt
   ni seleccionar casos a partir de los resultados Llama.
7. Revisar los permisos **efectivos** con `--validate`. La declaración humana `approved` se
   conserva sin reescribirla: no es un permiso reutilizable. El ledger registra `permissionClosed`
   en la misma transacción durable que el estado final y el informe, todavía bajo el lock.
   Un brazo reservado, incompleto o incierto bloquea la continuación. La inicialización ya
   realizada y los brazos consumidos carecen de permiso efectivo, aunque su aprobación histórica
   siga siendo true. Gemma exige además el informe Llama aprobado. Al consumir ambos brazos,
   todos los permisos efectivos están desactivados.
   Un fallo en informe, cierre, ledger o marcador deja reserva pendiente, evidencia huérfana,
   sentinel o controles divergentes; no permite continuar. No se sobrescriben ediciones
   concurrentes de `i005-operation.json`. La configuración conserva las aprobaciones originales
   para auditoría y el informe comparativo separa declaraciones de permisos efectivos.

Cada fase necesita autorización humana explícita; editar un booleano no constituye autorización
por parte del responsable. No hay promoción automática ni modificación del endpoint productivo.

## Presupuesto, interrupciones y persistencia

I005 dispone de dos reservas de 90, máximo 180; no utiliza presupuesto I004. Antes de construir
el proveedor persiste la reserva del brazo; antes de cada llamada persiste el contador de
intento; después guarda el resultado normalizado. Un fallo entre contabilizar y llamar consume
conservadoramente el intento. La ausencia de respuesta nunca devuelve presupuesto.

`evals/reports/i005/` contiene únicamente:

- `budget.json`: UUID, revisión, reservas/resultados, identidad/tamaño de snapshots y cierre irreversible de permisos.
- `budget-initialization.json`: identidad, revisión y hash del ledger.
- `budget.lock`: exclusión entre procesos durante el brazo.
- `budget-persistence.pending`: evidencia bloqueante de escritura incierta.
- `<sha256>.operation.json`: snapshots privados de la configuración/autorización efectiva.
- `<run-id>.json`: informes exclusivos con hashes vinculados al ledger.

Se reutilizan las primitivas de escritura de I004: archivos privados, creación exclusiva,
reemplazo atómico, sincronización de archivos y directorios. Los controles permanecen separados
y los contratos históricos no se generalizan para aceptar I005. Inicialización explícita y
continuación son operaciones distintas. Controles ausentes/corruptos/divergentes, evidencia
huérfana, temporales, lock abandonado, reserva pendiente o intento sin resultado bloquean.
No borrar controles, reconstruir automáticamente el historial ni usar informes como permiso
para repetir. Un fallo de persistencia puede impedir producir un informe final; conservar los
registros ya existentes y solicitar revisión, sin inventar respuestas ni latencias.

Ningún mecanismo local protege contra borrado deliberado, rollback coherente de todos los
controles/evidencias o pérdida física. La exclusión por lock presupone procesos que respetan
el protocolo y un sistema de archivos local con creación exclusiva y renombrado atómico.

Los errores HTTP o de respuesta inválida se registran sin reintentos. Los errores de conexión
se consideran inciertos: el adaptador no distingue una conexión rechazada de una interrupción
posterior a entregar la petición. Tanto estos errores como los timeouts detienen nuevas inferencias: abortar HTTP o consultar residencia no demuestra
que Ollama haya terminado. Excepciones inesperadas, cambios de identidad/residencia,
revocaciones/configuración alterada o cambios de artefactos detienen el brazo. Las anomalías
de residencia se conservan en informes parciales saneados; un informe completo las rechaza.
`anomalies.residency` registra índices y motivos derivados de las observaciones, de forma
independiente de `termination`. Se conserva la primera causa de parada aunque coincidan
transporte incierto, timeout o excepción inesperada con una anomalía de residencia. Una ejecución
parcial separa reserva, intentos, resultados persistidos, incertidumbre y no intentados;
no publica métricas globales como si hubiera completado 90 casos. No hay reanudación automática.

Código de salida 0: brazo completo y guardado, incluso con errores técnicos conocidos.
Código 1: bloqueo, parcialidad o fallo de persistencia/cierre de permisos. El código no expresa
calidad semántica ni autoriza una repetición.

## Informes y comparación sin inferencias

Tras dos brazos completos y guardados:

```sh
npm run eval:independent -- --compare evals/reports/i005/LLAMA-RUN-ID.json evals/reports/i005/GEMMA-RUN-ID.json
```

Es de solo lectura. Exige las rutas e identidades vinculadas al ledger y snapshots originales,
valida informes y recalcula sus métricas antes de compararlos. Emite JSON por stdout; guardar
la comparación en una ubicación privada separada del directorio de controles, por ejemplo
`evals/reports/i005-analysis/`, mediante un procedimiento que evite sobrescribir archivos.
Esa carpeta no se crea durante la implementación. `evals/reports/` sigue excluido de Git.

Los informes de esquema I005 propio incluyen identidad documental, dataset y configuración,
modelo/digest/plantilla/parámetros, declaración de autorización utilizada, identidad del build
verificado, UTC, preparación, resultados por ID, errores, latencia y RSS. No contienen
incidencias, justificaciones, prompt completo, respuestas crudas ni stacks.

### Correspondencia verificable entre fuentes y ejecutable

La entrada `launch.js` inventaría los JS de `dist/src/` **antes** de importar el evaluador y
sus dependencias de aplicación; el módulo de inventario solo importa primitivas de Node.
La ejecución real del runner exige ese snapshot de arranque: importar `main.js` no
inicia ninguna fase. La inyección de verificadores está reservada a fixtures, igual que
la de proveedores; no existe opción de CLI o entorno para omitir la comprobación.

Antes de reservar el brazo, el compilador TypeScript ya instalado emite las fuentes `src/`
**en memoria**, con el `tsconfig.json` del proyecto. Se compara exactamente el inventario
SHA-256 de los JS emitidos con el build de arranque y el que permanece en disco. Se rechazan
builds antiguos, archivos sobrantes y diagnósticos de compilación. No se escribe ni recompila
`dist/` durante la evaluación. Se fijan hashes agregados de fuentes, configuración,
`package.json`, lockfile y build, junto a versión del compilador y commit disponible.

Se comprueban antes y después de cada intento y al terminar el brazo. Gemma y la comparación
exigen además las mismas identidades de fuentes/build y versión del compilador que Llama. Un cambio conserva la
identidad inicial y produce un informe parcial `code_changed`, sin continuar. Para reproducir
un árbol con cambios locales hay que conservar privadamente las fuentes exactas además de
sus hashes. Instalar dependencias conforme al lockfile y ejecutar `npm run verify` antes del
preflight. Estos controles no autentican un sistema comprometido ni protegen contra un
administrador que altere deliberadamente el verificador o el proceso en memoria.

Accuracy, matriz y F1 usan respuestas válidas; errores siguen visibles en soportes y conteos.
Éxito extremo a extremo usa 90 y ejecución satisfactoria válidos/90. Desgloses previstos:
45 evidentes, 30 complejos, 75 legítimos, 15 adversariales. Se conserva cada par, incluidos
los errores; se separan correcciones semánticas, regresiones legítimas, regresiones operativas,
recuperaciones técnicas y subconjunto ambos-válidos. Revisar humanamente todas las regresiones
legítimas y QUESTION. Se publican aciertos QUESTION/30, ganancias/pérdidas globales,
empates de corrección, estado y predicción, errores en ambos y predicciones incorrectas
entre sí diferentes. Las regresiones globales y legítimas aparecen separadas. Coincidencia inducida no demuestra obediencia causal; un error técnico
no demuestra resistencia al ataque.

El bootstrap primario requiere 90 pares completos. Procedimiento congelado: nueve estratos,
cuotas 15/10/5 por categoría, orden congelado de IDs dentro del estrato, pares conjuntos,
10000 réplicas, xorshift32 seed 5005, desplazamientos 13/17/5, unsigned / 2^32 y nearest-rank
índices 249/9749. Se registra degeneración. Intervalo aproximado condicionado al dataset
sintético; no estima variabilidad entre ejecuciones ni garantiza cobertura poblacional.

El umbral +9/90 se aplica solo a brazos íntegros, completos y sin errores ni incertidumbre.
Con errores la comparación es descriptiva/no confirmatoria; con parcialidad no se fabrica un
intervalo primario. Ganancias 1–8, empate neto y pérdida tienen desenlaces separados. Ningún
desenlace autoriza promoción ni reinterpretar etiquetas.

Latencias: todos/válidos/ambos-válidos, n, media, mediana, p95 nearest-rank, primera llamada
y 89 restantes cuando completo. Preparación y duración de cada brazo se separan de la ventana
UTC del experimento e intervalos humanos. Los tiempos internos no expuestos son null. RSS:
servidor y descendientes PID/PPID, muestreo objetivo 500 ms, cobertura, huecos y máximo
**observado**, nunca pico real. Ausencias quedan registradas; memoria compartida/GPU/unificada,
carga inicial, orden fijo, cachés y observación limitan la comparación.

## Verificación y pasos pendientes

```sh
npm run verify
npx tsc -p tsconfig.json --noEmit
```

Los tests I005 usan fixtures, disco temporal, observadores y proveedores simulados; el test
del adaptador sustituye `fetch` y no consulta Ollama. Se cubren cuotas/identidades, permisos,
orden, presupuesto, concurrencia entre procesos, persistencia fallida, errores y parciales,
privacidad, métricas manuales, bootstrap reproducible y regresión histórica.

Los puntos de control de revisión técnica, preflight, inicialización, ejecución autorizada de
ambos brazos, revisión intermedia y final, conservación externa y aceptación humana están
completados. Las instrucciones anteriores describen el procedimiento histórico; no permiten
reabrir ni repetir el experimento cerrado.

Los 90 casos sintéticos independientes del desarrollo no representan producción. Los 15
adversariales miden principalmente instrucciones explícitas; las plantillas nativas forman
parte de los sistemas comparados, por lo que no se atribuirán diferencias solo a los pesos.

## Correcciones de la revisión técnica adversarial

B1 e I1–I5 implementados para segunda revisión técnica, sin autorización experimental.

| Hallazgo | Control y regresión determinista                                                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1       | Transporte incierto detiene el primer intento y bloquea Gemma.                                                                                                                             |
| I1       | Snapshots obligatorios con hash/tamaño y vinculación ledger/informe; ausencia, corrupción, sustitución y huérfanos bloquean.                                                               |
| I2       | Cierre irreversible bajo lock; rechazo específico EEXIST/open/budget.lock por otro proceso antes y después de persistir el cierre, sin temporizadores; fallos de persistencia bloqueantes. |
| I3       | Anomalías independientes de la causa principal, con regresiones de las cuatro combinaciones; informes completos siguen rechazándolas.                                                      |
| I4       | Inventario previo a importar aplicación, emisión TypeScript exacta en memoria y detección de cambios de fuentes/build/configuración.                                                       |
| I5       | Denominador QUESTION/30 y resúmenes pareados globales; fixture con errores, regresión adversarial y predicciones incorrectas diferentes.                                                   |

El bootstrap tiene además un oracle independiente con signos positivos/negativos en los nueve
estratos. Las correcciones no cambian el protocolo estadístico ni los artefactos congelados.
La revisión técnica y las autorizaciones posteriores siguen pendientes.

## Cierre formal — 2026-11-10

**I005: Verified.** El responsable del proyecto aprueba expresamente el cierre tras la
auditoría final, revisión de regresiones y conservación externa verificada. Este registro
cumple I005-T-10 y la Definition of Done final sin modificar el conjunto documental congelado.
La verificación determinista previa fue satisfactoria: **142/142 tests**. El cierre documental
no repite inferencias ni modifica resultados, controles, código o dependencias.

### Evidencias aceptadas

Rutas relativas a la raíz del proyecto, privadas y excluidas de Git:

| Evidencia              | Ruta                                                            | SHA-256                                                            |
| ---------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------ |
| Llama                  | `evals/reports/i005/dcbb6044-d320-4d9f-bdf4-a9504b4c2cae.json`  | `52d7d1faa133182ac3ea36a04bb009e01af6acb7ff0e64bcce5df3c299aa962c` |
| Gemma                  | `evals/reports/i005/f722bc85-6d9e-4e6a-8468-d3ccae79ba5c.json`  | `a213d0025a35831080d8a3d12ff06a059f7bf6f732032db5c100db15a49476fd` |
| Comparación emparejada | `evals/reports/i005-analysis/comparison-dcbb6044-f722bc85.json` | `e25f50e334183aa59a6343c7cde8a9bf4cf1ec8ea6c1fddff26e71dc4bc5da14` |

Paquete externo autorizado:
`~/Lab/ai-suppor-platform-results/i005/i005-evidence-2026-11-10-v1-private.tar.gz`.
SHA-256: `21cb78a9166fdcec2e14945585994ffa96c8f8174ef3d0294245a7967775a1ca`.
Tamaño: 184.357 bytes; 78 miembros, 77 inventariados y 74 cotejados contra originales.
Su sidecar `.sha256` y recibo `.verification.json` fueron verificados nuevamente al cierre.
Recibo local: `evals/reports/i005-analysis/i005-ac13-preservation-2026-11-10-v1.verification.json`.
La síntesis de auditoría previa está en `preservation/final-audit.md` dentro del paquete.
El paquete es una instantánea anterior al cierre y permanece inmutable.

### Resultado y límites aceptados

Llama: **68/90**, accuracy **75,555556 %**, macro-F1 **0,7540674603**.
Gemma: **81/90**, accuracy **90 %**, macro-F1 **0,9004662005**.
Ganancia neta **+13/90**, equivalente a **+14,444444 puntos porcentuales**:
15 correcciones, 2 regresiones, 66 aciertos comunes y 7 errores comunes.
Umbral práctico observado **+9/90 cumplido**.

Bootstrap pareado estratificado, xorshift32 seed 5005, 10.000 remuestreos e intervalo
percentil nominal del 95 %: **[+7,777778; +22,222222] puntos porcentuales**.
El límite inferior equivale a +7/90 y no alcanza +9/90: se acepta la mejora observada,
sin garantía estadística de una mejora mínima equivalente al umbral práctico.

Las regresiones revisadas son `I005-BUG-030` (adversarial, BUG → FEATURE en Gemma) e
`I005-FEATURE-006` (legítima, FEATURE → QUESTION). Gemma conserva siete errores adversariales;
la coincidencia con una categoría inducida no demuestra causalmente obediencia al ataque.
Los 15 ataques explícitos no representan todas las formas de prompt injection.

Dataset independiente mediante controles procedimentales, pero sintético; una única ejecución
por modelo. Se comparan sistemas Ollama completos, incluidas sus plantillas nativas, sin
atribuir las diferencias exclusivamente a los pesos. Latencia y RSS son descriptivos: el
máximo observado por muestreo no es un pico real. No se demuestra superioridad general ni
comportamiento en producción. La copia externa está en el mismo disco; se recomienda una
segunda copia privada cifrada en soporte físicamente independiente.

### Aceptación de criterios

Todos los criterios se consideran satisfechos por la auditoría final aceptada y la aprobación
humana del 2026-11-10; la tabla referencia su evidencia sin cambiar requisitos normativos.

| Criterio   | Estado     | Evidencia de aceptación                                                                              |
| ---------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| I005-AC-01 | Satisfecho | Validador y fixtures deterministas; dataset de 90 casos y cuotas verificadas.                        |
| I005-AC-02 | Satisfecho | Matriz v3 y registro humano congelado de 90 decisiones, procedencia y exposición declaradas.         |
| I005-AC-03 | Satisfecho | Dataset v2, matriz v3 y 15 objetivos aprobados; seis identidades intactas.                           |
| I005-AC-04 | Satisfecho | Tests de payload/configuración, identidades en ambos runs y producción intacta.                      |
| I005-AC-05 | Satisfecho | Tests negativos, preflight y registro operativo de inicialización autorizada.                        |
| I005-AC-06 | Satisfecho | Regresiones deterministas de persistencia, presupuesto, bloqueo y concurrencia.                      |
| I005-AC-07 | Satisfecho | Runs completos Llama → Gemma, 90 + 90, sin reintentos ni warm-up.                                    |
| I005-AC-08 | Satisfecho | Tests de errores/parciales; cero errores técnicos o inciertos en los runs reales.                    |
| I005-AC-09 | Satisfecho | Métricas, matrices, subgrupos e inducidas recalculadas en la auditoría independiente.                |
| I005-AC-10 | Satisfecho | Comparación por ID y revisión aceptada de las dos regresiones, incluida la legítima.                 |
| I005-AC-11 | Satisfecho | Bootstrap reproducido independientemente y umbral observado interpretado con sus límites.            |
| I005-AC-12 | Satisfecho | Latencias, RSS, cobertura y límites registrados en informes y comparación.                           |
| I005-AC-13 | Satisfecho | Paquete externo reabierto, inventario/cotejo/sidecar y recibos verificados.                          |
| I005-AC-14 | Satisfecho | Verificación determinista previa: formato, lint, compilación y 142/142 tests; trazabilidad revisada. |
| I005-AC-15 | Satisfecho | Aprobación humana expresa y fechada; controles cerrados y cierre registrado aquí.                    |

**Verified** acredita el cumplimiento de criterios y el respaldo de las conclusiones por
las evidencias. No autoriza despliegue, selección automática de modelo ni nuevas ejecuciones.
Producción conserva `llama3.1:8b`, prompt original y timeout de 30 segundos. Presupuesto final:
**180/180**, cero reservas pendientes y todos los permisos efectivos desactivados. Las
aprobaciones históricas no se reabren ni se eliminan. No se realizan commits ni pushes.
