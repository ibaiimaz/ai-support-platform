import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, type Config } from '../config.js';
import type { IncidentClassifier } from '../application/incident-classifier.js';
import { OllamaClassifier } from '../infrastructure/ollama/ollama-classifier.js';
import { loadDataset } from './dataset.js';
import { runEvaluation } from './run-evaluation.js';
import { buildReport, writeReport } from './report.js';
import { findCodeReference } from './code-reference.js';
import { executeExperiment, parseExperimentArguments } from './experiment.js';

export async function executeEvaluation(
  rootDirectory: string,
  env: NodeJS.ProcessEnv = process.env,
  createClassifier: (config: Config) => IncidentClassifier = (config) =>
    new OllamaClassifier(config),
): Promise<{ exitCode: number; output: string }> {
  try {
    const config = loadConfig(env);
    const datasetPath = 'evals/datasets/incidents-v1.json';
    const loaded = await loadDataset(resolve(rootDirectory, datasetPath), datasetPath);
    const codeReference = findCodeReference(rootDirectory);
    const run = await runEvaluation(loaded.dataset.examples, createClassifier(config));
    const report = buildReport(loaded, config, run, codeReference);
    await writeReport(resolve(rootDirectory, 'evals/reports'), report);

    return {
      exitCode: run.complete ? 0 : 1,
      output: JSON.stringify({
        runId: report.runId,
        complete: report.complete,
        counts: report.execution,
        metrics: report.metrics,
        reportPath: `evals/reports/${report.runId}.json`,
      }),
    };
  } catch {
    return {
      exitCode: 1,
      output:
        'No se pudo completar o guardar la evaluación. Revise configuración, dataset y directorio de informes.',
    };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let result: { exitCode: number; output: string };

  try {
    const args = process.argv.slice(2);

    if (args.length === 0) {
      result = await executeEvaluation(process.cwd());
    } else {
      const selection = parseExperimentArguments(args);
      result = await executeExperiment(process.cwd(), selection.phase, selection.promptId);
    }
  } catch {
    result = {
      exitCode: 1,
      output: 'Opciones de evaluación inválidas; no se ha iniciado ninguna inferencia.',
    };
  }
  const print = result.exitCode === 0 ? console.log : console.error;
  print(result.output);
  process.exitCode = result.exitCode;
}
