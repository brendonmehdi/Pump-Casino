import { describe, expect, it } from 'vitest';
import { loggableError } from '../src/http/loggable-error';

describe('loggableError', () => {
  it('never logs the bound parameters of a failed query', () => {
    const cause = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint: 'rounds_one_active_per_player',
      table: 'rounds',
    });
    const queryError = Object.assign(
      new Error('Failed query: insert into "rounds" ... params: secret-seed,4'),
      { query: 'insert into "rounds" ...', params: ['secret-seed', 4] },
    );
    queryError.name = 'DrizzleQueryError';
    queryError.cause = cause;
    const logged = loggableError(queryError);
    expect(logged).toEqual({
      type: 'DrizzleQueryError',
      code: '23505',
      constraint: 'rounds_one_active_per_player',
      table: 'rounds',
    });
    expect(JSON.stringify(logged)).not.toContain('secret-seed');
  });

  it('keeps the message and stack of application errors', () => {
    const logged = loggableError(new Error('Round changed while locked'));
    expect(logged).toMatchObject({ type: 'Error', message: 'Round changed while locked' });
    expect(logged.stack).toEqual(expect.any(String));
  });
});
