import { Injectable, inject } from '@angular/core';
import { toast } from '@spartan-ng/brain/sonner';
import { TranslateService } from '@ngx-translate/core';
import type { ErrorText } from '../api/api-error';

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
   * `detail`, when given, is appended to the translated message: a translatable reason
   * (`ErrorText`, e.g. the API error's code → "The project is closed – reopen it first") or a
   * plain value such as the file name concerned — never the API's own (English) message.
   */
  error(key: string, detail?: string | ErrorText): void {
    const message = this.translate.instant(key);
    const extra =
      typeof detail === 'string' || detail === undefined
        ? detail
        : this.translate.instant(detail.key, detail.params);
    toast.error(extra ? `${message}: ${extra}` : message);
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
