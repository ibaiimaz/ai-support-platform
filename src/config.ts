export interface Config {
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const baseUrl = env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
  const model = env.OLLAMA_MODEL ?? 'llama3.1:8b';
  const timeout = env.OLLAMA_TIMEOUT_MS ?? '30000';

  let url: URL;

  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('Invalid OLLAMA_BASE_URL');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Invalid OLLAMA_BASE_URL');
  }

  if (!model.trim()) {
    throw new Error('Invalid OLLAMA_MODEL');
  }

  const timeoutMs = Number(timeout);
  if (
    !/^\d+$/.test(timeout) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 2147483647
  ) {
    throw new Error('Invalid OLLAMA_TIMEOUT_MS');
  }

  return { baseUrl, model, timeoutMs };
}
