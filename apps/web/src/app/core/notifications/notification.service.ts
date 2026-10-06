import { Injectable, inject } from '@angular/core';
import { toast } from '@spartan-ng/brain/sonner';
import { TranslateService } from '@ngx-translate/core';

export interface NotificationAction {
  labelKey: string;
  onClick: () => void;
}

/** Thin wrapper so callers pass i18n keys, never raw strings, per the repo's i18n convention. */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly translate = inject(TranslateService);

  success(
    key: string,
    action?: NotificationAction,
    params?: Readonly<Record<string, unknown>>,
  ): void {
    toast.success(
      this.translate.instant(key, params),
      this.toastAction(action),
    );
  }

  /**
   * `detail`, when given, is appended to the translated message — the server's own reason for the
   * failure (e.g. a 409's "The project is closed: reopen it first"), not a translation
   * key. It is shown as-is rather than resolved through i18n, the same way a stack trace would be.
   */
  error(key: string, detail?: string): void {
    const message = this.translate.instant(key);
    toast.error(detail ? `${message}: ${detail}` : message);
  }

  info(key: string, params?: Record<string, unknown>): void {
    toast(this.translate.instant(key, params));
  }

  private toastAction(action: NotificationAction | undefined) {
    if (!action) return undefined;
    return {
      action: {
        label: this.translate.instant(action.labelKey),
        onClick: action.onClick,
      },
    };
  }
}
