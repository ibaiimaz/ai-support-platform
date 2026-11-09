import { resolve } from 'node:path';
import { initializeLedger } from './budget.js';
import { fileURLToPath } from 'node:url';
import { models, phases, loadManifest, loadInputs, type Model, type Phase } from './protocol.js';
import { executeModelEvaluation, type Dependencies } from './execute.js';

export function parseArguments(args: readonly string[]): { phase: Phase; model: Model } {
  if (args.length !== 4) {
    throw new Error('Se requieren --phase y --model.');
  }
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]!;
    if (!['--phase', '--model'].includes(flag) || options.has(flag)) {
      throw new Error('Opciones no autorizadas.');
    }
    options.set(flag, args[i + 1]!);
  }
  const phase = options.get('--phase') as Phase;
  const model = options.get('--model') as Model;
  if (!phases.includes(phase) || !models.includes(model)) {
    throw new Error('Modelo o fase no autorizados.');
  }
  return { phase, model };
}

export async function executeCli(
  root: string,
  args: readonly string[],
  dependencies?: Dependencies,
) {
  try {
    if (args.length === 1 && args[0] === '--initialize') {
      const { manifest } = await loadManifest(root);
      await loadInputs(root, manifest);
      const initialized = await initializeLedger(resolve(root, 'evals/reports/i004'));
      return {
        exitCode: 0,
        output: JSON.stringify({ experimentId: 'I004', initialized: true, ...initialized }),
      };
    }
    const options = parseArguments(args);
    return await executeModelEvaluation(root, options.phase, options.model, dependencies);
  } catch {
    return {
      exitCode: 1,
      output:
        args[0] === '--initialize'
          ? 'I004 no inicializado: revise controles y evidencias; no se reinicia ni reconstruye presupuesto.'
          : 'Opciones I004 inválidas; ninguna inferencia iniciada.',
    };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await executeCli(process.cwd(), process.argv.slice(2));
  (result.exitCode === 0 ? console.log : console.error)(result.output);
  process.exitCode = result.exitCode;
}
