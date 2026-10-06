import type { AuthStrategy } from './auth-strategy';

/**
 * `authMode: 'local'` — the desktop app (F1.2), paired with the API's `AUTH_MODE=local`: there is
 * no sign-in and no token, every request acts as the one local user. Always signed in; the
 * address shown comes from `GET /api/me`. Signing out does nothing (there is no account).
 */
export class LocalAuthStrategy implements AuthStrategy {
  private address: string | null = null;

  constructor(
    private readonly apiBaseUrl: string,
    private readonly fetchImpl: typeof fetch = (input, init) =>
      fetch(input, init),
  ) {}

  async restore(): Promise<boolean> {
    try {
      const response = await this.fetchImpl(`${this.apiBaseUrl}/api/me`);
      if (response.ok) {
        const me = (await response.json()) as { email?: unknown };
        this.address = typeof me.email === 'string' ? me.email : null;
      }
    } catch {
      // The local API is part of the app; if it is unreachable every page says so anyway.
    }
    return true;
  }

  async token(): Promise<string | null> {
    return null;
  }

  email(): string | null {
    return this.address;
  }

  async signOut(): Promise<void> {
    // No account, nothing to sign out of.
  }
}
