import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRagConfig } from '../../src/knowledge/config.js';
import { chunkMarkdown, parseMarkdown, readCorpus, hash } from '../../src/knowledge/markdown.js';
import { KnowledgeError, validateEmbedding } from '../../src/knowledge/domain.js';
import { askKnowledgeQuestion, ingestKnowledgeDocument } from '../../src/knowledge/use-cases.js';
import { dependencies, embeddings, repository, chunk } from './helpers.js';
import type { DocumentWriter } from '../../src/knowledge/ports.js';

const markdown = (body: string) =>
  Buffer.from(`---\ndocumentId: demo\ntitle: Manual\n---\n${body}`);

test('RF-01 identidad lógica, UTF-8, hash de bytes y rechazo de documentos inválidos', () => {
  const bytes = markdown('# Uno\nTexto');
  assert.equal(parseMarkdown(bytes).documentId, 'demo');
  assert.equal(parseMarkdown(bytes).contentHash, hash(bytes));
  assert.notEqual(
    parseMarkdown(Buffer.from(bytes.toString().replaceAll('\n', '\r\n'))).contentHash,
    hash(bytes),
  );
  for (const invalid of [
    Buffer.from(''),
    markdown(' '),
    Buffer.from([0xff]),
    Buffer.from('---\ndocumentId: a\ndocumentId: a\ntitle: T\n---\nx'),
    Buffer.alloc(1048577),
  ]) {
    assert.throws(() => parseMarkdown(invalid));
  }
});

test('RF-01 corpus rechaza identidades duplicadas independientemente del nombre de archivo', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'i007-corpus-'));
  try {
    await writeFile(join(directory, 'a.md'), markdown('Text'));
    await writeFile(join(directory, 'b.md'), markdown('Another'));
    await assert.rejects(readCorpus(directory), /duplicate/);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test('RF-02 chunking Unicode determinista, secciones, overlap y bloques de código', () => {
  const text = '# A\n' + '😀'.repeat(35) + '\n## B\nTexto\n```md\n# No es sección\n```';
  const chunks = chunkMarkdown(text, 20, 4);
  assert.deepEqual(chunks, chunkMarkdown(text, 20, 4));
  assert.ok(
    chunks.every((item, index) => Array.from(item.content).length <= 20 && item.position === index),
  );
  assert.ok(chunks.some((item) => item.section === 'A > B'));
  assert.ok(chunks.every((item) => !item.section.includes('No es sección')));
  assert.ok(chunks[0]!.content.endsWith('😀'.repeat(4)));
  assert.ok(chunks[1]!.content.startsWith('😀'.repeat(4)));
  assert.throws(() => chunkMarkdown('x', 10, 10));
});

test('RF-02 configuración y vectores incompatibles se rechazan sin coerción', () => {
  for (const env of [
    { RAG_TOP_K: 'NaN' },
    { RAG_CHUNK_OVERLAP: '1200' },
    { RAG_MAX_CONTEXT_CHUNKS: '6' },
    { RAG_MIN_SIMILARITY: '' },
    { RAG_EMBEDDING_DIMENSIONS: '0' },
  ]) {
    assert.throws(() => loadRagConfig(env));
  }
  for (const vector of [
    [1, 0],
    [0, 0, 0],
    [NaN, 1, 0],
    ['1', 0, 0],
    [Infinity, 1, 0],
    [1e300, 0, 0],
  ]) {
    assert.throws(() => validateEmbedding(vector, 3), KnowledgeError);
  }
});

test('RF-03 sin retrieval no se llama al generador', async () => {
  const deps = dependencies([]);
  deps.generator.generate = async () => {
    assert.fail('No generator without context');
  };
  assert.deepEqual(await askKnowledgeQuestion(deps, '¿Plazo?'), {
    status: 'INSUFFICIENT_CONTEXT',
    answer: null,
    sources: [],
  });
});

test('RF-05 fuentes solo citadas, snapshot conserva metadatos, límite de contexto', async () => {
  const deps = dependencies([chunk, { ...chunk, chunkId: 'c2' }]);
  deps.maxContextChunks = 1;
  deps.generator.generate = async (_question, chunks) => {
    assert.equal(chunks.length, 1);
    return { status: 'ANSWER', answer: '15 minutos', chunkIds: ['c1'] };
  };
  const result = await askKnowledgeQuestion(deps, '¿Plazo?');
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0]!.versionId, 'v1');
  assert.equal('content' in result.sources[0]!, false);
});

test('RF-05 rechazo estricto de fuentes inventadas, duplicadas, JSON inválido y campos extra', async () => {
  const invalid = [
    { status: 'ANSWER', answer: 'x', chunkIds: ['invented'] },
    { status: 'ANSWER', answer: 'x', chunkIds: ['c1', 'c1'] },
    { status: 'ANSWER', answer: ' ', chunkIds: ['c1'] },
    { status: 'ANSWER', answer: 'x', chunkIds: [] },
    { status: 'ANSWER', answer: 'x', chunkIds: ['c1'], secret: 'x' },
    { status: 'INSUFFICIENT_CONTEXT', answer: 'x', chunkIds: [] },
  ];
  for (const value of invalid) {
    const deps = dependencies();
    deps.generator.generate = async () => value as never;
    await assert.rejects(askKnowledgeQuestion(deps, 'q'), { kind: 'INVALID_GENERATION_RESPONSE' });
  }
});

function writer(events: string[]): DocumentWriter {
  return {
    async activeMatches() {
      return null;
    },
    async begin() {
      events.push('PENDING');
      return 'v2';
    },
    async processing() {
      events.push('PROCESSING');
    },
    async ready(_id, chunks) {
      assert.ok(chunks.length);
      events.push('READY');
    },
    async publish() {
      events.push('ACTIVE');
    },
    async fail() {
      events.push('FAILED');
    },
  };
}

test('RF-06 RF-07 ingestión respeta transiciones, salta embeddings si no cambian bytes ni configuración', async () => {
  const events: string[] = [];
  const target = writer(events);
  await ingestKnowledgeDocument(repository(target), embeddings, parseMarkdown(markdown('Texto')), {
    chunkSize: 100,
    chunkOverlap: 10,
  });
  assert.deepEqual(events, ['PENDING', 'PROCESSING', 'READY', 'ACTIVE']);
  target.activeMatches = async () => 'v2';
  const noEmbed = {
    ...embeddings,
    async embed(): Promise<number[]> {
      assert.fail('Idempotent ingestion must not embed');
    },
  };
  const result = await ingestKnowledgeDocument(
    repository(target),
    noEmbed,
    parseMarkdown(markdown('Texto')),
    { chunkSize: 100, chunkOverlap: 10 },
  );
  assert.equal(result.status, 'UNCHANGED');
  assert.equal(events.length, 4);
});

test('RF-06 fallo de embedding marca FAILED y nunca publica', async () => {
  const events: string[] = [];
  await assert.rejects(
    ingestKnowledgeDocument(
      repository(writer(events)),
      {
        ...embeddings,
        async embed() {
          throw new KnowledgeError('EMBEDDING_UNAVAILABLE');
        },
      },
      parseMarkdown(markdown('Texto')),
      { chunkSize: 100, chunkOverlap: 10 },
    ),
    { kind: 'EMBEDDING_UNAVAILABLE' },
  );
  assert.deepEqual(events, ['PENDING', 'PROCESSING', 'FAILED']);
});

test('RF-07 fingerprint ignora configuración ajena al chunking y al espacio de embeddings', async () => {
  const config = loadRagConfig({});
  let storedHash = '';
  let begins = 0;
  const target = writer([]);
  target.activeMatches = async (_contentHash, configHash) =>
    storedHash === configHash ? 'v2' : null;
  target.begin = async (metadata) => {
    begins++;
    storedHash = metadata.configHash;
    return 'v2';
  };
  const document = parseMarkdown(markdown('Texto'));
  await ingestKnowledgeDocument(repository(target), embeddings, document, config);
  const changed = {
    ...config,
    databaseUrl: 'postgresql://different:password@localhost/another',
    generationModel: 'another',
  };
  const result = await ingestKnowledgeDocument(repository(target), embeddings, document, changed);
  assert.equal(result.status, 'UNCHANGED');
  assert.equal(begins, 1);
});
