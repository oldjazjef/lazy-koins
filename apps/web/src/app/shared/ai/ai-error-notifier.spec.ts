import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { toast } from '@spartan-ng/brain/sonner';
import { AiErrorNotifier } from './ai-error-notifier';

vi.mock('@spartan-ng/brain/sonner', () => ({ toast: { error: vi.fn() } }));

/** User request (07.10.2026): an AI error toast has a button that shows the provider's error. */
describe('AiErrorNotifier', () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
    TestBed.configureTestingModule({ providers: [provideTranslateService()] });
  });

  it('shows the toast with a "Details" action that opens the provider details', () => {
    const notifier = TestBed.inject(AiErrorNotifier);
    const error = new HttpErrorResponse({
      status: 502,
      error: {
        code: 'providerError',
        status: 400,
        providerMessage: 'tool_choice: type "tool" and "any" are not supported',
        model: 'claude-sonnet-5-5',
      },
    });
    const info = notifier.notify(error);
    expect(info).toMatchObject({
      status: 400,
      providerMessage: 'tool_choice: type "tool" and "any" are not supported',
    });
    expect(notifier.details()).toBeNull();
    const options = vi.mocked(toast.error).mock.calls[0]?.[1] as {
      action: { label: string; onClick: () => void };
    };
    expect(options.action.label).toBe('ai.errorDetails.show');
    options.action.onClick();
    expect(notifier.details()).toBe(info);
    notifier.close();
    expect(notifier.details()).toBeNull();
  });
});
