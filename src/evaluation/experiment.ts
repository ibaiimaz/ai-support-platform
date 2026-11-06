import { resolve } from 'node:path';
import { loadConfig, type Config } from '../config.js';
import type { IncidentClassifier } from '../application/incident-classifier.js';
import { OllamaClassifier } from '../infrastructure/ollama/ollama-classifier.js';
import { loadManifest, type Phase } from './experiment-manifest.js';
import { findPrompt } from './prompts.js';
import { loadDataset } from './dataset.js';
import { runEvaluation } from './run-evaluation.js';
import { buildExperimentReport, writeReport } from './report.js';
import { reserveAttempt, withExperimentLedger } from './experiment-budget.js';
import { findCodeReference } from './code-reference.js';

export async function executeExperiment(
  root: string,
  phase: Phase,
  promptId: string,
  env: NodeJS.ProcessEnv = process.env,
  createClassifier: (config: Config, text: string) => IncidentClassifier = (config, text) =>
    new OllamaClassifier(config, text),
): Promise<{ exitCode: number; output: string }> {
  try {
    const source = await loadManifest(root, phase);
    const manifest = source.manifest;
    const prompt = findPrompt(promptId);
    const reference = manifest.datasets[phase];

    if (
      !manifest.authorization[phase] ||
      (manifest.authorization[phase] === 'baseline-only' &&
        (prompt.role !== 'baseline' || prompt.id !== 'i001-original')) ||
      reference.reviewStatus !== 'approved' ||
      !reference.frozen ||
      !reference.approvedBy
    ) {
      throw new Error('Fase o dataset sin aprobación humana.');
    }

    if (
      prompt.role === 'candidate' &&
      (!manifest.prompts.some((item) => item.id === prompt.id && item.sha256 === prompt.sha256) ||
        (phase === 'validation' && manifest.selection.promptId !== prompt.id))
    ) {
      throw new Error('Candidato no registrado o no seleccionado para validación.');
    }

    const config = loadConfig(env);

    if (
      config.model !== manifest.protocol.model ||
      config.timeoutMs !== manifest.protocol.timeoutMs ||
      new URL(config.baseUrl).origin !== manifest.protocol.providerOrigin
    ) {
      throw new Error('Configuración distinta del protocolo aprobado.');
    }

    const loaded = await loadDataset(resolve(root, reference.path), reference.path);

    if (
      loaded.sha256 !== reference.sha256 ||
      loaded.dataset.id !== reference.id ||
      loaded.dataset.version !== reference.version
    ) {
      throw new Error('Dataset distinto de la referencia congelada.');
    }

    const adversarial = loaded.dataset.examples.filter(
      (example) => example.difficulty === 'adversarial',
    );

    if (
      adversarial.some(
        (example) =>
          !reference.targets[example.id] ||
          reference.targets[example.id] === example.expectedCategory,
      )
    ) {
      throw new Error('Objetivos inducidos no corresponden a los ataques.');
    }

    const classifier = createClassifier(config, prompt.text);

    return await withExperimentLedger(resolve(root, 'evals/reports'), async (ledger, save) => {
      const reservation = reserveAttempt(
        ledger,
        prompt,
        phase,
        loaded.sha256,
        source.protocolSha256,
      );
      await save();
      const run = await runEvaluation(loaded.dataset.examples, classifier);
      const report = buildExperimentReport(loaded, config, run, findCodeReference(root), prompt, {
        phase,
        manifestSha256: source.sha256,
        protocolSha256: source.protocolSha256,
        reservationId: reservation.id,
      });
      await writeReport(resolve(root, 'evals/reports'), report);
      reservation.status = run.complete ? 'completed' : 'incomplete';
      reservation.reportRunId = report.runId;
      await save();

      return {
        exitCode: run.complete ? 0 : 1,
        output: JSON.stringify({
          runId: report.runId,
          promptId: prompt.id,
          complete: report.complete,
          reportPath: `evals/reports/${report.runId}.json`,
          counts: report.execution,
        }),
      };
    });
  } catch {
    return {
      exitCode: 1,
      output:
        'Experimento no ejecutado o incompleto. Revise autorizaciones, protocolo, dataset e informes; no se realizarán reintentos automáticos.',
    };
  }
}

export function parseExperimentArguments(args: readonly string[]): {
  phase: Phase;
  promptId: string;
} {
  if (args.length !== 4) {
    throw new Error('Se requieren --prompt y --phase explícitos.');
  }

  const options = new Map<string, string>();

  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]!;

    if (!['--prompt', '--phase'].includes(flag) || options.has(flag)) {
      throw new Error('Opciones experimentales inválidas.');
    }

    options.set(flag, args[index + 1]!);
  }

  const phase = options.get('--phase');
  const promptId = options.get('--prompt');

  if ((phase !== 'development' && phase !== 'validation') || !promptId) {
    throw new Error('Fase o prompt inválidos.');
  }

  findPrompt(promptId);

  return { phase, promptId };
}
