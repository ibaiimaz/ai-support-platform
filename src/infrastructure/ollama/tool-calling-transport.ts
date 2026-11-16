import { ClassificationError } from '../../application/classification-errors.js';

const transportCodes = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_DESTROYED',
  'UND_ERR_CLOSED',
  'UND_ERR_RES_CONTENT_LENGTH_MISMATCH',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function isTransportError(error: unknown, seen = new Set<Error>()): boolean {
  if (!(error instanceof Error) || seen.has(error)) {
    return false;
  }

  seen.add(error);
  if ('code' in error && typeof error.code === 'string' && transportCodes.has(error.code)) {
    return true;
  }

  if (error instanceof AggregateError) {
    return (
      error.errors.length > 0 &&
      error.errors.every((cause) => isTransportError(cause, new Set(seen)))
    );
  }

  return error.cause !== undefined && isTransportError(error.cause, seen);
}

async function withinTimeout<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    throw new ClassificationError('timeout');
  }

  let aborted!: () => void;
  const timeout = new Promise<never>((_resolve, reject) => {
    aborted = () => reject(new ClassificationError('timeout'));
    signal.addEventListener('abort', aborted, { once: true });
  });

  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        signal.throwIfAborted();
        return operation();
      }),
      timeout,
    ]);
  } catch (error) {
    if (signal.aborted && error === signal.reason) {
      throw new ClassificationError('timeout');
    }

    if (isTransportError(error)) {
      throw new ClassificationError('connection_error');
    }

    throw error;
  } finally {
    signal.removeEventListener('abort', aborted);
  }
}

export async function postToolCallingChat(
  url: URL,
  body: string,
  timeoutMs: number,
  request: typeof fetch,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await withinTimeout(async () => {
      const result = await request(url, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/json' },
        body,
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        void result.body?.cancel().catch(() => {});
        controller.signal.throwIfAborted();
      }

      return result;
    }, controller.signal);

    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new ClassificationError('http_error');
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new ClassificationError('invalid_response');
    }

    const chunks: Uint8Array[] = [];
    let size = 0;
    let complete = false;
    try {
      while (true) {
        const { done, value } = await withinTimeout(() => reader.read(), controller.signal);
        if (done) {
          complete = true;
          break;
        }

        size += value.byteLength;
        if (size > 65_536) {
          throw new ClassificationError('invalid_response');
        }

        chunks.push(value);
      }
    } finally {
      if (!complete) {
        // Cleanup must not hide the primary error or wait indefinitely for cancellation.
        void reader.cancel().catch(() => {});
      }

      reader.releaseLock();
    }

    return Buffer.concat(chunks).toString('utf8');
  } finally {
    clearTimeout(timer);
  }
}
