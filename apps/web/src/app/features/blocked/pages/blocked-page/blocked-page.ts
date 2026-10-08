import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@lazykoins/ui/button';
import { AuthService } from '../../../../core/auth/auth.service';

/**
 * Shown when the API answers 403 `accountBlocked`: the account was blocked by a platform admin.
 * Nothing else works, so the page only explains it and offers to sign out.
 */
@Component({
  selector: 'lk-blocked-page',
  imports: [TranslatePipe, ...HlmButtonImports],
  templateUrl: './blocked-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BlockedPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly hasAccount = this.auth.hasAccount;

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigate(['/login']);
  }
}
