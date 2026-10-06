import type { AuthStrategy } from './auth-strategy';

export const DEV_AUTH_STORAGE_KEY = 'lk-dev-auth-email';

/**
 * `authMode: 'dev'` — pairs with the API's `AUTH_MODE=dev`, which accepts `dev:<email>` as a
 * bearer token. No Firebase project, no network sign-in: for local development and for the seed
 * user (anna@lazykoins.dev). The API refuses this mode in production.
 */
export class DevAuthStrategy implements AuthStrategy {
  async restore(): Promise<boolean> {
    return this.email() !== null;
  }

  async signIn(email: string): Promise<void> {
    localStorage.setItem(DEV_AUTH_STORAGE_KEY, email.trim().toLowerCase());
  }

  async token(): Promise<string | null> {
    const email = this.email();
    return email ? `dev:${email}` : null;
  }

  email(): string | null {
    return localStorage.getItem(DEV_AUTH_STORAGE_KEY);
  }

  async signOut(): Promise<void> {
    localStorage.removeItem(DEV_AUTH_STORAGE_KEY);
  }
}
