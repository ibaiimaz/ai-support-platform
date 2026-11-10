import { resolve } from 'node:path';
import type { BuildSnapshot } from './build-snapshot.js';
import { access } from 'node:fs/promises';
import {
  loadOperation,
  loadFrozenInputs,
  requirePermission,
  models,
  type Model,
} from './protocol.js';
import { initializeLedger, readLedger, effectiveAuthorization } from './budget.js';
import { executeIndependent, type Dependencies } from './execute.js';
import { compareIndependentFiles } from './compare.js';

export function parseArguments(args: readonly string[]) {
  if (args.length === 1 && ['--validate', '--initialize'].includes(args[0]!)) {
    return { command: args[0]!, model: null };
  }
  if (args.length === 3 && args[0] === '--compare') {
    return { command: '--compare', paths: args.slice(1), model: null };
  }
  if (
    args.length === 4 &&
    args[0] === '--phase' &&
    args[1] === 'validation' &&
    args[2] === '--model' &&
    models.includes(args[3] as Model)
  ) {
    return { command: 'execute', model: args[3] as Model };
  }
  throw new Error('Opciones I005 no autorizadas.');
}

export async function executeCli(
  root: string,
  args: readonly string[],
  dependencies?: Dependencies,
  startup?: BuildSnapshot,
) {
  try {
    const selection = parseArguments(args);
    if (selection.command === '--compare') {
      return {
        exitCode: 0,
        output: JSON.stringify(await compareIndependentFiles(root, selection.paths!)),
      };
    }
    const source = await loadOperation(root);
    await loadFrozenInputs(root);
    if (selection.command === '--validate') {
      let permissions = source.operation.authorization;
      const directory = resolve(root, 'evals/reports/i005');
      let initialized = true;
      try {
        await access(directory);
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
          throw error;
        }
        initialized = false;
      }
      if (initialized) {
        permissions = effectiveAuthorization(
          source.operation,
          (await readLedger(directory)).ledger,
        ) as typeof permissions;
      }
      return {
        exitCode: 0,
        output: JSON.stringify({
          experimentId: 'I005',
          integrity: 'valid',
          freezeManifestSha256: source.operation.freezeManifestSha256,
          operationSha256: source.sha256,
          executionAuthorized: models.map((model) => ({
            model,
            approved: permissions[model].approved,
          })),
          inferencesAdded: 0,
        }),
      };
    }
    if (selection.command === '--initialize') {
      requirePermission(source.operation, 'initialize');
      const budget = await initializeLedger(resolve(root, 'evals/reports/i005'));
      return {
        exitCode: 0,
        output: JSON.stringify({ experimentId: 'I005', initialized: true, ...budget }),
      };
    }
    return await executeIndependent(root, selection.model!, dependencies, startup);
  } catch {
    return {
      exitCode: 1,
      output:
        'I005 bloqueado. Revise autorizaciones, integridad y evidencia; no se inicia ni reintenta automáticamente.',
    };
  }
}
