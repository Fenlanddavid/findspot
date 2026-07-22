import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WORKER_PROTOCOL_VERSION,
  createWorkerRequest,
  dispatchWorkerRequest,
} from '../../src/workers/protocol';
import {
  WorkerClientError,
  runWorkerRequest,
} from '../../src/workers/client';

class ProtocolWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emitMessage(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }
}

describe('worker protocol', () => {
  afterEach(() => vi.useRealTimers());

  it('round-trips a versioned request with the same request ID', async () => {
    const request = createWorkerRequest('request-1', { value: 20 });
    const response = await dispatchWorkerRequest(
      request,
      async payload => ({ value: payload.value + 22 }),
    );

    expect(response).toEqual({
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'request-1',
      ok: true,
      result: { value: 42 },
    });
  });

  it('returns a typed error envelope for a version mismatch', async () => {
    const response = await dispatchWorkerRequest(
      { protocolVersion: 999, requestId: 'request-2', payload: { value: 1 } },
      async (payload: { value: number }) => payload.value,
    );

    expect(response).toMatchObject({
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'request-2',
      ok: false,
      error: { code: 'protocol_mismatch' },
    });
  });

  it('correlates a client response and always terminates the worker', async () => {
    const worker = new ProtocolWorker();
    const resultPromise = runWorkerRequest<{ value: number }, number>({
      createWorker: () => worker as unknown as Worker,
      payload: { value: 42 },
      requestId: 'request-3',
      timeoutMs: 1_000,
    });

    expect(worker.posted).toEqual([createWorkerRequest('request-3', { value: 42 })]);
    worker.emitMessage({
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'request-3',
      ok: true,
      result: 42,
    });

    await expect(resultPromise).resolves.toBe(42);
    expect(worker.terminated).toBe(true);
  });

  it('rejects cancellation with a typed error and terminates the worker', async () => {
    const worker = new ProtocolWorker();
    const controller = new AbortController();
    const resultPromise = runWorkerRequest({
      createWorker: () => worker as unknown as Worker,
      payload: 'work',
      requestId: 'request-4',
      timeoutMs: 1_000,
      signal: controller.signal,
    });

    controller.abort();

    await expect(resultPromise).rejects.toMatchObject({
      name: 'WorkerClientError',
      code: 'cancelled',
      requestId: 'request-4',
    });
    expect(worker.terminated).toBe(true);
  });

  it('rejects a timeout with a typed error and terminates the worker', async () => {
    vi.useFakeTimers();
    const worker = new ProtocolWorker();
    const resultPromise = runWorkerRequest({
      createWorker: () => worker as unknown as Worker,
      payload: 'work',
      requestId: 'request-5',
      timeoutMs: 50,
    });
    const rejection = expect(resultPromise).rejects.toMatchObject({
      name: 'WorkerClientError',
      code: 'timeout',
      requestId: 'request-5',
    });

    await vi.advanceTimersByTimeAsync(51);

    await rejection;
    expect(worker.terminated).toBe(true);
  });

  it('rejects mismatched response versions before exposing a result', async () => {
    const worker = new ProtocolWorker();
    const resultPromise = runWorkerRequest({
      createWorker: () => worker as unknown as Worker,
      payload: 'work',
      requestId: 'request-6',
      timeoutMs: 1_000,
    });

    worker.emitMessage({
      protocolVersion: 999,
      requestId: 'request-6',
      ok: true,
      result: 'unsafe',
    });

    await expect(resultPromise).rejects.toEqual(expect.objectContaining({
      code: 'protocol_mismatch',
    } satisfies Partial<WorkerClientError>));
    expect(worker.terminated).toBe(true);
  });

  it('exposes a remote handler failure as a typed client error', async () => {
    const worker = new ProtocolWorker();
    const resultPromise = runWorkerRequest({
      createWorker: () => worker as unknown as Worker,
      payload: 'work',
      requestId: 'request-7',
      timeoutMs: 1_000,
    });

    worker.emitMessage({
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'request-7',
      ok: false,
      error: { code: 'handler_error', message: 'pipeline failed' },
    });

    await expect(resultPromise).rejects.toMatchObject({
      code: 'worker_error',
      remoteCode: 'handler_error',
      message: 'pipeline failed',
    });
    expect(worker.terminated).toBe(true);
  });

  it('rejects a response carrying another request ID', async () => {
    const worker = new ProtocolWorker();
    const resultPromise = runWorkerRequest({
      createWorker: () => worker as unknown as Worker,
      payload: 'work',
      requestId: 'request-8',
      timeoutMs: 1_000,
    });

    worker.emitMessage({
      protocolVersion: WORKER_PROTOCOL_VERSION,
      requestId: 'another-request',
      ok: true,
      result: 'unsafe',
    });

    await expect(resultPromise).rejects.toMatchObject({
      code: 'protocol_mismatch',
      requestId: 'request-8',
    });
    expect(worker.terminated).toBe(true);
  });
});
