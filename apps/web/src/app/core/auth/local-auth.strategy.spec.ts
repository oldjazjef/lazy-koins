import { LocalAuthStrategy } from './local-auth.strategy';

describe('LocalAuthStrategy (desktop)', () => {
  it('is always signed in, sends no token and reads the address from /api/me', async () => {
    const calls: string[] = [];
    const strategy = new LocalAuthStrategy('', async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ email: 'local@lazykoins.local' }), {
        status: 200,
      });
    });

    expect(await strategy.restore()).toBe(true);
    expect(calls).toEqual(['/api/me']);
    expect(await strategy.token()).toBeNull();
    expect(strategy.email()).toBe('local@lazykoins.local');
  });

  it('stays signed in when the API cannot be reached', async () => {
    const strategy = new LocalAuthStrategy('', async () => {
      throw new TypeError('offline');
    });
    expect(await strategy.restore()).toBe(true);
    expect(strategy.email()).toBeNull();
  });
});
