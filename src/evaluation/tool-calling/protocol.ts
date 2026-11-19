import { extractIncidentReferences } from '../../application/incident-references.js';

export const classificationCohort = 'KNOWN_REGRESSION' as const;

export const classificationProtocolId = 'I006-HYBRID-CLASSIFICATION-V1' as const;

export const classificationAuthorizationFile = 'i006-hybrid-manifest.json';

export const classificationReportsDirectory = 'i006-hybrid';

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
