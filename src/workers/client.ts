import {
  WORKER_PROTOCOL_VERSION,
  createWorkerRequest,
} from './protocol';

export type WorkerClientErrorCode =
  | 'cancelled'
  | 'protocol_mismatch'
  | 'timeout'
  | 'worker_error';

export class WorkerClientError extends Error {
  readonly name = 'WorkerClientError';

  constructor(
    readonly code: WorkerClientErrorCode,
    message: string,
    readonly requestId: string,
    readonly remoteCode?: string,
  ) {
    super(message);
  }
}

export interface WorkerRequestOptions<TPayload, TResult> {
  createWorker: () => Worker;
  payload: TPayload;
  timeoutMs: number;
  signal?: AbortSignal;
  requestId?: string;
  onWorkerCreated?: (worker: Worker) => void;
  decodeLegacyResponse?: (value: unknown) => TResult | undefined;
}

let fallbackRequestSequence = 0;

function nextRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  fallbackRequestSequence += 1;
  return `worker-${Date.now()}-${fallbackRequestSequence}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Run exactly one correlated request. Completion, error, abort and timeout all
 * detach listeners and terminate the dedicated worker.
 */
export function runWorkerRequest<TPayload, TResult>(
  options: WorkerRequestOptions<TPayload, TResult>,
): Promise<TResult> {
  const requestId = options.requestId ?? nextRequestId();
  if (options.signal?.aborted) {
    return Promise.reject(new WorkerClientError(
      'cancelled',
      `Worker request ${requestId} was cancelled before it started.`,
      requestId,
    ));
  }

  return new Promise<TResult>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = options.createWorker();
    } catch (error) {
      reject(new WorkerClientError(
        'worker_error',
        error instanceof Error ? error.message : String(error),
        requestId,
      ));
      return;
    }

    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      options.signal?.removeEventListener('abort', handleAbort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    };
    const succeed = (result: TResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const fail = (error: WorkerClientError) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    function handleAbort() {
      fail(new WorkerClientError(
        'cancelled',
        `Worker request ${requestId} was cancelled.`,
        requestId,
      ));
    }

    worker.onmessage = (event: MessageEvent<unknown>) => {
      const legacy = options.decodeLegacyResponse?.(event.data);
      if (legacy !== undefined) {
        succeed(legacy);
        return;
      }

      if (!isRecord(event.data) || event.data.protocolVersion !== WORKER_PROTOCOL_VERSION) {
        fail(new WorkerClientError(
          'protocol_mismatch',
          `Worker request ${requestId} received an unsupported response version.`,
          requestId,
        ));
        return;
      }
      if (event.data.requestId !== requestId) {
        fail(new WorkerClientError(
          'protocol_mismatch',
          `Worker request ${requestId} received response ${String(event.data.requestId)}.`,
          requestId,
        ));
        return;
      }
      if (event.data.ok === true && Object.hasOwn(event.data, 'result')) {
        succeed(event.data.result as TResult);
        return;
      }
      if (event.data.ok === false && isRecord(event.data.error)) {
        const remoteCode = typeof event.data.error.code === 'string'
          ? event.data.error.code
          : 'worker_error';
        const message = typeof event.data.error.message === 'string'
          ? event.data.error.message
          : `Worker request ${requestId} failed.`;
        fail(new WorkerClientError(
          remoteCode === 'protocol_mismatch' ? 'protocol_mismatch' : 'worker_error',
          message,
          requestId,
          remoteCode,
        ));
        return;
      }
      fail(new WorkerClientError(
        'protocol_mismatch',
        `Worker request ${requestId} received a malformed response.`,
        requestId,
      ));
    };

    worker.onerror = (event: ErrorEvent) => {
      fail(new WorkerClientError(
        'worker_error',
        event.message || `Worker request ${requestId} failed.`,
        requestId,
      ));
    };

    options.signal?.addEventListener('abort', handleAbort, { once: true });
    timeoutId = setTimeout(() => {
      fail(new WorkerClientError(
        'timeout',
        `Worker request ${requestId} timed out after ${options.timeoutMs}ms.`,
        requestId,
      ));
    }, options.timeoutMs);

    try {
      options.onWorkerCreated?.(worker);
      worker.postMessage(createWorkerRequest(requestId, options.payload));
    } catch (error) {
      fail(new WorkerClientError(
        'worker_error',
        error instanceof Error ? error.message : String(error),
        requestId,
      ));
    }
  });
}
