import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { verifyKnowledgeCodeIdentity } from './code-identity.js';

async function main() {
  if (fileURLToPath(import.meta.url) !== resolve('dist/src/evaluation/knowledge/main.js')) {
    throw new Error('Unexpected evaluation entrypoint');
  }
  const args = process.argv.slice(2);
  if (args[0] === '--run' && (process.execArgv.length || process.env.NODE_OPTIONS?.trim())) {
    throw new Error('Evaluation execution requires an unmodified Node launcher');
  }
  // Historical review remains offline and independent of the current build identity.
  const identity = args[0] === '--review' ? undefined : await verifyKnowledgeCodeIdentity();
  const { runKnowledgeEvaluation } = await import('./runner.js');
  await runKnowledgeEvaluation(identity);
}

main().catch(() => {
  console.error('La evaluación de conocimiento no pudo prepararse. No se muestran datos internos.');
  process.exitCode = 1;
});
