import type { IncidentRepository } from '../../application/incident-repository.js';
import { IncidentRepositoryError } from '../../application/tool-calling-errors.js';
import type { Incident } from '../../domain/incident.js';

export class SyntheticIncidentRepository implements IncidentRepository {
  private readonly unavailableIds: Set<string>;

  private readonly incidents: Incident[] = [
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
  ];

  constructor(options: { unavailableIds?: readonly string[] } = {}) {
    this.unavailableIds = new Set(options.unavailableIds ?? []);
  }

  async getById(
    id: string,
    _options: {
      timeoutMs: number;
    },
  ): Promise<Incident | null> {
    if (this.unavailableIds.has(id)) {
      throw new IncidentRepositoryError();
    }

    const incident = this.incidents.find((candidate) => candidate.id === id);
    return incident ? { ...incident } : null;
  }
}
