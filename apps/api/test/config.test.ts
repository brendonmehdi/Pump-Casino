import { describe, expect, it } from 'vitest';
import { CLOUDFLARE_RANGES, loadConfig } from '../src/config';

const base = { DATABASE_URL: 'postgres://user:pass@localhost:5432/db' };

describe('loadConfig', () => {
  it('defaults to trusting no proxy and to Secure cookies only in production', () => {
    expect(loadConfig(base)).toMatchObject({ trustProxy: false, cookieSecure: false });
    expect(loadConfig({ ...base, NODE_ENV: 'production' }).cookieSecure).toBe(true);
  });

  it('accepts trusted proxy addresses as a list', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: 'uniquelocal, 100.64.0.0/10' }).trustProxy).toEqual([
      'uniquelocal',
      '100.64.0.0/10',
    ]);
  });

  it("expands `cloudflare` into Cloudflare's published ranges", () => {
    const trusted = loadConfig({
      ...base,
      TRUST_PROXY: 'loopback,uniquelocal, cloudflare',
    }).trustProxy;
    expect(trusted).toEqual(['loopback', 'uniquelocal', ...CLOUDFLARE_RANGES]);
    expect(trusted).toContain('172.64.0.0/13');
    expect(trusted).toContain('2606:4700::/32');
  });

  it.each(['true', '1'])(
    'refuses TRUST_PROXY=%s, which would let clients spoof their IP',
    (value) => {
      expect(() => loadConfig({ ...base, TRUST_PROXY: value })).toThrow(/TRUST_PROXY/);
    },
  );

  it('refuses a missing or non-postgres DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
  });
});
