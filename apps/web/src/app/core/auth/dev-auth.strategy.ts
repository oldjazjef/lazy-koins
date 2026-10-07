import type { AuthStrategy } from './auth-strategy';

export const DEV_AUTH_STORAGE_KEY = 'lk-dev-auth-email';
/** When the dev user signed in (epoch ms) — sent like Firebase's `auth_time` (F11.0p). */
export const DEV_AUTH_AT_STORAGE_KEY = 'lk-dev-auth-at';

/**
 * `authMode: 'dev'` — pairs with the API's `AUTH_MODE=dev`, which accepts `dev:<email>` as a
 * bearer token. No Firebase project, no network sign-in: for local development and for the seed
 * user (anna@lazykoins.dev). The API refuses this mode in production. The token carries the
 * sign-in time (`dev:<email>#<epoch ms>`), so the PIN lock's "fresh sign-in" rule works in dev.
 */
export class DevAuthStrategy implements AuthStrategy {
  async restore(): Promise<boolean> {
    return this.email() !== null;
  }

  async signIn(email: string): Promise<void> {
    localStorage.setItem(DEV_AUTH_STORAGE_KEY, email.trim().toLowerCase());
    localStorage.setItem(DEV_AUTH_AT_STORAGE_KEY, String(Date.now()));
  }

  async token(): Promise<string | null> {
    const email = this.email();
    if (!email) return null;
    const at = localStorage.getItem(DEV_AUTH_AT_STORAGE_KEY);
    return at && /^\d{10,16}$/.test(at) ? `dev:${email}#${at}` : `dev:${email}`;
  }

  email(): string | null {
    return localStorage.getItem(DEV_AUTH_STORAGE_KEY);
  }

  async signOut(): Promise<void> {
    localStorage.removeItem(DEV_AUTH_STORAGE_KEY);
    localStorage.removeItem(DEV_AUTH_AT_STORAGE_KEY);
  }
}
