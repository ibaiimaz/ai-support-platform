import { categories } from '../../domain/classification.js';

export const ollamaInference = Object.freeze({
  endpoint: '/api/chat',
  stream: false,
  options: Object.freeze({ temperature: 0 }),
  format: Object.freeze({
    type: 'object',
    required: Object.freeze(['category']),
    additionalProperties: false,
    properties: Object.freeze({
      category: Object.freeze({ type: 'string', enum: Object.freeze([...categories]) }),
    }),
  }),
});
