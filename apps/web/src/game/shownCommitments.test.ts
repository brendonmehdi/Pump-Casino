import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rememberShownCommitment, shownCommitmentFor } from './shownCommitments';

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => {
      items.clear();
    },
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

describe('shown commitments', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('remembers the hash shown for each round', () => {
    rememberShownCommitment('round-a', 'a'.repeat(64));
    rememberShownCommitment('round-b', 'b'.repeat(64));
    expect(shownCommitmentFor('round-a')).toBe('a'.repeat(64));
    expect(shownCommitmentFor('round-b')).toBe('b'.repeat(64));
    expect(shownCommitmentFor('round-c')).toBeNull();
  });

  it('keeps only the most recent 500 rounds', () => {
    for (let i = 0; i < 510; i += 1) rememberShownCommitment(`round-${i.toString()}`, 'h');
    expect(shownCommitmentFor('round-9')).toBeNull();
    expect(shownCommitmentFor('round-10')).toBe('h');
    expect(shownCommitmentFor('round-509')).toBe('h');
  });

  it('works without storage, offering nothing to compare', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => {
      rememberShownCommitment('round-a', 'a'.repeat(64));
    }).not.toThrow();
    expect(shownCommitmentFor('round-a')).toBeNull();
  });

  it('ignores corrupt stored data', () => {
    localStorage.setItem('pump:shown-commitments', '{"not":"a list"}');
    expect(shownCommitmentFor('round-a')).toBeNull();
    rememberShownCommitment('round-a', 'a'.repeat(64));
    expect(shownCommitmentFor('round-a')).toBe('a'.repeat(64));
  });
});
