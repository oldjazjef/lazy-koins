import { Injectable, inject, signal } from '@angular/core';
import { toast } from '@spartan-ng/brain/sonner';
import { TranslateService } from '@ngx-translate/core';
import { type AiErrorInfo, aiErrorInfo } from './ai-error-details';

/**
 * AI failures as a toast with a "Details" button (user request, 07.10.2026): the toast says what
 * failed in the user's language; "Details" opens `lk-ai-error-dialog` with the full error panel
 * (provider status, provider message, address, model, hint, "Details kopieren").
 */
@Injectable({ providedIn: 'root' })
export class AiErrorNotifier {
  private readonly translate = inject(TranslateService);
  private readonly shown = signal<AiErrorInfo | null>(null);

  /** The error whose details dialog is open (null = closed). */
  readonly details = this.shown.asReadonly();

  /** Shows the toast for an AI failure; returns the parsed details for inline panels. */
  notify(error: unknown): AiErrorInfo {
    const info = aiErrorInfo(error);
    toast.error(this.translate.instant(info.key), {
      action: {
        label: this.translate.instant('ai.errorDetails.show'),
        onClick: () => this.shown.set(info),
      },
    });
    return info;
  }

  open(info: AiErrorInfo): void {
    this.shown.set(info);
  }

  close(): void {
    this.shown.set(null);
  }
}
