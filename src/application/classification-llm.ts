import type { Category } from '../domain/classification.js';

export type ToolCall = {
  name: string;
  arguments: unknown;
  callId?: string;
};

export type LlmMessage =
  | {
      role: 'system' | 'user';
      content: string;
    }
  | {
      role: 'assistant';
      content: string;
    }
  | {
      role: 'assistant';
      toolCalls: ToolCall[];
    }
  | {
      role: 'tool';
      name: string;
      content: string;
      callId?: string;
    };

export type LookupDecision = { type: 'no_lookup' } | { type: 'tool_calls'; calls: ToolCall[] };

export type FinalClassification =
  { type: 'classification'; category: Category } | { type: 'abstention' };

export type LlmResponse =
  | { type: 'no_lookup' }
  | {
      type: 'classification';
      category: Category;
    }
  | {
      type: 'abstention';
    }
  | {
      type: 'tool_calls';
      calls: ToolCall[];
    };

export interface ClassificationLlm {
  infer(
    messages: LlmMessage[],
    options: {
      timeoutMs: number;
      toolsEnabled: boolean;
    },
  ): Promise<LlmResponse>;
}
