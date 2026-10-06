import { computed, Injectable, signal } from '@angular/core';
import { runtimeEnv } from '../config/runtime-env';
import { DevAuthStrategy } from './dev-auth.strategy';
import { FirebaseAuthStrategy } from './firebase-auth.strategy';

export type SessionState = 'restoring' | 'signedOut' | 'signedIn';

/**
 * The session, as signals. Which strategy backs it is decided once, from runtime config.
 *
 * `ready` resolves when the persisted session has been restored — guards await it, so a reload
 * on a protected page does not flash the login screen.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly env = runtimeEnv();
  private readonly firebase =
    this.env.authMode === 'firebase'
      ? new FirebaseAuthStrategy(this.env.firebase)
      : undefined;
  private readonly dev =
    this.env.authMode === 'dev' ? new DevAuthStrategy() : undefined;
  private readonly strategy =
    this.firebase ?? this.dev ?? new DevAuthStrategy();

  private readonly state = signal<SessionState>('restoring');
  private readonly signedInEmail = signal<string | null>(null);
  readonly session = this.state.asReadonly();
  readonly isSignedIn = computed(() => this.state() === 'signedIn');
  readonly email = this.signedInEmail.asReadonly();
  readonly mode = this.env.authMode;

  readonly ready: Promise<void> = this.strategy
    .restore()
    .catch(() => false)
    .then((signedIn) => this.settle(signedIn));

  async signInWithEmail(email: string, password: string): Promise<void> {
    await this.requireFirebase().signInWithEmail(email, password);
    this.settle(true);
  }

  async register(email: string, password: string): Promise<void> {
    await this.requireFirebase().register(email, password);
    this.settle(true);
  }

  resetPassword(email: string): Promise<void> {
    return this.requireFirebase().resetPassword(email);
  }

  async signInWithGoogle(): Promise<void> {
    await this.requireFirebase().signInWithGoogle();
    this.settle(true);
  }

  async signInAsDevUser(email: string): Promise<void> {
    if (!this.dev) throw new Error('Dev sign-in needs authMode "dev"');
    await this.dev.signIn(email);
    this.settle(true);
  }

  token(): Promise<string | null> {
    return this.strategy.token();
  }

  async signOut(): Promise<void> {
    await this.strategy.signOut();
    this.settle(false);
  }

  private settle(signedIn: boolean): void {
    this.state.set(signedIn ? 'signedIn' : 'signedOut');
    this.signedInEmail.set(signedIn ? this.strategy.email() : null);
  }

  private requireFirebase(): FirebaseAuthStrategy {
    if (!this.firebase)
      throw new Error('This sign-in needs authMode "firebase"');
    return this.firebase;
  }
}
