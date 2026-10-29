import type { ErrorCode } from '@pump/contracts';

/** An expected, client-visible failure with a stable error code (see ERROR_STATUS). */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    /** The round the error is about, so the response can carry its authoritative state. */
    readonly roundId: string | null = null,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
