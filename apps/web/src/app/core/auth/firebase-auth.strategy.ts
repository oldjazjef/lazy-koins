import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { FirebaseWebConfig } from '../config/runtime-env';
import type { AuthStrategy } from './auth-strategy';

/**
 * Firebase Authentication with the Firebase JS SDK directly (F2.1): e-mail + password —
 * register, sign in, password reset by Firebase — and Google. Web only, so the Google popup is
 * fine here (surf-lend's Capacitor plugin existed for native WebViews, which lazy-koins has not).
 *
 * The SDK is loaded on first use (`import()`), so dev mode never downloads it. The API verifies
 * the resulting Firebase ID token directly; there is no token exchange.
 */
export class FirebaseAuthStrategy implements AuthStrategy {
  private auth: Auth | undefined;

  constructor(private readonly config: FirebaseWebConfig) {}

  async restore(): Promise<boolean> {
    const auth = await this.client();
    // The SDK restores the persisted session asynchronously; without waiting, a reload would look
    // signed out for the first few hundred milliseconds and bounce to the login page.
    await auth.authStateReady();
    return auth.currentUser !== null;
  }

  async signInWithEmail(email: string, password: string): Promise<void> {
    const { signInWithEmailAndPassword } = await import('firebase/auth');
    await signInWithEmailAndPassword(await this.client(), email, password);
  }

  async register(email: string, password: string): Promise<void> {
    const { createUserWithEmailAndPassword } = await import('firebase/auth');
    await createUserWithEmailAndPassword(await this.client(), email, password);
  }

  async resetPassword(email: string): Promise<void> {
    const { sendPasswordResetEmail } = await import('firebase/auth');
    await sendPasswordResetEmail(await this.client(), email);
  }

  async signInWithGoogle(): Promise<void> {
    const { GoogleAuthProvider, signInWithPopup } =
      await import('firebase/auth');
    await signInWithPopup(await this.client(), new GoogleAuthProvider());
  }

  async token(): Promise<string | null> {
    const user = (await this.client()).currentUser;
    // Firebase caches the token and refreshes it only when it is close to expiry.
    return user ? user.getIdToken() : null;
  }

  email(): string | null {
    return this.auth?.currentUser?.email ?? null;
  }

  async signOut(): Promise<void> {
    const { signOut } = await import('firebase/auth');
    await signOut(await this.client());
  }

  private async client(): Promise<Auth> {
    if (this.auth) return this.auth;
    const [{ getApps, initializeApp }, { getAuth }] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
    ]);
    const app: FirebaseApp = getApps()[0] ?? initializeApp(this.config);
    this.auth = getAuth(app);
    return this.auth;
  }
}
