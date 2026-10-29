import { describe, expect, it } from 'vitest';
import { cachedPing } from '../src/http/cached-ping';

describe('cachedPing', () => {
  it('shares one ping per interval, including one still in flight', async () => {
    let calls = 0;
    let time = 0;
    const ping = cachedPing(
      () => {
        calls += 1;
        return Promise.resolve();
      },
      2_000,
      () => time,
    );
    await Promise.all([ping(), ping(), ping()]);
    time = 1_999;
    await ping();
    expect(calls).toBe(1);
    time = 2_000;
    await ping();
    expect(calls).toBe(2);
  });

  it('reports a failure to every caller in the interval, then tries again', async () => {
    let healthy = false;
    let time = 0;
    const ping = cachedPing(
      () => (healthy ? Promise.resolve() : Promise.reject(new Error('down'))),
      2_000,
      () => time,
    );
    await expect(ping()).rejects.toThrow('down');
    healthy = true;
    await expect(ping()).rejects.toThrow('down');
    time = 2_000;
    await expect(ping()).resolves.toBeUndefined();
  });
});
