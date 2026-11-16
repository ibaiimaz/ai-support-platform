import type { Config } from '../../config.js';
import type {
  ClassificationLlm,
  LlmMessage,
  LlmResponse,
} from '../../application/classification-llm.js';
import { classificationTimeouts } from '../../application/classification-timeouts.js';
import {
  incidentLookupTool,
  parseToolCallingResponse,
  toolCallingFinalSchema,
  toOllamaMessages,
} from './tool-calling-protocol.js';
import { postToolCallingChat } from './tool-calling-transport.js';

export class OllamaClassificationLlm implements ClassificationLlm {
  constructor(
    private readonly config: Pick<Config, 'baseUrl' | 'model'>,
    private readonly request: typeof fetch = fetch,
  ) {}

  async infer(
    messages: LlmMessage[],
    options: {
      timeoutMs: number;
      toolsEnabled: boolean;
    },
  ): Promise<LlmResponse> {
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new RangeError('Invalid inference timeout');
    }

    const body = JSON.stringify({
      model: this.config.model,
      stream: false,
      options: { temperature: 0 },
      messages: toOllamaMessages(messages),
      ...(options.toolsEnabled
        ? { tools: [incidentLookupTool] }
        : { format: toolCallingFinalSchema }),
    });
    const text = await postToolCallingChat(
      new URL('/api/chat', this.config.baseUrl),
      body,
      Math.min(options.timeoutMs, classificationTimeouts.llmCallMs),
      this.request,
    );

    return parseToolCallingResponse(text);
  }
}
