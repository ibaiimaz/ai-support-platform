import type { Incident } from '../domain/incident.js';

export interface IncidentRepository {
  getById(
    id: string,
    options: {
      timeoutMs: number;
    },
  ): Promise<Incident | null>;
}
