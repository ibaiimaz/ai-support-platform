import { classificationInstructions } from '../infrastructure/ollama/classification-instructions.js';
import { h1Text } from '../infrastructure/ollama/prompts/h1.js';
import { h2Text } from '../infrastructure/ollama/prompts/h2.js';
import { h3Text } from '../infrastructure/ollama/prompts/h3.js';
import { h4Text } from '../infrastructure/ollama/prompts/h4.js';
import { sha256 } from './dataset.js';

export interface RegisteredPrompt {
  readonly id: string;
  readonly version: number;
  readonly role: 'baseline' | 'candidate';
  readonly hypothesis: string;
  readonly risks: readonly string[];
  readonly module: string;
  readonly text: string;
  readonly sha256: string;
  readonly byteLength: number;
}

function register(definition: Omit<RegisteredPrompt, 'sha256' | 'byteLength'>): RegisteredPrompt {
  return Object.freeze({
    ...definition,
    risks: Object.freeze([...definition.risks]),
    sha256: sha256(definition.text),
    byteLength: Buffer.byteLength(definition.text, 'utf8'),
  });
}

export const baselinePrompt = register({
  id: 'i001-original',
  version: 1,
  role: 'baseline',
  hypothesis: 'Control original de I001.',
  risks: ['Vulnerabilidad semántica observada en I002.'],
  module: 'src/infrastructure/ollama/classification-instructions.ts',
  text: classificationInstructions,
});

export const registeredPrompts: readonly RegisteredPrompt[] = Object.freeze([
  baselinePrompt,
  register({
    id: 'h1',
    version: 1,
    role: 'candidate',
    hypothesis:
      'Una jerarquía explícita podría reducir la obediencia a roles e instrucciones simulados.',
    risks: ['Reiteración sin mejora.', 'Confusión ante documentación legítima sobre roles o JSON.'],
    module: 'src/infrastructure/ollama/prompts/h1.ts',
    text: h1Text,
  }),
  register({
    id: 'h2',
    version: 1,
    role: 'candidate',
    hypothesis:
      'Pares contrastivos equilibrados podrían preservar la intención funcional al añadir órdenes contradictorias.',
    risks: ['Atajos de vocabulario y orden.', 'Mayor longitud y latencia.'],
    module: 'src/infrastructure/ollama/prompts/h2.ts',
    text: h2Text,
  }),
  register({
    id: 'h3',
    version: 1,
    role: 'candidate',
    hypothesis:
      'Decidir desde la necesidad legítima podría reducir la dominancia de instrucciones finales.',
    risks: [
      'Pérdida de contexto en casos mixtos.',
      'Confusión con peticiones legítimas imperativas.',
    ],
    module: 'src/infrastructure/ollama/prompts/h3.ts',
    text: h3Text,
  }),
  register({
    id: 'h4',
    version: 1,
    role: 'candidate',
    hypothesis:
      'Distinguir evidencia funcional de instrucciones dirigidas al clasificador podría reducir su influencia sin perder el contexto legítimo necesario para clasificar.',
    risks: [
      'Pérdida de contexto funcional en citas o documentos que contienen instrucciones.',
      'Confusión entre peticiones imperativas legítimas e instrucciones al clasificador.',
      'Errores en incidencias sobre instrucciones, permisos o automatizaciones del producto.',
      'Mayor complejidad sin mejora de robustez.',
      'Sobreajuste a los errores observados en desarrollo.',
    ],
    module: 'src/infrastructure/ollama/prompts/h4.ts',
    text: h4Text,
  }),
]);

export function findPrompt(id: string): RegisteredPrompt {
  const prompt = registeredPrompts.find((candidate) => candidate.id === id);

  if (!prompt) {
    throw new Error('Prompt no registrado.');
  }

  return prompt;
}
