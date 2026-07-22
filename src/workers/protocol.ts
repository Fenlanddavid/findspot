export const WORKER_PROTOCOL_VERSION = 1 as const;

export type WorkerProtocolErrorCode =
  | 'handler_error'
  | 'invalid_request'
  | 'protocol_mismatch';

export interface WorkerRequest<TPayload> {
  protocolVersion: typeof WORKER_PROTOCOL_VERSION;
  requestId: string;
  payload: TPayload;
}

export interface WorkerProtocolError {
  code: WorkerProtocolErrorCode;
  message: string;
}

export interface WorkerSuccess<TResult> {
  protocolVersion: typeof WORKER_PROTOCOL_VERSION;
  requestId: string;
  ok: true;
  result: TResult;
}

export interface WorkerFailure {
  protocolVersion: typeof WORKER_PROTOCOL_VERSION;
  requestId: string;
  ok: false;
  error: WorkerProtocolError;
}

export type WorkerResponse<TResult> = WorkerSuccess<TResult> | WorkerFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function createWorkerRequest<TPayload>(
  requestId: string,
  payload: TPayload,
): WorkerRequest<TPayload> {
  return { protocolVersion: WORKER_PROTOCOL_VERSION, requestId, payload };
}

export function createWorkerSuccess<TResult>(
  requestId: string,
  result: TResult,
): WorkerSuccess<TResult> {
  return { protocolVersion: WORKER_PROTOCOL_VERSION, requestId, ok: true, result };
}

export function createWorkerFailure(
  requestId: string,
  code: WorkerProtocolErrorCode,
  message: string,
): WorkerFailure {
  return {
    protocolVersion: WORKER_PROTOCOL_VERSION,
    requestId,
    ok: false,
    error: { code, message },
  };
}

/** Execute one untrusted worker request and always return a typed envelope. */
export async function dispatchWorkerRequest<TPayload, TResult>(
  rawRequest: unknown,
  handler: (payload: TPayload) => TResult | Promise<TResult>,
): Promise<WorkerResponse<TResult>> {
  const requestId = isRecord(rawRequest) && typeof rawRequest.requestId === 'string'
    ? rawRequest.requestId
    : 'unknown';

  if (!isRecord(rawRequest) || !Object.hasOwn(rawRequest, 'payload')) {
    return createWorkerFailure(requestId, 'invalid_request', 'Worker request is malformed.');
  }
  if (rawRequest.protocolVersion !== WORKER_PROTOCOL_VERSION) {
    return createWorkerFailure(
      requestId,
      'protocol_mismatch',
      `Unsupported worker protocol version ${String(rawRequest.protocolVersion)}; expected ${WORKER_PROTOCOL_VERSION}.`,
    );
  }
  if (!requestId.trim()) {
    return createWorkerFailure('unknown', 'invalid_request', 'Worker request ID is missing.');
  }

  try {
    return createWorkerSuccess(requestId, await handler(rawRequest.payload as TPayload));
  } catch (error) {
    return createWorkerFailure(
      requestId,
      'handler_error',
      error instanceof Error ? error.message : String(error),
    );
  }
}
