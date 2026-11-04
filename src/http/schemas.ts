export const inputSchema = {
  type: 'object',
  required: ['description'],
  additionalProperties: false,
  properties: { description: { type: 'string', maxLength: 4000 } },
};
