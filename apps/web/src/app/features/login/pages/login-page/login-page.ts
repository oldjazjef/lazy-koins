import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { HlmCardImports } from '@lazykoins/ui/card';
import { HlmInputImports } from '@lazykoins/ui/input';
import { HlmLabelImports } from '@lazykoins/ui/label';
import { HlmSeparatorImports } from '@lazykoins/ui/separator';
import { z } from 'zod';
import { zodValidator } from '../../../../shared/forms/zod-validator';
import { LoginPageService } from './login-page.service';

/** Firebase's own minimum for e-mail/password accounts. */
const PASSWORD_MIN = 6;

const CredentialsSchema = z.object({
  email: z.email('login.emailInvalid'),
  password: z.string().min(PASSWORD_MIN, 'login.passwordTooShort'),
});

const DevLoginSchema = z.object({ email: z.email('login.emailInvalid') });

@Component({
  selector: 'lk-login-page',
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmSeparatorImports,
  ],
  templateUrl: './login-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPage {
  protected readonly service = inject(LoginPageService);
  /**
   * Where to go after signing in — set by `authGuard` (`/login?next=/app/projects/…`).
   *
   * No default value on the input: router input binding sets an absent query parameter to
   * `undefined`, which would override it. The fallback lives in the service instead.
   */
  readonly next = input<string | undefined>();

  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly form = this.fb.group(
    { email: [''], password: [''] },
    { validators: zodValidator(CredentialsSchema) },
  );
  protected readonly devForm = this.fb.group(
    { email: ['anna@lazykoins.dev'] },
    { validators: zodValidator(DevLoginSchema) },
  );

  protected signIn(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    void this.service
      .signIn(this.form.getRawValue(), this.next())
      .catch(() => undefined);
  }

  protected register(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    void this.service
      .register(this.form.getRawValue(), this.next())
      .catch(() => undefined);
  }

  protected resetPassword(): void {
    const email = this.form.controls.email;
    email.markAsTouched();
    if (email.errors?.['zod']) return;
    void this.service.resetPassword(email.value).catch(() => undefined);
  }

  protected signInWithGoogle(): void {
    void this.service.signInWithGoogle(this.next()).catch(() => undefined);
  }

  protected signInAsDevUser(): void {
    if (this.devForm.invalid) return;
    void this.service
      .signInAsDevUser(this.devForm.getRawValue().email, this.next())
      .catch(() => undefined);
  }
}
