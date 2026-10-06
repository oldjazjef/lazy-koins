import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { aiErrorHintKey, aiErrorInfo, aiErrorReport } from './ai-error-details';
import { AiErrorPanel } from './ai-error-panel';

const failure = (body: unknown, status = 502) =>
  new HttpErrorResponse({ error: body, status, statusText: 'x' });

describe('aiErrorInfo', () => {
  it('reads the details of a 502 and picks the hint', () => {
    expect(
      aiErrorInfo(
        failure({
          statusCode: 502,
          code: 'invalidKey',
          status: 401,
          providerMessage: 'Incorrect API key provided: sk-[redacted]',
          providerType: 'invalid_request_error',
          providerCode: 'invalid_api_key',
          url: 'https://api.openai.com/v1/chat/completions',
          model: 'gpt-4.1-mini',
        }),
      ),
    ).toEqual({
      key: 'ai.errors.invalidKey',
      code: 'invalidKey',
      httpStatus: 502,
      status: 401,
      providerMessage: 'Incorrect API key provided: sk-[redacted]',
      providerType: 'invalid_request_error',
      providerCode: 'invalid_api_key',
      url: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-4.1-mini',
      hintKey: 'ai.hints.key',
    });
  });

  it('knows the typical cases', () => {
    expect(aiErrorHintKey({ key: '', status: 404 })).toBe('ai.hints.model');
    expect(aiErrorHintKey({ key: '', status: 429 })).toBe('ai.hints.rateLimit');
    expect(aiErrorHintKey({ key: '', cause: 'ECONNREFUSED' })).toBe(
      'ai.hints.refused',
    );
    expect(aiErrorHintKey({ key: '', cause: 'ENOTFOUND (x.example)' })).toBe(
      'ai.hints.notFound',
    );
    expect(aiErrorHintKey({ key: '', cause: 'CERT_HAS_EXPIRED' })).toBe(
      'ai.hints.tls',
    );
    expect(aiErrorHintKey({ key: '', code: 'timeout' })).toBe(
      'ai.hints.timeout',
    );
    expect(aiErrorHintKey({ key: '', status: 500 })).toBeUndefined();
  });

  it('handles errors that are not HTTP failures', () => {
    expect(aiErrorInfo(new Error('x'))).toEqual({ key: 'ai.errors.failed' });
    expect(aiErrorInfo(failure(null, 0))).toMatchObject({
      key: 'ai.errors.unreachable',
      hintKey: 'ai.hints.unreachable',
    });
  });

  it('writes a plain-text report for "Details kopieren"', () => {
    const report = aiErrorReport(
      {
        key: 'ai.errors.network',
        code: 'network',
        cause: 'ECONNREFUSED',
        url: 'http://localhost:11434/v1/chat/completions',
        hintKey: 'ai.hints.refused',
      },
      (key) => key,
    );
    expect(report.split('\n')).toEqual([
      'ai.details.summary: ai.errors.network',
      'ai.details.url: http://localhost:11434/v1/chat/completions',
      'ai.details.code: network',
      'ai.details.cause: ECONNREFUSED',
      'ai.details.hint: ai.hints.refused',
    ]);
  });
});

describe('AiErrorPanel', () => {
  function render(collapsible = false) {
    TestBed.configureTestingModule({ providers: [provideTranslateService()] });
    const fixture = TestBed.createComponent(AiErrorPanel);
    fixture.componentRef.setInput(
      'error',
      aiErrorInfo(
        failure({
          code: 'modelNotFound',
          status: 404,
          providerMessage: 'model "llama9" not found',
          url: 'http://localhost:11434/v1/chat/completions',
          model: 'llama9',
        }),
      ),
    );
    fixture.componentRef.setInput('collapsible', collapsible);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows summary, hint and every detail', () => {
    const el = render();
    const text = el.textContent ?? '';
    for (const part of [
      'ai.errors.modelNotFound',
      'ai.hints.model',
      '404',
      'model "llama9" not found',
      'http://localhost:11434/v1/chat/completions',
      'llama9',
      'modelNotFound',
      'ai.details.copy',
    ]) {
      expect(text).toContain(part);
    }
    expect(el.querySelector('[role="alert"]')).not.toBe(null);
    expect(el.querySelector('details')).toBe(null);
  });

  it('folds the details away in dialogs', () => {
    const el = render(true);
    expect(el.querySelector('details summary')?.textContent).toContain(
      'ai.details.show',
    );
    expect(el.querySelector('details')?.textContent).toContain('llama9');
  });

  it('copies the details as text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const el = render();
    el.querySelector<HTMLButtonElement>('button')?.click();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('model "llama9" not found'),
    );
  });
});
