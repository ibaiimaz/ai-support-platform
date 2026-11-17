import type { IncidentRepository } from '../../application/incident-repository.js';
import { IncidentRepositoryError } from '../../application/tool-calling-errors.js';
import type { EvaluationCase } from './types.js';

export function fixtureRepository(fixture: EvaluationCase['fixture']): IncidentRepository {
  const incidents = new Map(fixture.incidents.map((incident) => [incident.id, { ...incident }]));
  const unavailable = new Set(fixture.unavailableIds);
  return {
    async getById(id) {
      if (unavailable.has(id)) {
        throw new IncidentRepositoryError();
      }
      const incident = incidents.get(id);
      return incident ? { ...incident } : null;
    },
  };
}
