import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RetiredI006DiagnosticError } from './retired-i006.js';

// Historical implementation remains in Git. Do not inspect controls or provider before blocking.
export async function checkFirstInference(..._args: unknown[]): Promise<never> {
  throw new RetiredI006DiagnosticError();
}

export async function executeFirstInference(..._args: unknown[]): Promise<never> {
  throw new RetiredI006DiagnosticError();
}

export async function main(..._args: unknown[]): Promise<never> {
  throw new RetiredI006DiagnosticError();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('I006_DIAGNOSTIC_RETIRED');
    process.exitCode = 1;
  });
}
