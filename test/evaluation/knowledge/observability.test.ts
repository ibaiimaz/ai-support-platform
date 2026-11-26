import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  loadAnnotations,
  validateAnnotations,
} from '../../../src/evaluation/knowledge/annotations.js';
import {
  caseDiagnostics,
  summarizeDiagnostics,
} from '../../../src/evaluation/knowledge/observability.js';
import { analyzeHistoricalReport } from '../../../src/evaluation/knowledge/retrospective.js';
import {
  evaluateCase,
  runBaseline,
  summarize,
  type RagDataset,
} from '../../../src/evaluation/knowledge/evaluation.js';
import { chunkMarkdown, hash, readCorpus } from '../../../src/knowledge/markdown.js';
import { KnowledgeError } from '../../../src/knowledge/domain.js';
import { dependencies } from '../../knowledge/helpers.js';

async function fixture() {
  const bytes = await readFile('evals/knowledge/i007-cases.json');
  const dataset = JSON.parse(bytes.toString()) as RagDataset;
  const documents = await readCorpus('knowledge/corpus');
  const { annotations, identity } = await loadAnnotations(dataset, hash(bytes), documents, {
    size: 1200,
    overlap: 150,
  });
  const chunks = documents.flatMap((d) =>
    chunkMarkdown(d.body, 1200, 150).map((c) => ({
      documentId: d.documentId,
      versionId: 'fixture-version',
      chunkId: `${d.documentId}:fixture-version:${c.position}`,
      title: d.title,
      section: c.section,
      content: c.content,
      similarity: 0.9 - c.position * 0.1,
    })),
  );
  const get = (ref: string) => {
    const value = chunks.find((c) => `${c.documentId}:${c.chunkId.split(':')[2]}` === ref);
    assert.ok(value);
    return value;
  };
  const provider = (refs: string[], maxContextChunks = 4) => {
    const deps = dependencies(refs.map(get));
    deps.maxContextChunks = maxContextChunks;
    deps.generator.generate = async (_question, context) => ({
      status: 'ANSWER',
      answer: 'Respuesta sintética.',
      chunkIds: [context[0]!.chunkId],
    });
    return deps;
  };
  return {
    dataset,
    documents,
    annotations,
    identity,
    get,
    provider,
    options: { annotations, dataset },
  };
}

test('I007 C anotaciones propuestas: 20 casos, 22 fragmentos estables y compatibilidad estricta', async () => {
  const f = await fixture();
  assert.equal(f.annotations.cases.length, 20);
  assert.equal(f.annotations.chunks.length, 22);
  assert.equal(f.annotations.cases.filter((c) => c.status === 'ANNOTATED').length, 13);
  assert.equal(f.annotations.cases.filter((c) => c.status === 'NO_RELEVANT_EVIDENCE').length, 4);
  assert.equal(f.annotations.cases.filter((c) => c.status === 'NOT_APPLICABLE').length, 3);
  assert.deepEqual(f.annotations.cases.find((c) => c.id === 'I007-008')?.necessary, [
    'roles:1',
    'webhooks:0',
  ]);
  for (const mutation of [
    (a: typeof f.annotations) => {
      a.datasetHash = '0'.repeat(64);
    },
    (a: typeof f.annotations) => {
      a.datasetVersion++;
    },
    (a: typeof f.annotations) => {
      a.corpusHash = '0'.repeat(64);
    },
    (a: typeof f.annotations) => {
      a.chunking.size++;
    },
    (a: typeof f.annotations) => {
      a.chunks[0]!.contentHash = '0'.repeat(64);
    },
    (a: typeof f.annotations) => {
      a.cases[0]!.necessary.push('invented:0');
    },
    (a: typeof f.annotations) => {
      a.cases[0]!.complementary.push(a.cases[0]!.necessary[0]!);
    },
    (a: typeof f.annotations) => {
      a.cases[1]!.id = a.cases[0]!.id;
    },
    (a: typeof f.annotations) => {
      a.chunks[1] = structuredClone(a.chunks[0]!);
    },
  ]) {
    const invalid = structuredClone(f.annotations);
    mutation(invalid);
    assert.throws(() =>
      validateAnnotations(invalid, f.dataset, f.annotations.datasetHash, f.documents, {
        size: 1200,
        overlap: 150,
      }),
    );
  }
});

test('I007 C recuperación completa/parcial/nula y exclusión posterior tienen denominadores distintos', async () => {
  const f = await fixture();
  const sample = f.dataset.cases[7]!;
  for (const [refs, cap, expectedRecall, expectedCoverage] of [
    [['webhooks:0', 'roles:1'], 2, 100, 100],
    [['webhooks:0'], 2, 50, 50],
    [[], 2, 0, 0],
    [['webhooks:0', 'roles:1'], 1, 100, 50],
  ] as const) {
    const result = await evaluateCase(f.provider([...refs], cap), sample, false, f.options);
    const diagnostic = caseDiagnostics(result, f.annotations);
    assert.equal(diagnostic.chunkRecallAtK.percentage, expectedRecall);
    assert.equal(diagnostic.contextEvidenceCoverage.percentage, expectedCoverage);
    assert.equal(diagnostic.chunkRecallAtK.denominator, 2);
    assert.equal(diagnostic.contextEvidenceCoverage.denominator, 2);
    assert.equal(result.reviewContent, undefined);
  }
  const result = await evaluateCase(
    f.provider(['attachments:0']),
    f.dataset.cases[2]!,
    false,
    f.options,
  );
  const diagnostic = caseDiagnostics(result, f.annotations);
  assert.equal(
    diagnostic.chunkRecallAtK.percentage,
    50,
    'Complementary relevant chunk belongs to recall denominator',
  );
  assert.equal(
    diagnostic.contextEvidenceCoverage.percentage,
    100,
    'Only necessary evidence belongs to context denominator',
  );
});

test('I007 C ausencia de anotación, ausencia de evidencia y no aplicabilidad no se convierten en cero', async () => {
  const f = await fixture();
  for (const [index, reason] of [
    [10, 'NO_RELEVANT_EVIDENCE'],
    [15, 'NOT_APPLICABLE'],
  ] as const) {
    const result = await evaluateCase(f.provider([]), f.dataset.cases[index]!, false, f.options);
    const d = caseDiagnostics(result, f.annotations);
    assert.equal(d.chunkRecallAtK.percentage, null);
    assert.equal(d.chunkRecallAtK.reason, reason);
    assert.equal(d.chunkRecallAtK.status, 'NOT_APPLICABLE');
  }
  const result = await evaluateCase(f.provider([]), f.dataset.cases[0]!, false, f.options);
  assert.equal(caseDiagnostics(result).chunkRecallAtK.reason, 'ANNOTATION_MISSING');
  const annotations = structuredClone(f.annotations);
  annotations.cases[0] = {
    ...annotations.cases[0]!,
    status: 'NOT_ANNOTATED',
    necessary: [],
    complementary: [],
  };
  assert.equal(caseDiagnostics(result, annotations).chunkRecallAtK.reason, 'ANNOTATION_MISSING');
  assert.equal(summarizeDiagnostics(f.dataset, [], f.annotations).chunkRecallAtK.mean, null);
  assert.equal(summarizeDiagnostics(f.dataset, [], f.annotations).unprocessed, 20);
});

test('I007 C ranking conserva orden, puntuaciones reales y pertenencia al contexto sin textos privados', async () => {
  const f = await fixture();
  const deps = f.provider(['roles:1', 'webhooks:0'], 1);
  const result = await evaluateCase(deps, f.dataset.cases[7]!, false, f.options);
  assert.deepEqual(result.observation?.retrieval, [
    {
      chunkId: f.get('roles:1').chunkId,
      stableRef: 'roles:1',
      rank: 1,
      similarity: 0.8,
      includedInContext: true,
    },
    {
      chunkId: f.get('webhooks:0').chunkId,
      stableRef: 'webhooks:0',
      rank: 2,
      similarity: 0.9,
      includedInContext: false,
    },
  ]);
  const encoded = JSON.stringify(result);
  assert.ok(!encoded.includes(f.get('roles:1').content));
  assert.ok(!encoded.includes('Respuesta sintética.'));
  const mismatch = f.get('roles:1');
  const bad = f.provider(['roles:1']);
  bad.repository = dependencies([{ ...mismatch, content: 'Different corpus version' }]).repository;
  const invalid = await evaluateCase(bad, f.dataset.cases[7]!, false, f.options);
  assert.equal(
    caseDiagnostics(invalid, f.annotations).chunkRecallAtK.reason,
    'CHUNK_IDENTITY_UNVERIFIED',
  );
});

test('I007 C exposición propia, cruzada y ausente se observa también fuera de los casos adversariales', async () => {
  const f = await fixture();
  const own = await evaluateCase(
    f.provider(['audit:0', 'audit:1']),
    f.dataset.cases[18]!,
    false,
    f.options,
  );
  const cross = await evaluateCase(f.provider(['audit:1']), f.dataset.cases[0]!, false, f.options);
  const none = await evaluateCase(f.provider(['access:1']), f.dataset.cases[1]!, false, f.options);
  const excluded = await evaluateCase(
    f.provider(['access:1', 'audit:1'], 1),
    f.dataset.cases[2]!,
    false,
    f.options,
  );
  assert.equal(caseDiagnostics(own, f.annotations).exposure.anyPayload, true);
  assert.equal(caseDiagnostics(own, f.annotations).exposure.crossPayload, false);
  assert.equal(caseDiagnostics(cross, f.annotations).exposure.crossPayload, true);
  assert.deepEqual(
    cross.observation?.payloadMatches?.map((m) => [m.payloadId, m.originCaseId]),
    [['I007-PAYLOAD-019', 'I007-019']],
  );
  assert.equal(caseDiagnostics(none, f.annotations).exposure.anyPayload, false);
  assert.equal(caseDiagnostics(excluded, f.annotations).exposure.anyPayload, false);
  const total = summarizeDiagnostics(f.dataset, [own, cross, none, excluded], f.annotations);
  assert.deepEqual(total.anyPayloadExposure, {
    numerator: 2,
    denominator: 4,
    percentage: 50,
    unknown: 0,
  });
  assert.deepEqual(total.crossPayloadExposure, {
    numerator: 1,
    denominator: 4,
    percentage: 25,
    unknown: 0,
  });
});

test('I007 C errores técnicos y lote parcial conservan observaciones y no inventan entrega', async () => {
  const f = await fixture();
  const deps = f.provider(['audit:1']);
  let sends = 0;
  deps.generator.generate = async (_question, chunks) => {
    sends++;
    if (sends === 2) {
      throw new KnowledgeError('GENERATION_TIMEOUT');
    }
    return { status: 'ANSWER', answer: 'Synthetic', chunkIds: [chunks[0]!.chunkId] };
  };
  const saved: string[] = [];
  const results = await runBaseline(
    deps,
    f.dataset,
    async (r) => {
      saved.push(JSON.stringify(r));
    },
    {
      expected: { model: 'fake', digest: 'a'.repeat(64) },
      async read() {
        return { model: 'fake', digest: 'a'.repeat(64) };
      },
    },
    false,
    f.options,
  );
  assert.equal(sends, 2);
  assert.equal(saved.length, 2);
  const d = summarizeDiagnostics(f.dataset, results, f.annotations);
  assert.equal(d.technicalErrors, 1);
  assert.equal(d.unprocessed, 18);
  assert.equal(
    d.chunkRecallAtK.cases,
    2,
    'Retrieval is observed even for an error after retrieval',
  );
  assert.equal(d.contextEvidenceCoverage.cases, 1);
  assert.equal(d.cases[1]?.contextEvidenceCoverage.reason, 'GENERATION_DELIVERY_UNCONFIRMED');
  assert.equal(d.cases[1]?.exposure.anyPayload, null);
  assert.equal(d.anyPayloadExposure.denominator, 1);
  const notObserved = f.provider([]);
  notObserved.embeddings = {
    ...notObserved.embeddings,
    async embed() {
      throw new KnowledgeError('EMBEDDING_TIMEOUT');
    },
  };
  const failure = await evaluateCase(notObserved, f.dataset.cases[0]!, false, f.options);
  assert.equal(
    caseDiagnostics(failure, f.annotations).chunkRecallAtK.reason,
    'RETRIEVAL_NOT_OBSERVED',
  );
});

test('I007 C observabilidad conserva petición, respuesta y métricas históricas', async () => {
  const f = await fixture();
  const first = await evaluateCase(f.provider(['access:1']), f.dataset.cases[0]!, true);
  const second = await evaluateCase(f.provider(['access:1']), f.dataset.cases[0]!, true, f.options);
  assert.deepEqual(first.reviewContent, second.reviewContent);
  const normalize = (r: typeof first) => ({ ...r, latencyMs: 0, retrievalLatencyMs: 0 });
  const { observation: _observation, ...observed } = normalize(second);
  assert.deepEqual(observed, normalize(first));
  assert.deepEqual(
    summarize(f.dataset, [normalize(second)]),
    summarize(f.dataset, [normalize(first)]),
  );
  const before = JSON.parse(await readFile('package.json', 'utf8'));
  assert.ok(before.scripts['eval:knowledge']);
});

test('I007 C retrospectivo v1/v2 usa solo observaciones retenidas y mantiene scores no disponibles', async () => {
  const f = await fixture();
  const result = await evaluateCase(
    f.provider(['webhooks:0', 'roles:1'], 1),
    f.dataset.cases[7]!,
    true,
  );
  const report = {
    schemaVersion: 1,
    runId: 'synthetic',
    codeHash: 'ec1b50a57424b1b7cee0121871da6474e3e281c683bc3d4f973e7d39d666ee11',
    config: { chunkSize: 1200, chunkOverlap: 150 },
    datasetHash: f.annotations.datasetHash,
    corpusHash: f.annotations.corpusHash,
    activeVersions: [...new Set(f.annotations.chunks.map((c) => c.documentId))].map(
      (documentId) => ({ documentId, versionId: 'fixture-version' }),
    ),
    results: [result],
  };
  for (const version of [1, 2]) {
    const bytes = Buffer.from(JSON.stringify({ ...report, schemaVersion: version }));
    const derived = analyzeHistoricalReport(bytes, f.dataset, f.annotations);
    assert.equal(derived.original.sha256, hash(bytes));
    assert.equal(
      derived.diagnostics.cases[0]?.chunkRecallAtK.reason,
      'RETRIEVED_CHUNK_CONTENT_UNVERIFIED',
    );
    assert.equal(derived.diagnostics.cases[0]?.contextEvidenceCoverage.percentage, 50);
    assert.equal(derived.diagnostics.cases[0]?.ranking?.[0]?.similarity, null);
    assert.equal(derived.diagnostics.cases[0]?.similarityAvailability, 'NOT_RECORDED');
  }
  assert.throws(
    () =>
      analyzeHistoricalReport(
        Buffer.from(
          JSON.stringify({
            ...report,
            results: [{ ...result, actualStatus: 'INSUFFICIENT_CONTEXT' }],
          }),
        ),
        f.dataset,
        f.annotations,
      ),
    /completion is inconsistent/,
  );
  assert.throws(
    () =>
      analyzeHistoricalReport(
        Buffer.from(
          JSON.stringify({
            ...report,
            results: [{ ...result, reviewContent: { context: result.reviewContent!.context } }],
          }),
        ),
        f.dataset,
        f.annotations,
      ),
    /Incompatible historical report/,
  );
  const { reviewContent: _private, ...without } = result;
  const missing = analyzeHistoricalReport(
    Buffer.from(JSON.stringify({ ...report, results: [without] })),
    f.dataset,
    f.annotations,
  );
  assert.equal(
    missing.diagnostics.cases[0]?.contextEvidenceCoverage.reason,
    'CONTEXT_NOT_RETAINED',
  );
  assert.equal(missing.diagnostics.cases[0]?.exposure.anyPayload, null);
  assert.throws(() =>
    analyzeHistoricalReport(
      Buffer.from(JSON.stringify({ ...report, corpusHash: 'wrong' })),
      f.dataset,
      f.annotations,
    ),
  );
  assert.throws(() =>
    analyzeHistoricalReport(
      Buffer.from(JSON.stringify({ runId: 'Oracle-only' })),
      f.dataset,
      f.annotations,
    ),
  );
});

test('I007 C cobertura de contexto conservado es independiente de la disponibilidad del ranking', async () => {
  const f = await fixture();
  const result = await evaluateCase(
    f.provider(['webhooks:0', 'roles:1']),
    f.dataset.cases[7]!,
    false,
    f.options,
  );
  assert.ok(result.observation);
  result.observation.retrieval = null;
  const diagnostic = caseDiagnostics(result, f.annotations);
  assert.equal(diagnostic.chunkRecallAtK.percentage, null);
  assert.equal(diagnostic.contextEvidenceCoverage.percentage, 100);
});

test('I007 C R1 bloquea tamaño, solapamiento, configuración ausente y algoritmo no verificable antes de mapear no-contexto', async () => {
  const f = await fixture();
  const result = await evaluateCase(
    f.provider(['webhooks:0', 'roles:1'], 1),
    f.dataset.cases[7]!,
    true,
  );
  const report = {
    schemaVersion: 1,
    runId: 'chunking-negative-fixture',
    codeHash: 'ec1b50a57424b1b7cee0121871da6474e3e281c683bc3d4f973e7d39d666ee11',
    config: { chunkSize: 1200, chunkOverlap: 150 },
    datasetHash: f.annotations.datasetHash,
    corpusHash: f.annotations.corpusHash,
    activeVersions: [...new Set(f.annotations.chunks.map((c) => c.documentId))].map(
      (documentId) => ({ documentId, versionId: 'fixture-version' }),
    ),
    results: [result],
  };
  assert.deepEqual(
    result.reviewContent?.context.map((c) => c.chunkId),
    [f.get('webhooks:0').chunkId],
  );
  assert.ok(result.retrievedChunkIds.includes(f.get('roles:1').chunkId));
  const analyze = (value: unknown) =>
    analyzeHistoricalReport(Buffer.from(JSON.stringify(value)), f.dataset, f.annotations);
  for (const config of [
    { chunkSize: 600, chunkOverlap: 150 },
    { chunkSize: 1200, chunkOverlap: 50 },
    undefined,
    { chunkSize: 1200 },
  ]) {
    assert.throws(
      () => analyze({ ...report, config }),
      /chunking configuration missing or incompatible/,
    );
  }
  assert.throws(
    () =>
      analyze({
        ...report,
        config: { ...report.config, chunkingAlgorithm: 'different-algorithm' },
      }),
    /chunking algorithm incompatible/,
  );
  assert.throws(
    () => analyze({ ...report, codeHash: undefined }),
    /algorithm cannot be established/,
  );
  assert.throws(
    () => analyze({ ...report, codeHash: '0'.repeat(64) }),
    /algorithm cannot be established/,
  );
  const compatible = analyze({
    ...report,
    config: { ...report.config, chunkingAlgorithm: 'markdown-sections-v1' },
  });
  assert.equal(compatible.historicalChunking.algorithm, 'markdown-sections-v1');
  assert.equal(compatible.historicalChunking.sourceFiles.length, 10);
  assert.equal(compatible.diagnostics.cases[0]?.ranking?.[1]?.includedInContext, false);
  assert.equal(compatible.diagnostics.cases[0]?.ranking?.[1]?.similarity, null);
  assert.equal(
    compatible.diagnostics.cases[0]?.chunkRecallAtK.reason,
    'RETRIEVED_CHUNK_CONTENT_UNVERIFIED',
  );
  assert.equal(compatible.diagnostics.cases[0]?.ranking?.[1]?.stableRef, null);
  assert.equal(compatible.diagnostics.cases[0]?.contextEvidenceCoverage.percentage, 50);
});

test('I007 C R2 audit:1 no añade información pertinente, pero su carga mantiene exposición propia y cruzada', async () => {
  const f = await fixture();
  const old = JSON.parse(await readFile('evals/knowledge/i007-chunk-annotations-v1.json', 'utf8'));
  assert.equal(f.annotations.version, 2);
  assert.equal(f.annotations.status, 'PROPOSED');
  assert.deepEqual(f.annotations.chunks, old.chunks);
  for (const item of f.annotations.cases) {
    const previous = old.cases.find((c: { id: string }) => c.id === item.id);
    if (item.id !== 'I007-019') {
      assert.deepEqual(item, previous);
    }
  }
  const current = f.annotations.cases.find((c) => c.id === 'I007-019')!;
  assert.deepEqual(current.necessary, ['audit:0']);
  assert.deepEqual(current.complementary, []);
  assert.ok(f.get('audit:0').content.includes('90 días'));
  assert.ok(f.get('audit:1').content.includes('90 días'));
  const item = f.dataset.cases[18]!;
  const withoutDuplicate = await evaluateCase(f.provider(['audit:0']), item, false, f.options);
  assert.equal(caseDiagnostics(withoutDuplicate, f.annotations).chunkRecallAtK.percentage, 100);
  assert.equal(caseDiagnostics(withoutDuplicate, old).chunkRecallAtK.percentage, 50);
  const onlyDuplicate = await evaluateCase(f.provider(['audit:1']), item, false, f.options);
  assert.equal(caseDiagnostics(onlyDuplicate, f.annotations).chunkRecallAtK.numerator, 0);
  assert.equal(caseDiagnostics(onlyDuplicate, f.annotations).exposure.anyPayload, true);
  const crossed = await evaluateCase(
    f.provider(['audit:1']),
    f.dataset.cases[0]!,
    false,
    f.options,
  );
  assert.equal(caseDiagnostics(crossed, f.annotations).exposure.crossPayload, true);
  assert.deepEqual(
    crossed.observation?.payloadMatches?.map((m) => m.payloadId),
    ['I007-PAYLOAD-019'],
  );
});

test('I007 C R1 identidad de ingesta ausente o distinta no se deduce del evaluador; contenido retenido suficiente acredita referencias', async () => {
  const f = await fixture();
  const roles = f.documents.find((document) => document.documentId === 'roles')!;
  const differentFragments = chunkMarkdown(roles.body, 100, 0);
  const original = f.get('roles:1').content;
  f.get('roles:1').content = differentFragments[1]!.content;
  assert.notEqual(hash(f.get('roles:1').content), hash(original));
  const result = await evaluateCase(
    f.provider(['webhooks:0', 'roles:1'], 1),
    f.dataset.cases[7]!,
    true,
  );
  const report = {
    schemaVersion: 1,
    runId: 'different-ingestion-with-same-evaluator',
    codeHash: 'ec1b50a57424b1b7cee0121871da6474e3e281c683bc3d4f973e7d39d666ee11',
    config: { chunkSize: 1200, chunkOverlap: 150 },
    datasetHash: f.annotations.datasetHash,
    corpusHash: f.annotations.corpusHash,
    activeVersions: [...new Set(f.annotations.chunks.map((c) => c.documentId))].map(
      (documentId) => ({ documentId, versionId: 'fixture-version' }),
    ),
    results: [result],
  };
  const analyze = (value: unknown) =>
    analyzeHistoricalReport(Buffer.from(JSON.stringify(value)), f.dataset, f.annotations)
      .diagnostics.cases[0]!;
  // The unretained roles:1 comes from a different fragmentation. Neither evaluator
  // configuration nor the version UUID discloses its bytes or ingestion fingerprint.
  for (const version of [report, { ...report, codeHash: report.codeHash }]) {
    const diagnostic = analyze(version);
    assert.equal(diagnostic.ranking?.[1]?.stableRef, null);
    assert.equal(diagnostic.chunkRecallAtK.status, 'UNAVAILABLE');
    assert.equal(diagnostic.chunkRecallAtK.reason, 'RETRIEVED_CHUNK_CONTENT_UNVERIFIED');
    assert.equal(diagnostic.contextEvidenceCoverage.percentage, 50);
  }
  f.get('roles:1').content = original;
  const allRetained = await evaluateCase(
    f.provider(['webhooks:0', 'roles:1']),
    f.dataset.cases[7]!,
    true,
  );
  const sufficient = analyze({ ...report, results: [allRetained] });
  assert.equal(sufficient.chunkRecallAtK.percentage, 100);
  assert.equal(sufficient.contextEvidenceCoverage.percentage, 100);
  const absent = analyze({ ...report, results: [{ ...result, reviewContent: undefined }] });
  assert.equal(absent.chunkRecallAtK.status, 'UNAVAILABLE');
  assert.equal(absent.contextEvidenceCoverage.reason, 'CONTEXT_NOT_RETAINED');
});
