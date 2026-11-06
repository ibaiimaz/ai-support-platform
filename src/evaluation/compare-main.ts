import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAnyReport } from './report.js';
import { loadManifest } from './experiment-manifest.js';
import { compareReports } from './comparison.js';
import { assessCandidate, type RegressionReview } from './decisions.js';

export async function compareFiles(root: string, args: readonly string[]) {
  if (args.length < 2 || args.length > 3) {
    throw new Error('Indique baseline, candidato y revisión humana opcional.');
  }

  const baseline: unknown = JSON.parse(await readFile(resolve(root, args[0]!), 'utf8'));
  const candidate: unknown = JSON.parse(await readFile(resolve(root, args[1]!), 'utf8'));
  validateAnyReport(baseline);
  validateAnyReport(candidate);

  if (baseline.schemaVersion !== 2 || candidate.schemaVersion !== 2) {
    throw new Error(
      'Informes históricos válidos, pero sin contexto I003 para comparación experimental.',
    );
  }

  const { manifest, protocolSha256 } = await loadManifest(root, baseline.experiment.phase);

  if (baseline.experiment.protocolSha256 !== protocolSha256) {
    throw new Error('Protocolo del informe distinto del manifiesto.');
  }

  const comparison = compareReports(
    baseline,
    candidate,
    manifest.datasets[baseline.experiment.phase].targets,
  );
  let review: RegressionReview | undefined;

  if (args[2]) {
    review = JSON.parse(await readFile(resolve(root, args[2]), 'utf8')) as RegressionReview;
  }

  return {
    comparison,
    assessment: assessCandidate(comparison, review),
    promotionAuthorized: false,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await compareFiles(process.cwd(), process.argv.slice(2)), null, 2));
  } catch {
    console.error('No se pudo comparar: revise informes, protocolo y revisión humana.');
    process.exitCode = 1;
  }
}
