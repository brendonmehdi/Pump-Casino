/**
 * The seed hash this browser was shown before each bet, keyed by round id (a round takes the id
 * of the commitment it was started on). The verify page compares the server's reported hash with
 * this record, so a check doesn't rest on the server's word alone. Per-browser and capped; if
 * storage is unavailable the game still works and the comparison is simply not offered.
 */
const STORAGE_KEY = 'pump:shown-commitments';
const LIMIT = 500;

type Entries = [roundId: string, commitment: string][];

function read(): Entries {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is [string, string] =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === 'string' &&
        typeof entry[1] === 'string',
    );
  } catch {
    return [];
  }
}

export function rememberShownCommitment(roundId: string, commitment: string): void {
  const entries = read().filter(([id]) => id !== roundId);
  entries.push([roundId, commitment]);
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-LIMIT)));
  } catch {
    // Storage unavailable: nothing to compare against later.
  }
}

export function shownCommitmentFor(roundId: string): string | null {
  return read().find(([id]) => id === roundId)?.[1] ?? null;
}
