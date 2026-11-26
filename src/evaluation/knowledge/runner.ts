import { loadAnnotations } from './annotations.js';
import { summarizeDiagnostics } from './observability.js';
import { analyzeHistoricalReport } from './retrospective.js';
import { assertKnowledgeCodeIdentity, type KnowledgeCodeIdentity } from './code-identity.js';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadRagConfig } from '../../knowledge/config.js';
import { createKnowledgeDependencies } from '../../knowledge/composition.js';
import { hash, readCorpus } from '../../knowledge/markdown.js';
import {
  runBaseline,
  summarize,
  summarizeHumanReview,
  validateDataset,
  type EvalResult,
} from './evaluation.js';
import { persist, synchronization } from '../durable-files.js';

export async function runKnowledgeEvaluation(codeIdentity?: KnowledgeCodeIdentity) {
  const args = process.argv.slice(2);
  const config = loadRagConfig();
  const bytes = await readFile('evals/knowledge/i007-cases.json');
  const dataset: unknown = JSON.parse(bytes.toString('utf8'));
  const documents = await readCorpus(config.documentsDirectory);
  validateDataset(
    dataset,
    documents.map((document) => document.documentId),
  );
  for (const item of dataset.cases) {
    for (const payload of item.hostilePayloads ?? []) {
      if (
        !documents
          .find((document) => document.documentId === payload.documentId)
          ?.body.includes(payload.text)
      ) {
        throw new Error('Hostile payload differs from candidate corpus');
      }
    }
  }
  const corpusHash = hash(
    JSON.stringify(documents.map(({ documentId, contentHash }) => ({ documentId, contentHash }))),
  );
  if (args.length === 3 && args[0] === '--review') {
    const reportBytes = await readFile(args[1]!);
    const report = JSON.parse(reportBytes.toString('utf8')) as {
      datasetHash: string;
      corpusHash: string;
      results: EvalResult[];
    };
    if (report.datasetHash !== hash(bytes) || report.corpusHash !== corpusHash) {
      throw new Error('Review identities differ');
    }
    const review = JSON.parse(await readFile(args[2]!, 'utf8')) as {
      reportHash: string;
      reviewer: string;
      decisions: unknown;
    };
    if (
      review.reportHash !== hash(reportBytes) ||
      typeof review.reviewer !== 'string' ||
      !review.reviewer.trim()
    ) {
      throw new Error('Human review must identify the exact report and reviewer');
    }
    const metrics = summarizeHumanReview(dataset, report.results, review.decisions);
    await persist(
      args[1]! + '.review.json',
      JSON.stringify(
        {
          reportHash: review.reportHash,
          reviewer: review.reviewer,
          decisions: review.decisions,
          metrics,
        },
        null,
        2,
      ) + '\n',
      true,
      synchronization,
    );
    console.log(
      JSON.stringify({
        state: 'REVIEW_RECORDED',
        reviewed: metrics.reviewed,
        acceptance: 'NOT_ASSESSED',
      }),
    );
    return;
  }
  const { annotations, identity: annotationIdentity } = await loadAnnotations(
    dataset,
    hash(bytes),
    documents,
    { size: config.chunkSize, overlap: config.chunkOverlap },
  );
  if (args.length === 2 && args[0] === '--analyze') {
    const original = await readFile(args[1]!);
    const analysis = analyzeHistoricalReport(original, dataset, annotations);
    const directory = join('evals/reports/i007-analysis', randomUUID());
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, 'diagnostics.json');
    await persist(
      path,
      JSON.stringify({ ...analysis, annotationIdentity, codeIdentity }, null, 2) + '\n',
      true,
      synchronization,
    );
    console.log(JSON.stringify({ state: 'DERIVED_ANALYSIS', path, inference: false }));
    return;
  }
  if (!args.length || (args.length === 1 && args[0] === '--check')) {
    console.log(
      JSON.stringify({
        datasetId: dataset.datasetId,
        cases: dataset.cases.length,
        datasetHash: hash(bytes),
        corpusHash,
        status: 'CANDIDATE',
        inference: false,
        codeIdentity,
        annotationIdentity,
      }),
    );
    return;
  }
  if (
    (args.length !== 3 && args.length !== 4) ||
    args[0] !== '--run' ||
    args[1] !== '--authorization' ||
    !/^[A-Za-z0-9-]{5,100}$/.test(args[2] ?? '') ||
    (args.length === 4 && args[3] !== '--retain-synthetic-content')
  ) {
    throw new Error(
      'Explicit --run --authorization REFERENCE [--retain-synthetic-content] required',
    );
  }
  if (!codeIdentity) {
    throw new Error('Verified build identity required');
  }
  // Local, manual baseline only. This command is never called by tests or startup.
  const runId = randomUUID();
  const directory = join('evals/reports/i007', runId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const write = (name: string, value: unknown) =>
    persist(join(directory, name), JSON.stringify(value, null, 2) + '\n', true, synchronization);
  await write('started.json', {
    schemaVersion: 3,
    codeIdentity,
    annotationIdentity,
    runId,
    authorization: args[2],
    date: new Date().toISOString(),
    datasetHash: hash(bytes),
    corpusHash,
  });
  const composition = createKnowledgeDependencies(config);
  const results: EvalResult[] = [];
  try {
    const active = await composition.pool.query<{
      document_id: string;
      content_hash: string;
      config_hash: string;
      id: string;
      embedding_model: string;
      embedding_digest: string;
      embedding_dimensions: number;
    }>(
      "SELECT v.* FROM knowledge_documents d JOIN knowledge_versions v ON v.id=d.active_version WHERE v.status='ACTIVE' ORDER BY d.document_id",
    );
    const embeddingSpace = await composition.dependencies.embeddings.identity();
    const configHash = hash(
      JSON.stringify({
        algorithm: 'markdown-sections-v1',
        chunkSize: config.chunkSize,
        chunkOverlap: config.chunkOverlap,
        space: embeddingSpace,
      }),
    );
    if (
      active.rows.length !== documents.length ||
      documents.some(
        (document) =>
          !active.rows.some(
            (row) =>
              row.document_id === document.documentId &&
              row.content_hash === document.contentHash &&
              row.config_hash === configHash,
          ),
      )
    ) {
      throw new Error('Active corpus does not match evaluation corpus');
    }
    const activeIdentity = hash(
      JSON.stringify(active.rows.map((row) => [row.document_id, row.id])),
    );
    const report = {
      schemaVersion: 3,
      runId,
      datasetId: dataset.datasetId,
      datasetHash: hash(bytes),
      corpusHash,
      config: { ...config, databaseUrl: '[REDACTED]' },
      embeddingSpace,
      activeVersions: active.rows.map((row) => ({
        documentId: row.document_id,
        versionId: row.id,
      })),
      generationIdentity: await composition.dependencies.generator.generationIdentity(),
      codeIdentity,
      annotationIdentity,
      independentValidation: false,
      acceptance: 'NOT_ASSESSED',
      results,
    };
    const completed = await runBaseline(
      {
        ...composition.dependencies,
        embeddings: {
          identity: () => composition.dependencies.embeddings.identity(),
          async embed(text, space) {
            await assertKnowledgeCodeIdentity(codeIdentity);
            return composition.dependencies.embeddings.embed(text, space);
          },
        },
        generator: {
          async generate(question, chunks) {
            await assertKnowledgeCodeIdentity(codeIdentity);
            return composition.dependencies.generator.generate(question, chunks);
          },
        },
      },
      dataset,
      async (result) => {
        await write(`${result.id}.json`, result);
        const current = await composition.pool.query(
          'SELECT document_id,active_version FROM knowledge_documents ORDER BY document_id',
        );
        if (
          hash(
            JSON.stringify(
              current.rows.map((row: { document_id: string; active_version: string }) => [
                row.document_id,
                row.active_version,
              ]),
            ),
          ) !== activeIdentity
        ) {
          throw new Error('Corpus changed during evaluation');
        }
      },
      {
        expected: report.generationIdentity,
        read: () => composition.dependencies.generator.generationIdentity(),
      },
      args.includes('--retain-synthetic-content'),
      { annotations, dataset },
    );
    results.push(...completed);
    await write('report.json', {
      ...report,
      metrics: summarize(dataset, results),
      diagnostics: summarizeDiagnostics(dataset, results, annotations),
    });
    console.log(
      JSON.stringify({
        runId,
        report: join(directory, 'report.json'),
        state: summarize(dataset, results).state,
      }),
    );
  } catch {
    // Persistence failures stop immediately; the started marker and prior per-case files remain.
    console.error(
      'Evaluación interrumpida. Conservar el directorio privado; no reanudar automáticamente.',
    );
    process.exitCode = 1;
  } finally {
    await composition.close();
  }
}
