import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SyntheticIncidentRepository } from '../../src/infrastructure/incidents/synthetic-incident-repository.js';
import { IncidentRepositoryError } from '../../src/application/tool-calling-errors.js';

test('I006-AC-04 synthetic incidents are fixed and cover the three categories', async () => {
  const repository = new SyntheticIncidentRepository();
  const found = await Promise.all(
    ['INC-142', 'INC-201', 'INC-305'].map((id) => repository.getById(id, { timeoutMs: 5_000 })),
  );

  assert.deepEqual(found, [
    {
      id: 'INC-142',
      title: 'Error al guardar un informe',
      description:
        'Al guardar un informe existente, la aplicación se bloquea y pierde los cambios.',
      category: 'BUG',
    },
    {
      id: 'INC-201',
      title: 'Exportación de informes a Excel',
      description:
        'Quiero poder exportar los informes a Excel para trabajarlos fuera de la aplicación.',
      category: 'FEATURE',
    },
    {
      id: 'INC-305',
      title: 'Consulta sobre permisos de lectura',
      description: '¿Cómo puedo consultar qué usuarios tienen permiso de lectura sobre un informe?',
      category: 'QUESTION',
    },
  ]);
  assert.deepEqual(await repository.getById('INC-142', { timeoutMs: 5_000 }), found[0]);
  assert.deepEqual(
    await new SyntheticIncidentRepository().getById('INC-142', { timeoutMs: 5_000 }),
    found[0],
  );
});

test('I006-AC-04 returned incidents cannot mutate later queries or other instances', async () => {
  const repository = new SyntheticIncidentRepository();
  const original = await repository.getById('INC-142', { timeoutMs: 5_000 });
  const modified = await repository.getById('INC-142', { timeoutMs: 5_000 });
  assert.ok(modified);
  assert.notEqual(modified, original);
  modified.title = 'changed';
  modified.description = 'changed';
  modified.category = 'QUESTION';

  assert.deepEqual(await repository.getById('INC-142', { timeoutMs: 5_000 }), original);
  assert.deepEqual(
    await new SyntheticIncidentRepository().getById('INC-142', { timeoutMs: 5_000 }),
    original,
  );
});

test('I006-AC-05 missing incidents consistently return null', async () => {
  const repository = new SyntheticIncidentRepository();
  assert.equal(await repository.getById('INC-999', { timeoutMs: 5_000 }), null);
  assert.equal(await repository.getById('INC-999', { timeoutMs: 5_000 }), null);
});

test('I006-AC-06 unavailable IDs are copied and isolated per instance and scenario', async () => {
  const ids = ['INC-142', 'INC-999'];
  const unavailable = new SyntheticIncidentRepository({ unavailableIds: ids });
  const available = new SyntheticIncidentRepository();
  ids.length = 0;
  ids.push('INC-201');

  for (let repetition = 0; repetition < 2; repetition += 1) {
    for (const id of ['INC-142', 'INC-999']) {
      await assert.rejects(unavailable.getById(id, { timeoutMs: 5_000 }), IncidentRepositoryError);
    }
  }

  assert.equal((await unavailable.getById('INC-201', { timeoutMs: 5_000 }))?.category, 'FEATURE');
  assert.equal((await available.getById('INC-142', { timeoutMs: 5_000 }))?.category, 'BUG');
  assert.equal(await available.getById('INC-999', { timeoutMs: 5_000 }), null);
});
