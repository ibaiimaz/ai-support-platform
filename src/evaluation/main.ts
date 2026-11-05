import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, type Config } from '../config.js';
import type { IncidentClassifier } from '../application/incident-classifier.js';
import { OllamaClassifier } from '../infrastructure/ollama/ollama-classifier.js';
import { loadDataset } from './dataset.js';
import { runEvaluation } from './run-evaluation.js';
import { buildReport, writeReport } from './report.js';

function findCodeReference(rootDirectory: string): string | null {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: rootDirectory,
      encoding: 'utf8',
      timeout: 1000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

    return /^[a-f0-9]{40,64}$/.test(commit) ? `git:${commit}` : null;
  } catch {
    return null;
  }
}

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
  const result = await executeEvaluation(process.cwd());
  const print = result.exitCode === 0 ? console.log : console.error;
  print(result.output);
  process.exitCode = result.exitCode;
}
