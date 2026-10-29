/**
 * What to log for a failed request. Drizzle's query errors embed every bound parameter in their
 * message — for a failed round insert that includes the hidden pop point and the client seed,
 * and for a commitment insert the server seed itself — so database errors are reduced to their
 * kind and Postgres code. Other errors (ours, validation) are logged in full.
 */
export function loggableError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { type: typeof error };
  if ('params' in error || 'query' in error) {
    return { type: error.name, ...databaseFields(error.cause) };
  }
  if (hasSqlState(error)) return { type: error.name, ...databaseFields(error) };
  return { type: error.name, message: error.message, stack: error.stack };
}

interface DatabaseErrorFields {
  readonly code?: unknown;
  readonly constraint?: unknown;
  readonly table?: unknown;
}

function hasSqlState(error: Error): boolean {
  const { code } = error as Error & DatabaseErrorFields;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code);
}

function databaseFields(cause: unknown): Record<string, unknown> {
  if (!(cause instanceof Error)) return {};
  const { code, constraint, table } = cause as Error & DatabaseErrorFields;
  return { code, constraint, table };
}
