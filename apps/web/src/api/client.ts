import {
  IDEMPOTENCY_KEY_HEADER,
  errorResponseSchema,
  gameStateSchema,
  historyResponseSchema,
  rotateCommitmentResponseSchema,
  sessionResponseSchema,
  verifyResponseSchema,
  type ErrorCode,
  type ErrorResponse,
  type GameState,
  type HistoryResponse,
  type RotateCommitmentRequest,
  type RotateCommitmentResponse,
  type RoundActionRequest,
  type SessionResponse,
  type StartRoundRequest,
  type VerifyResponse,
} from '@pump/contracts';

/** Anything with a Zod-style parse; every response is validated with the shared contracts. */
interface Schema<T> {
  parse(value: unknown): T;
}

/** The server answered with a typed error. `body.state` carries the authoritative state. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorResponse,
  ) {
    super(body.error.message);
    this.name = 'ApiError';
  }

  get code(): ErrorCode {
    return this.body.error.code;
  }
}

/** The request never reached the server, or its response never came back. */
class NetworkError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NetworkError';
  }
}

export interface RetryObserver {
  onRetry(attempt: number): void;
}

/** About 20 seconds of retries before giving up. Each retry reuses the same Idempotency-Key. */
const RETRY_DELAYS_MS = [300, 800, 1_500, 3_000, 5_000, 5_000, 5_000];

interface RequestOptions {
  readonly method: 'GET' | 'POST';
  readonly body?: unknown;
  readonly idempotencyKey?: string;
}

async function send<T>(path: string, schema: Schema<T>, options: RequestOptions): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.idempotencyKey !== undefined)
    headers[IDEMPOTENCY_KEY_HEADER] = options.idempotencyKey;
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method,
      credentials: 'same-origin',
      headers,
      body: options.body === undefined ? null : JSON.stringify(options.body),
    });
  } catch (cause) {
    throw new NetworkError('Could not reach the server', { cause });
  }
  const payload = await readJson(response);
  if (response.ok) return schema.parse(payload);
  const error = errorResponseSchema.safeParse(payload);
  if (error.success) throw new ApiError(response.status, error.data);
  // Not one of our JSON errors: a proxy or gateway failure (e.g. 502 during a deploy).
  throw new NetworkError(`Unexpected ${response.status.toString()} response`);
}

/** Returns null for an empty or non-JSON body; callers treat that as an invalid response. */
async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * Sends a mutation once per user intent. If the network fails, the identical request is
 * retried with the same Idempotency-Key, so an action that committed but lost its response is
 * replayed by the server instead of being applied twice.
 */
async function sendAction<T>(
  path: string,
  schema: Schema<T>,
  body: unknown,
  observer?: RetryObserver,
): Promise<T> {
  const idempotencyKey = crypto.randomUUID();
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await send(path, schema, { method: 'POST', body, idempotencyKey });
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (!(error instanceof NetworkError) || delay === undefined) throw error;
      observer?.onRetry(attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export const api = {
  ensureSession: (): Promise<SessionResponse> =>
    send('/api/session', sessionResponseSchema, { method: 'POST' }),
  current: (): Promise<GameState> => send('/api/pump/current', gameStateSchema, { method: 'GET' }),
  history: (limit: number, cursor?: string): Promise<HistoryResponse> => {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (cursor !== undefined) params.set('cursor', cursor);
    return send(`/api/history?${params.toString()}`, historyResponseSchema, { method: 'GET' });
  },
  verify: (roundId: string): Promise<VerifyResponse> =>
    send(`/api/rounds/${encodeURIComponent(roundId)}/verify`, verifyResponseSchema, {
      method: 'GET',
    }),
  start: (body: StartRoundRequest, observer?: RetryObserver): Promise<GameState> =>
    sendAction('/api/pump/start', gameStateSchema, body, observer),
  pump: (body: RoundActionRequest, observer?: RetryObserver): Promise<GameState> =>
    sendAction('/api/pump/pump', gameStateSchema, body, observer),
  cashOut: (body: RoundActionRequest, observer?: RetryObserver): Promise<GameState> =>
    sendAction('/api/pump/cashout', gameStateSchema, body, observer),
  rotateCommitment: (body: RotateCommitmentRequest): Promise<RotateCommitmentResponse> =>
    sendAction('/api/fairness/rotate', rotateCommitmentResponseSchema, body),
};
