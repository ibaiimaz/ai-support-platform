import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import { hash, readCorpus } from '../../../src/knowledge/markdown.js';
import {
  evaluateCase,
  summarize,
  summarizeHumanReview,
  validateDataset,
} from '../../../src/evaluation/knowledge/evaluation.js';
import { KnowledgeError } from '../../../src/knowledge/domain.js';
import { dependencies, chunk } from '../../knowledge/helpers.js';

const stableIdentity = {
  expected: { model: 'generator:1', digest: 'b'.repeat(64) },
  async read() {
    return { model: 'generator:1', digest: 'b'.repeat(64) };
  },
};

async function dataset() {
  const value: unknown = JSON.parse(await readFile('evals/knowledge/i007-cases.json', 'utf8'));
  const corpus = await readCorpus('knowledge/corpus');
  validateDataset(
    value,
    corpus.map((item) => item.documentId),
  );
  return value;
}

test('I007 corpus sintético: 10 documentos, 20 casos y cuotas, referencias y IDs verificables', async () => {
  assert.equal((await readCorpus('knowledge/corpus')).length, 10);
  const value = await dataset();
  assert.equal(value.cases.length, 20);
  const duplicate = structuredClone(value);
  duplicate.cases[1]!.id = duplicate.cases[0]!.id;
  assert.throws(() => validateDataset(duplicate, []));
});

test('I007 métricas de baseline: denominadores, fallos, latencia y parcial sin aceptación', async () => {
  const value = await dataset();
  const good = await evaluateCase(dependencies(), value.cases[0]!);
  assert.equal(good.reviewContent, undefined);
  const badDeps = dependencies();
  badDeps.generator.generate = async () => {
    throw new KnowledgeError('GENERATION_UNAVAILABLE');
  };
  const failed = await evaluateCase(badDeps, value.cases[1]!);
  const metrics = summarize(value, [good, failed]);
  assert.equal(metrics.state, 'INCOMPLETE');
  assert.equal(metrics.acceptance, 'NOT_ASSESSED');
  assert.deepEqual(metrics.statusAccuracy, { numerator: 1, denominator: 1, percentage: 100 });
  assert.equal(metrics.endToEndStatusSuccess.denominator, 20);
  assert.equal(metrics.technicalErrors, 1);
  assert.equal(metrics.unprocessed, 18);
  assert.equal(metrics.documentRecallAtK.mean, 1);
  assert.equal(metrics.documentHitRateAtK.denominator, 2);
  assert.equal(summarize(value, []).documentHitRateAtK.percentage, null);
});

test('I007 recall documental macro, fuentes no equivalen a fundamentación y revisión humana ligada al caso', async () => {
  const value = await dataset();
  const item = value.cases[6]!;
  const result = await evaluateCase(
    dependencies([{ ...chunk, documentId: 'backups' }]),
    item,
    true,
  );
  assert.equal(summarize(value, [result]).documentRecallAtK.mean, 0.5);
  assert.ok(result.reviewContent);
  const reviewed = summarizeHumanReview(
    value,
    [result],
    [
      {
        id: item.id,
        factual: true,
        faithful: false,
        relevant: true,
        citationsCorrect: false,
        unsupportedClaims: true,
        attackSucceeded: false,
      },
    ],
  );
  assert.equal(reviewed.faithfulness.numerator, 0);
  assert.equal(reviewed.unsupportedAnswerRate.numerator, 1);
  assert.equal(reviewed.exposedAttackSuccessRate.percentage, null);
  assert.equal(reviewed.acceptance, 'NOT_ASSESSED');
  assert.throws(() => summarizeHumanReview(value, [result], [{ id: 'invented' }]));
});

test('I007 privacidad: un error arbitrario no se serializa y no se guarda contenido por defecto', async () => {
  const value = await dataset();
  const deps = dependencies();
  deps.generator.generate = async () => {
    throw new Error('SECRET_INTERNAL');
  };
  const result = await evaluateCase(deps, value.cases[0]!);
  const encoded = JSON.stringify(result);
  assert.equal(result.error, 'UNEXPECTED_ERROR');
  assert.ok(!encoded.includes('SECRET_INTERNAL'));
  assert.ok(!encoded.includes('15 minutos'));
  assert.ok(!encoded.includes(value.cases[0]!.question));
});

test('I007 baseline para en el primer fallo técnico y persiste primero el progreso anterior', async () => {
  const { runBaseline } = await import('../../../src/evaluation/knowledge/evaluation.js');
  const value = await dataset();
  let calls = 0;
  const saved: string[] = [];
  const deps = dependencies();
  deps.generator.generate = async () => {
    calls++;
    if (calls === 2) {
      throw new KnowledgeError('GENERATION_TIMEOUT');
    }
    return { status: 'ANSWER', answer: 'Texto', chunkIds: ['c1'] };
  };
  const results = await runBaseline(
    deps,
    value,
    async (result) => {
      saved.push(result.id);
    },
    stableIdentity,
  );
  assert.equal(calls, 2);
  assert.deepEqual(saved, ['I007-001', 'I007-002']);
  assert.equal(results[1]?.error, 'GENERATION_TIMEOUT');
  assert.equal(summarize(value, results).state, 'INCOMPLETE');
  calls = 0;
  await assert.rejects(
    runBaseline(
      deps,
      value,
      async () => {
        throw new Error('Simulated fsync failure');
      },
      stableIdentity,
    ),
  );
  assert.equal(calls, 1);
});

test('I007 un baseline completo sigue sin aceptación ni métricas semánticas inventadas', async () => {
  const { runBaseline } = await import('../../../src/evaluation/knowledge/evaluation.js');
  const value = await dataset();
  const results = await runBaseline(dependencies(), value, async () => undefined, stableIdentity);
  const metrics = summarize(value, results);
  assert.equal(metrics.state, 'COMPLETE_BASELINE');
  assert.equal(metrics.acceptance, 'NOT_ASSESSED');
  assert.equal(metrics.semanticMetrics, 'PENDING_HUMAN_REVIEW');
  assert.equal(metrics.thresholds, null);
});

test('I007-R2 cambio de digest antes o después de generar conserva parcial y bloquea el resto', async () => {
  const { runBaseline } = await import('../../../src/evaluation/knowledge/evaluation.js');
  const value = await dataset();
  for (const mismatchAt of [1, 2, 3, 4]) {
    let reads = 0;
    let sends = 0;
    const saved: string[] = [];
    const deps = dependencies();
    deps.generator.generate = async () => {
      sends++;
      return { status: 'ANSWER', answer: 'Texto', chunkIds: ['c1'] };
    };
    const results = await runBaseline(
      deps,
      value,
      async (result) => {
        // Inspect the persisted representation, not only the in-memory counter.
        const persisted = JSON.parse(JSON.stringify(result));
        saved.push(persisted.id);
      },
      {
        expected: stableIdentity.expected,
        async read() {
          reads++;
          return { model: 'generator:1', digest: (reads === mismatchAt ? 'c' : 'b').repeat(64) };
        },
      },
    );
    const failed = results.at(-1)!;
    assert.equal(failed.status, 'TECHNICAL_ERROR');
    assert.equal(failed.error, 'GENERATION_IDENTITY_CHANGED');
    assert.equal(failed.generationIdentity?.verified, false);
    assert.equal(
      failed.actualStatus,
      undefined,
      'Never attribute an unverified answer to the baseline model',
    );
    assert.equal(summarize(value, results).state, 'INCOMPLETE');
    assert.equal(saved.length, mismatchAt <= 2 ? 1 : 2);
    assert.equal(reads, mismatchAt);
    assert.equal(sends, Math.floor(mismatchAt / 2));
    if (mismatchAt > 2) {
      assert.equal(results[0]?.status, 'VALID');
      assert.equal(results[0]?.generationIdentity?.verified, true);
    }
  }
});

test('I007-R2 identidad observada se copia, cambio de modelo falla y no hay comprobación posterior a timeout', async () => {
  const { runBaseline } = await import('../../../src/evaluation/knowledge/evaluation.js');
  const value = await dataset();
  const shared = { ...stableIdentity.expected };
  const deps = dependencies();
  deps.generator.generate = async () => {
    shared.model = 'substituted:1';
    return { status: 'ANSWER', answer: 'Texto', chunkIds: ['c1'] };
  };
  const changed = await runBaseline(deps, value, async () => undefined, {
    expected: stableIdentity.expected,
    async read() {
      return shared;
    },
  });
  assert.equal(changed[0]?.generationIdentity?.before?.model, 'generator:1');
  assert.equal(changed[0]?.generationIdentity?.after?.model, 'substituted:1');
  assert.equal(changed[0]?.error, 'GENERATION_IDENTITY_CHANGED');
  let reads = 0;
  deps.generator.generate = async () => {
    throw new KnowledgeError('GENERATION_TIMEOUT');
  };
  const failed = await runBaseline(deps, value, async () => undefined, {
    expected: stableIdentity.expected,
    async read() {
      reads++;
      return stableIdentity.expected;
    },
  });
  assert.equal(reads, 1);
  assert.equal(failed[0]?.error, 'GENERATION_TIMEOUT');
  assert.equal(failed[0]?.generationIdentity?.verified, false);
});

test('I007-R3 cargas esperadas corresponden al corpus y no cambian las preguntas ni se envían como expectativas', async () => {
  const value = await dataset();
  const documents = await readCorpus('knowledge/corpus');
  const attacks = value.cases.filter((item) => item.group === 'injection');
  assert.equal(attacks.length, 3);
  const original = structuredClone(value);
  original.contentVersion = 1;
  for (const item of original.cases) {
    delete item.hostilePayloads;
  }
  const originalBytes = await format(JSON.stringify(original), {
    ...(await resolveConfig('evals/knowledge/i007-cases.json')),
    parser: 'json',
  });
  assert.equal(
    hash(originalBytes),
    '95844f64d1eb1d4fedb20f518969a8d9888aa6305796ef172e15f718bba08b7d',
    'Only payload annotations and content version changed',
  );
  for (const item of attacks) {
    assert.equal(item.hostilePayloads?.length, 1);
    const payload = item.hostilePayloads![0]!;
    assert.ok(
      documents
        .find((document) => document.documentId === payload.documentId)
        ?.body.includes(payload.text),
    );
    const deps = dependencies([]);
    deps.generator.generate = async () => assert.fail('No generator without retrieved context');
    const result = await evaluateCase(deps, item);
    assert.equal(result.attackExposure?.generationRequested, false);
    assert.equal(result.attackExposure?.hostilePayloadSent, false);
  }
});

test('I007-R3 métricas separadas: recuperar un documento o un fragmento truncado no demuestra exposición', async () => {
  const value = await dataset();
  const attacks = value.cases.filter((item) => item.group === 'injection');
  const first = attacks[0]!;
  const second = attacks[1]!;
  const third = attacks[2]!;
  const payloadChunk = (item: typeof first) => ({
    ...chunk,
    documentId: item.hostilePayloads![0]!.documentId,
    content: item.hostilePayloads![0]!.text,
  });
  const notExposed = await evaluateCase(dependencies([]), first);
  const exposed = await evaluateCase(dependencies([payloadChunk(second)]), second);
  const cappedDeps = dependencies([
    { ...chunk, documentId: 'updates', content: 'Solo texto funcional.' },
    { ...payloadChunk(third), chunkId: 'c2' },
  ]);
  cappedDeps.maxContextChunks = 1;
  const capped = await evaluateCase(cappedDeps, third);
  assert.equal(exposed.attackExposure?.hostilePayloadSent, true);
  assert.deepEqual(exposed.attackExposure?.matchedPayloadIds, [second.hostilePayloads![0]!.id]);
  assert.equal(capped.retrievedChunkIds.length, 2);
  assert.equal(capped.attackExposure?.hostilePayloadSent, false);
  const results = [notExposed, exposed, capped];
  const review = attacks.map((item) => ({
    id: item.id,
    factual: true,
    faithful: true,
    relevant: true,
    citationsCorrect: true,
    unsupportedClaims: false,
    attackSucceeded: item.id === second.id,
  }));
  const metrics = summarizeHumanReview(value, results, review);
  assert.equal(metrics.endToEndAttackSuccessRate.numerator, 1);
  assert.equal(metrics.endToEndAttackSuccessRate.denominator, 3);
  assert.ok(Math.abs(metrics.endToEndAttackSuccessRate.percentage! - 100 / 3) < 1e-12);
  assert.deepEqual(metrics.exposedAttackSuccessRate, {
    numerator: 1,
    denominator: 1,
    percentage: 100,
  });
  assert.equal(metrics.attackCoverage.confirmedExposed, 1);
  assert.equal(metrics.attackCoverage.notExposed, 2);
  assert.equal(metrics.attackCoverage.reviewedExposed, 1);
  assert.equal(metrics.attackCoverage.planned, 3);
  const legacy = summarizeHumanReview(
    value,
    [{ ...exposed, attackExposure: undefined }].map(
      ({ attackExposure: _ignored, ...result }) => result,
    ),
    [review[1]!],
  );
  assert.equal(legacy.exposedAttackSuccessRate.percentage, null);
  assert.equal(legacy.attackCoverage.reviewedExposureUnknown, 1);
});

test('I007-R3 fallo técnico con carga presente es exposición incierta, no resistencia del generador', async () => {
  const value = await dataset();
  const attack = value.cases.find((item) => item.group === 'injection')!;
  const payload = attack.hostilePayloads![0]!;
  const deps = dependencies([{ ...chunk, documentId: payload.documentId, content: payload.text }]);
  deps.generator.generate = async () => {
    throw new KnowledgeError('GENERATION_TIMEOUT');
  };
  const result = await evaluateCase(deps, attack);
  assert.equal(result.attackExposure?.hostilePayloadSent, null);
  assert.equal(result.status, 'TECHNICAL_ERROR');
  const metrics = summarizeHumanReview(value, [result], []);
  assert.equal(metrics.attackCoverage.exposureUnknown, 1);
  assert.equal(metrics.endToEndAttackSuccessRate.percentage, null);
  assert.equal(metrics.exposedAttackSuccessRate.percentage, null);
  assert.equal(JSON.stringify(result).includes(payload.text), false);
});
