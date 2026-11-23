import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { migrateKnowledge, PostgresKnowledgeRepository } from '../../src/knowledge/postgres.js';
import { OllamaKnowledge } from '../../src/knowledge/ollama.js';
import { loadRagConfig } from '../../src/knowledge/config.js';
import { askKnowledgeQuestion, ingestKnowledgeDocument } from '../../src/knowledge/use-cases.js';
import { parseMarkdown } from '../../src/knowledge/markdown.js';
import { embeddings, space } from './helpers.js';

const url = process.env.RAG_TEST_DATABASE_URL;

test(
  'RF-01–07 integración PostgreSQL/pgvector: migraciones, atomicidad, snapshots y concurrencia',
  { skip: !url },
  async (t) => {
    const parsed = new URL(url!);
    assert.ok(
      ['127.0.0.1', 'localhost'].includes(parsed.hostname) && parsed.pathname.endsWith('_test'),
      'Only an explicitly configured local test database is permitted',
    );
    const admin = new Pool({ connectionString: url });
    const schema = 'i007_' + randomUUID().replaceAll('-', '');
    await admin.query(`CREATE SCHEMA ${schema}`);
    // Extension installation precedes the isolated schema so the vector type is shared, not dropped accidentally.
    await admin.query('CREATE EXTENSION IF NOT EXISTS vector');
    const pool = new Pool({
      connectionString: url,
      options: `-c search_path=${schema},public`,
      max: 8,
      idleTimeoutMillis: 0, // MockTimers must not intercept unrelated pool idle timers.
    });
    const repository = new PostgresKnowledgeRepository(pool);
    const options = { chunkSize: 100, chunkOverlap: 10 };
    const document = (body: string) =>
      parseMarkdown(Buffer.from(`---\ndocumentId: test-doc\ntitle: Prueba\n---\n${body}`));
    const searchOptions = { topK: 5, minSimilarity: 0.5, space };
    const search = () =>
      repository.withSnapshot((snapshot) => snapshot.search([1, 0, 0], searchOptions));
    try {
      await t.test('migración repetible y sin índices ANN', async () => {
        await migrateKnowledge(pool);
        await migrateKnowledge(pool);
        const indexes = await pool.query('SELECT indexdef FROM pg_indexes WHERE schemaname=$1', [
          schema,
        ]);
        assert.ok(!JSON.stringify(indexes.rows).match(/hnsw|ivfflat/i));
        assert.equal(
          (await pool.query('SELECT count(*) FROM knowledge_migrations')).rows[0].count,
          '1',
        );
      });
      let previousVersion = '';
      await t.test('ingestión completa, dimensión, coseno y skip idempotente', async () => {
        const first = await ingestKnowledgeDocument(
          repository,
          embeddings,
          document('# Uno\nDatos antiguos'),
          options,
        );
        previousVersion = first.versionId;
        assert.equal(first.status, 'ACTIVE');
        const existing = await ingestKnowledgeDocument(
          repository,
          {
            ...embeddings,
            async embed(): Promise<number[]> {
              assert.fail('No embedding for unchanged version');
            },
          },
          document('# Uno\nDatos antiguos'),
          options,
        );
        assert.equal(existing.versionId, first.versionId);
        assert.equal(existing.status, 'UNCHANGED');
        const hits = await search();
        assert.equal(hits[0]?.similarity, 1);
        assert.equal(hits[0]?.versionId, first.versionId);
        assert.equal(
          (await pool.query("SELECT count(*) FROM knowledge_versions WHERE status='ACTIVE'"))
            .rows[0].count,
          '1',
        );
      });
      await t.test('fallo de proveedor conserva activo y marca staging FAILED', async () => {
        await assert.rejects(
          ingestKnowledgeDocument(
            repository,
            {
              ...embeddings,
              async embed() {
                throw new Error('Simulated provider outage');
              },
            },
            document('Contenido nuevo'),
            options,
          ),
        );
        assert.equal((await search())[0]?.versionId, previousVersion);
        assert.equal(
          (await pool.query("SELECT count(*) FROM knowledge_versions WHERE status='FAILED'"))
            .rows[0].count,
          '1',
        );
      });
      await t.test(
        'exclusión de escritores y lector viejo sobrevive a publicación atómica',
        async () => {
          await repository.withDocument('test-doc', async () => {
            await assert.rejects(
              repository.withDocument('test-doc', async () => undefined),
              { kind: 'INGESTION_BUSY' },
            );
          });
          await repository.withSnapshot(async (snapshot) => {
            const old = await snapshot.search([1, 0, 0], searchOptions);
            const updated = await ingestKnowledgeDocument(
              repository,
              embeddings,
              document('# Dos\nDatos nuevos'),
              options,
            );
            assert.notEqual(updated.versionId, previousVersion);
            const stillOld = await snapshot.search([1, 0, 0], searchOptions);
            assert.deepEqual(stillOld, old);
            assert.equal((await search())[0]?.versionId, updated.versionId);
            previousVersion = updated.versionId;
          });
          assert.equal(
            (await pool.query('SELECT count(*) FROM knowledge_versions')).rows[0].count,
            '1',
          );
        },
      );
      await t.test('publicar versión incompleta revierte sin modificar activo', async () => {
        await repository.withDocument('test-doc', async (writer) => {
          const id = await writer.begin({
            documentId: 'test-doc',
            title: 'Prueba',
            contentHash: 'c'.repeat(64),
            configHash: 'd'.repeat(64),
            space,
            expectedChunks: 2,
          });
          await writer.processing(id);
          await assert.rejects(writer.ready(id, []));
          await assert.rejects(writer.publish(id));
          await writer.fail(id);
        });
        assert.equal((await search())[0]?.versionId, previousVersion);
      });
      await t.test(
        'fallo SQL durante publicación revierte puntero, eliminación y estado',
        async () => {
          await repository.withDocument('test-doc', async (writer) => {
            const id = await writer.begin({
              documentId: 'test-doc',
              title: 'Prueba',
              contentHash: 'e'.repeat(64),
              configHash: 'f'.repeat(64),
              space,
              expectedChunks: 1,
            });
            await writer.processing(id);
            await writer.ready(id, [
              {
                id: `chunk:${id}`,
                documentVersionId: id,
                position: 0,
                section: 'S',
                content: 'Nuevo',
                embedding: [1, 0, 0],
              },
            ]);
            await pool.query(
              `CREATE FUNCTION reject_publication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.active_version IS NOT NULL THEN RAISE EXCEPTION 'Synthetic publication failure'; END IF; RETURN NEW; END $$`,
            );
            await pool.query(
              'CREATE TRIGGER reject_publication BEFORE UPDATE ON knowledge_documents FOR EACH ROW EXECUTE FUNCTION reject_publication()',
            );
            try {
              await assert.rejects(writer.publish(id));
              assert.equal((await search())[0]?.versionId, previousVersion);
              assert.equal(
                (await pool.query('SELECT status FROM knowledge_versions WHERE id=$1', [id]))
                  .rows[0].status,
                'READY',
              );
            } finally {
              await pool.query('DROP TRIGGER reject_publication ON knowledge_documents');
              await pool.query('DROP FUNCTION reject_publication()');
              await writer.fail(id);
            }
          });
        },
      );
      await t.test(
        'I007-R4 timeout no cooperativo cierra snapshot y devuelve conexión PostgreSQL al pool',
        async (context) => {
          context.mock.timers.enable({ apis: ['setTimeout'] });
          let entered!: () => void;
          const started = new Promise<void>((resolve) => {
            entered = resolve;
          });
          let finish!: (response: Response) => void;
          const provider = new OllamaKnowledge(
            loadRagConfig({ RAG_GENERATION_TIMEOUT_MS: '1000' }),
            async () => {
              entered();
              return new Promise<Response>((resolve) => {
                finish = resolve;
              });
            },
          );
          const operation = askKnowledgeQuestion(
            {
              repository,
              embeddings,
              generator: provider,
              topK: 5,
              minSimilarity: 0.5,
              maxContextChunks: 4,
            },
            'Pregunta sintética',
          );
          const rejected = assert.rejects(operation, { kind: 'GENERATION_TIMEOUT' });
          await started;
          assert.ok(pool.idleCount < pool.totalCount);
          context.mock.timers.tick(1000);
          await rejected;
          assert.equal(pool.idleCount, pool.totalCount);
          assert.equal((await search())[0]?.versionId, previousVersion);
          finish(
            Response.json({
              done: true,
              done_reason: 'stop',
              message: { role: 'assistant', content: '{}' },
            }),
          );
          await nextTurn();
          assert.equal(pool.idleCount, pool.totalCount);
          assert.equal((await search())[0]?.versionId, previousVersion);
        },
      );
      await t.test(
        'configuración o espacio cambiado reingesta y no mezcla dimensiones',
        async () => {
          const otherSpace = { ...space, dimensions: 2, digest: 'b'.repeat(64) };
          const updated = await ingestKnowledgeDocument(
            repository,
            {
              async identity() {
                return otherSpace;
              },
              async embed() {
                return [0, 1];
              },
            },
            document('# Dos\nDatos nuevos'),
            options,
          );
          assert.notEqual(updated.versionId, previousVersion);
          assert.equal((await search()).length, 0);
          const hits = await repository.withSnapshot((snapshot) =>
            snapshot.search([0, 1], { ...searchOptions, space: otherSpace }),
          );
          assert.equal(hits.length, 1);
          assert.equal(hits[0]?.similarity, 1);
          assert.equal(
            (
              await repository.withSnapshot((snapshot) =>
                snapshot.search([1, 0], {
                  ...searchOptions,
                  minSimilarity: 0.9,
                  space: otherSpace,
                }),
              )
            ).length,
            0,
          );
        },
      );
    } finally {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  },
);
