import { extractIncidentReferences } from '../../application/incident-references.js';

export const classificationCohort = 'KNOWN_REGRESSION' as const;

export const classificationProtocolId = 'I006-HYBRID-CLASSIFICATION-V1' as const;

export type EvaluationCohort = 'KNOWN_REGRESSION' | 'INDEPENDENT_HOLDOUT';

export function cohortSettings(cohort: EvaluationCohort) {
  if (cohort === 'KNOWN_REGRESSION') {
    return {
      datasetId: 'incidents-tool-calling-es-v1',
      datasetFile: 'incidents-tool-calling-v1.json',
      authorizationFile: 'i006-r7-known-manifest.json',
      reportsDirectory: 'i006-r7-known',
      maximumInferences: 104,
    } as const;
  }
  if (cohort === 'INDEPENDENT_HOLDOUT') {
    return {
      datasetId: 'incidents-tool-calling-holdout-es-v1',
      datasetFile: 'incidents-tool-calling-holdout-v1.json',
      authorizationFile: 'i006-r7-holdout-manifest.json',
      reportsDirectory: 'i006-r7-holdout',
      maximumInferences: 105,
    } as const;
  }
  throw new Error('Unknown I006 cohort');
}

export const candidateModel = {
  model: 'qwen3:8b',
  digest: '500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41',
  quantization: 'Q4_K_M',
  think: false,
} as const;

export function plannedPhases(description: string): ('decision' | 'classification')[] {
  return extractIncidentReferences(description).length === 0
    ? ['classification']
    : ['decision', 'classification'];
}
