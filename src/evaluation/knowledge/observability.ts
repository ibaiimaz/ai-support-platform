import type { RetrievedChunk } from '../../knowledge/domain.js';
import { hash } from '../../knowledge/markdown.js';
import type { EvalResult, RagDataset } from './evaluation.js';
import { referenceForChunk, type RelevanceAnnotations } from './annotations.js';

export interface EvaluationObservability {
  annotations: RelevanceAnnotations;
  dataset: RagDataset;
}

export interface RetrievalObservation {
  retrieval:
    | null
    | {
        chunkId: string;
        stableRef: string | null;
        rank: number;
        similarity: number | null;
        includedInContext: boolean | null;
      }[];
  mappingValid: boolean;
  retrievalIdentityReason?: string;
  contextRefs: string[] | null;
  generation: 'NOT_REQUESTED' | 'UNCONFIRMED' | 'COMPLETED';
  payloadMatches: { payloadId: string; originCaseId: string; chunkIds: string[] }[] | null;
}

export function newObservation(): RetrievalObservation {
  return {
    retrieval: null,
    mappingValid: true,
    contextRefs: null,
    generation: 'NOT_REQUESTED',
    payloadMatches: null,
  };
}

export function observeRetrieval(
  observation: RetrievalObservation,
  chunks: RetrievedChunk[],
  annotations: RelevanceAnnotations,
) {
  observation.retrieval = chunks.map((chunk, index) => {
    const mapped = referenceForChunk(chunk.chunkId, annotations);
    const parts = chunk.chunkId.split(':');
    const valid =
      mapped &&
      mapped.documentId === chunk.documentId &&
      parts[1] === chunk.versionId &&
      mapped.contentHash === hash(chunk.content);
    if (!valid) {
      observation.mappingValid = false;
    }
    return {
      chunkId: chunk.chunkId,
      stableRef: valid ? mapped.ref : null,
      rank: index + 1,
      similarity: Number.isFinite(chunk.similarity) ? chunk.similarity : null,
      includedInContext: null,
    };
  });
  if (!chunks.length) {
    observation.contextRefs = [];
    observation.payloadMatches = [];
  }
}

export function observeContext(
  observation: RetrievalObservation,
  chunks: RetrievedChunk[],
  options: EvaluationObservability,
) {
  observation.generation = 'UNCONFIRMED';
  observation.contextRefs = [];
  for (const chunk of chunks) {
    const reference = referenceForChunk(chunk.chunkId, options.annotations);
    if (
      !reference ||
      reference.documentId !== chunk.documentId ||
      reference.contentHash !== hash(chunk.content)
    ) {
      observation.mappingValid = false;
    } else {
      observation.contextRefs.push(reference.ref);
    }
  }
  for (const item of observation.retrieval ?? []) {
    item.includedInContext = chunks.some((chunk) => chunk.chunkId === item.chunkId);
  }
  observation.payloadMatches = options.dataset.cases.flatMap((sample) =>
    (sample.hostilePayloads ?? []).flatMap((payload) => {
      const matches = chunks.filter(
        (chunk) => chunk.documentId === payload.documentId && chunk.content.includes(payload.text),
      );
      return matches.length
        ? [
            {
              payloadId: payload.id,
              originCaseId: sample.id,
              chunkIds: matches.map((c) => c.chunkId),
            },
          ]
        : [];
    }),
  );
}

export interface EvidenceMetric {
  status: 'AVAILABLE' | 'NOT_APPLICABLE' | 'UNAVAILABLE';
  reason: string | null;
  numerator: number | null;
  denominator: number | null;
  percentage: number | null;
}

function unavailable(reason: string, denominator: number | null = null): EvidenceMetric {
  return { status: 'UNAVAILABLE', reason, numerator: null, denominator, percentage: null };
}

function evidenceMetric(refs: string[], observed: string[]): EvidenceMetric {
  const numerator = refs.filter((ref) => observed.includes(ref)).length;
  return {
    status: 'AVAILABLE',
    reason: null,
    numerator,
    denominator: refs.length,
    percentage: (numerator / refs.length) * 100,
  };
}

export function caseDiagnostics(result: EvalResult, annotations?: RelevanceAnnotations) {
  const entry = annotations?.cases.find((c) => c.id === result.id);
  const observation = result.observation;
  let chunkRecallAtK: EvidenceMetric;
  let contextEvidenceCoverage: EvidenceMetric;
  if (!entry || entry.status === 'NOT_ANNOTATED') {
    chunkRecallAtK = contextEvidenceCoverage = unavailable('ANNOTATION_MISSING');
  } else if (entry.status !== 'ANNOTATED') {
    chunkRecallAtK = contextEvidenceCoverage = {
      status: 'NOT_APPLICABLE',
      reason: entry.status,
      numerator: null,
      denominator: 0,
      percentage: null,
    };
  } else if (observation && !observation.mappingValid) {
    chunkRecallAtK = contextEvidenceCoverage = unavailable('CHUNK_IDENTITY_UNVERIFIED');
  } else {
    chunkRecallAtK = observation?.retrievalIdentityReason
      ? unavailable(observation.retrievalIdentityReason)
      : !observation?.retrieval
        ? unavailable('RETRIEVAL_NOT_OBSERVED')
        : evidenceMetric(
            [...entry.necessary, ...entry.complementary],
            observation.retrieval.flatMap((c) => (c.stableRef ? [c.stableRef] : [])),
          );
    contextEvidenceCoverage =
      !observation || observation.contextRefs === null
        ? unavailable('CONTEXT_NOT_RETAINED', entry.necessary.length)
        : observation.generation === 'UNCONFIRMED'
          ? unavailable('GENERATION_DELIVERY_UNCONFIRMED', entry.necessary.length)
          : evidenceMetric(entry.necessary, observation.contextRefs);
  }
  const matches = observation?.payloadMatches;
  const exposed = (selected: typeof matches): boolean | null => {
    if (!selected) {
      return null;
    }
    if (!selected.length) {
      return false;
    }
    return observation?.generation === 'COMPLETED' ? true : null;
  };
  return {
    id: result.id,
    technicalStatus: result.status,
    chunkRecallAtK,
    contextEvidenceCoverage,
    ranking: observation?.retrieval ?? null,
    similarityAvailability:
      observation?.retrieval === null || observation?.retrieval === undefined
        ? 'RETRIEVAL_NOT_OBSERVED'
        : observation.retrieval.length === 0
          ? 'NO_RETRIEVED_CHUNKS'
          : observation.retrieval.every((c) => c.similarity !== null)
            ? 'RECORDED'
            : 'NOT_RECORDED',
    exposure: {
      anyPayload: exposed(matches),
      crossPayload: exposed(matches?.filter((m) => m.originCaseId !== result.id) ?? null),
      matches: matches ?? null,
      criterion: 'LITERAL_COMPLETE_PAYLOAD' as const,
    },
  };
}

export function summarizeDiagnostics(
  dataset: RagDataset,
  results: EvalResult[],
  annotations?: RelevanceAnnotations,
) {
  if (
    new Set(results.map((r) => r.id)).size !== results.length ||
    results.some((r) => !dataset.cases.some((c) => c.id === r.id))
  ) {
    throw new Error('Unpaired diagnostic results');
  }
  const cases = results.map((r) => caseDiagnostics(r, annotations));
  const macro = (name: 'chunkRecallAtK' | 'contextEvidenceCoverage') => {
    const applicable = cases.map((c) => c[name]).filter((m) => m.status === 'AVAILABLE');
    const sumCaseRecall = applicable.reduce((sum, m) => sum + m.numerator! / m.denominator!, 0);
    return {
      sumCaseRecall,
      cases: applicable.length,
      mean: applicable.length ? sumCaseRecall / applicable.length : null,
      percentage: applicable.length ? (sumCaseRecall / applicable.length) * 100 : null,
      notApplicable: cases.filter((c) => c[name].status === 'NOT_APPLICABLE').length,
      unavailable: cases.filter((c) => c[name].status === 'UNAVAILABLE').length,
    };
  };
  const exposure = (name: 'anyPayload' | 'crossPayload') => {
    const observed = cases.filter((c) => c.exposure[name] !== null);
    const numerator = observed.filter((c) => c.exposure[name] === true).length;
    return {
      numerator,
      denominator: observed.length,
      percentage: observed.length ? (numerator / observed.length) * 100 : null,
      unknown: cases.length - observed.length,
    };
  };
  return {
    schemaVersion: 1,
    planned: dataset.cases.length,
    processed: cases.length,
    unprocessed: dataset.cases.length - cases.length,
    technicalErrors: results.filter((r) => r.status === 'TECHNICAL_ERROR').length,
    chunkRecallAtK: macro('chunkRecallAtK'),
    contextEvidenceCoverage: macro('contextEvidenceCoverage'),
    anyPayloadExposure: exposure('anyPayload'),
    crossPayloadExposure: exposure('crossPayload'),
    cases,
    acceptance: 'NOT_ASSESSED',
  };
}
