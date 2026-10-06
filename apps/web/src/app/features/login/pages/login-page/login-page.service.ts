import { computed, inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { defineAction } from '../../../../core/actions/action';
import { ActionRunner } from '../../../../core/actions/action-runner';
import { AuthService } from '../../../../core/auth/auth.service';

export interface Credentials {
  email: string;
  password: string;
}

@Injectable({ providedIn: 'root' })
export class LoginPageService {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly actions = inject(ActionRunner);

  readonly mode = this.auth.mode;

  private readonly emailSignIn = defineAction<Credentials, void>({
    run: ({ email, password }) => this.auth.signInWithEmail(email, password),
    messages: { error: 'login.failed' },
  });

  private readonly registration = defineAction<Credentials, void>({
    run: ({ email, password }) => this.auth.register(email, password),
    messages: { error: 'login.registerFailed' },
  });

  private readonly passwordReset = defineAction<string, void>({
    run: (email) => this.auth.resetPassword(email),
    messages: { success: 'login.resetSent', error: 'login.resetFailed' },
  });

  private readonly googleSignIn = defineAction<void, void>({
    run: () => this.auth.signInWithGoogle(),
    messages: { error: 'login.failed' },
  });

  private readonly devSignIn = defineAction<string, void>({
    run: (email) => this.auth.signInAsDevUser(email),
    messages: { error: 'login.failed' },
  });

  private readonly status = this.actions.status<void>('login');
  readonly isBusy = computed(() => this.status()?.state === 'pending');

  async signIn(credentials: Credentials, next: string | undefined) {
    await this.actions.run(this.emailSignIn, credentials, { key: 'login' });
    await this.continueTo(next);
  }

  async register(credentials: Credentials, next: string | undefined) {
    await this.actions.run(this.registration, credentials, { key: 'login' });
    await this.continueTo(next);
  }

  async resetPassword(email: string): Promise<void> {
    await this.actions.run(this.passwordReset, email, { key: 'login' });
  }

  async signInWithGoogle(next: string | undefined): Promise<void> {
    await this.actions.run(this.googleSignIn, undefined, { key: 'login' });
    await this.continueTo(next);
  }

  async signInAsDevUser(email: string, next: string | undefined) {
    await this.actions.run(this.devSignIn, email, { key: 'login' });
    await this.continueTo(next);
  }

  private async continueTo(next: string | undefined): Promise<void> {
    await this.router.navigateByUrl(safeNext(next));
  }
}

/** Only an in-app path is honoured, so `?next=` cannot redirect off-site. Exported for the spec. */
export function safeNext(next: string | undefined): string {
  return next?.startsWith('/app') && !next.startsWith('/app/../')
    ? next
    : '/app';
}
