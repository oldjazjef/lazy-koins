import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type {
  SetupStepId,
  SetupView,
  StepState,
} from '../../../../core/api/setup.types';
import { NotificationService } from '../../../../core/notifications/notification.service';
import { setupGuard } from '../../../../core/setup/setup-state.service';
import { SetupPageService } from './setup-page.service';

const settle = async () => {
  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setTimeout(resolve));
  }
};

const WEB_STEPS: SetupStepId[] = [
  'profile',
  'advisor',
  'ai',
  'rates',
  'wallets',
  'mail',
  'pin',
  'summary',
];

function view(
  states: Partial<Record<SetupStepId, StepState>> = {},
  over: Partial<SetupView> = {},
): SetupView {
  return {
    mode: 'web',
    steps: WEB_STEPS.map((id) => ({
      id,
      required: id === 'profile',
      state: states[id] ?? 'open',
    })),
    currentStep: 'profile',
    completedAt: null,
    complete: false,
    missing: ['profile'],
    facts: {
      profile: false,
      advisor: false,
      ai: false,
      onlineRates: true,
      coingeckoKey: false,
      etherscanKey: false,
      mail: false,
      pin: false,
      keyStorage: true,
    },
    ...over,
  };
}

const step = (ok: boolean) => ({ submit: vi.fn(async () => ok) });

async function setup(initial: SetupView, requested?: string) {
  const notifications = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  const router = { navigateByUrl: vi.fn(async () => true) };
  TestBed.configureTestingModule({
    providers: [
      SetupPageService,
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: NotificationService, useValue: notifications },
      { provide: Router, useValue: router },
    ],
  });
  const service = TestBed.inject(SetupPageService);
  const http = TestBed.inject(HttpTestingController);
  const ready = service.init(requested);
  await settle();
  http.expectOne('/api/setup').flush(initial);
  await ready;
  await settle();
  return { service, http, notifications, router };
}

describe('SetupPageService (F11.0s stepper)', () => {
  it('opens where the user left off; only visited steps can be opened from the bar', async () => {
    const { service, http } = await setup(
      view({ profile: 'done', advisor: 'skipped' }, { currentStep: 'ai' }),
    );
    expect(service.current()).toBe('ai');
    expect(service.canVisit('profile')).toBe(true);
    expect(service.canVisit('advisor')).toBe(true);
    expect(service.canVisit('mail')).toBe(false);
    service.goTo('mail');
    expect(service.current()).toBe('ai');
    service.goTo('profile');
    expect(service.current()).toBe('profile');
    const patch = http.expectOne('/api/setup');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ currentStep: 'profile' });
    patch.flush(view({}, { currentStep: 'profile' }));
  });

  it('a deep link opens that step directly (?step=ai) and stores it', async () => {
    const { service, http } = await setup(view(), 'ai');
    expect(service.current()).toBe('ai');
    expect(service.canVisit('profile')).toBe(true);
    const stored = http.expectOne('/api/setup');
    expect(stored.request.body).toEqual({ currentStep: 'ai' });
    stored.flush(view({}, { currentStep: 'ai' }));
  });

  it('an unknown deep link falls back to the stored step', async () => {
    const { service } = await setup(
      view({}, { currentStep: 'rates' }),
      'storage',
    );
    expect(service.current()).toBe('rates');
  });

  it('"Weiter" validates the step: invalid → stays and shows the error state', async () => {
    const { service, http } = await setup(view());
    const pending = service.next(step(false));
    await settle();
    const patch = http.expectOne('/api/setup');
    expect(patch.request.body).toEqual({ states: { profile: 'error' } });
    patch.flush(view({ profile: 'error' }));
    expect(await pending).toBe(false);
    expect(service.current()).toBe('profile');
  });

  it('"Weiter" with a valid step: done, and the next step opens', async () => {
    const { service, http } = await setup(view());
    const form = step(true);
    const pending = service.next(form);
    await settle();
    const patch = http.expectOne('/api/setup');
    expect(patch.request.body).toEqual({
      states: { profile: 'done' },
      currentStep: 'advisor',
    });
    patch.flush(view({ profile: 'done' }, { currentStep: 'advisor' }));
    expect(await pending).toBe(true);
    expect(form.submit).toHaveBeenCalledOnce();
    expect(service.current()).toBe('advisor');
    expect(service.step()?.state).toBe('open');
  });

  it('the API refuses "done" (settings missing): error state, message, stays', async () => {
    const { service, http, notifications } = await setup(view());
    const pending = service.next(step(true));
    await settle();
    http
      .expectOne('/api/setup')
      .flush(
        { code: 'stepIncomplete' },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
    await settle();
    http.expectOne('/api/setup').flush(view({ profile: 'error' }));
    expect(await pending).toBe(false);
    expect(notifications.error).toHaveBeenCalledWith('setup.stepIncomplete');
    expect(service.current()).toBe('profile');
  });

  it('"Später" only for optional steps', async () => {
    const { service, http } = await setup(view());
    expect(service.canSkip()).toBe(false);
    await service.skip();
    http.expectNone('/api/setup');

    service.goTo('profile');
    const done = service.next(step(true));
    await settle();
    http
      .expectOne('/api/setup')
      .flush(view({ profile: 'done' }, { currentStep: 'advisor' }));
    await done;
    expect(service.canSkip()).toBe(true);
    const skipped = service.skip();
    await settle();
    const patch = http.expectOne('/api/setup');
    expect(patch.request.body).toEqual({
      states: { advisor: 'skipped' },
      currentStep: 'ai',
    });
    patch.flush(
      view({ profile: 'done', advisor: 'skipped' }, { currentStep: 'ai' }),
    );
    await skipped;
    expect(service.current()).toBe('ai');
    expect(service.steps()[1]?.state).toBe('skipped');
  });

  it('"Zurück" goes to the previous step', async () => {
    const { service, http } = await setup(
      view({ profile: 'done' }, { currentStep: 'advisor' }),
    );
    service.back();
    expect(service.current()).toBe('profile');
    http.expectOne('/api/setup').flush(view({ profile: 'done' }));
    expect(service.isFirst()).toBe(true);
  });

  it('"App starten": finishes and opens the app; refused → back to the missing step', async () => {
    const { service, http, router, notifications } = await setup(
      view({}, { currentStep: 'summary' }),
    );
    const refused = service.finish('app');
    await settle();
    http
      .expectOne('/api/setup/complete')
      .flush(
        { code: 'setupIncomplete', missing: ['profile'] },
        { status: 422, statusText: 'Unprocessable Entity' },
      );
    expect(await refused).toBe(false);
    expect(notifications.error).toHaveBeenCalledWith('setup.finishFailed');
    expect(service.current()).toBe('profile');
    http.expectOne('/api/setup').flush(view());

    const finished = service.finish('project');
    await settle();
    http
      .expectOne('/api/setup/complete')
      .flush(view({}, { complete: true, completedAt: '2026-10-07T10:00:00Z' }));
    expect(await finished).toBe(true);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/app/projects/new');
  });
});

describe('setupGuard (F11.0s)', () => {
  async function guard(url: string, answer: SetupView | 'error') {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const http = TestBed.inject(HttpTestingController);
    const result = TestBed.runInInjectionContext(() =>
      setupGuard({} as never, { url } as never),
    ) as Promise<unknown>;
    await settle();
    // Pages open during the wizard never ask the API.
    if (/^\/app\/(setup|help)(?=$|[/?#])/.test(url)) {
      http.expectNone('/api/setup');
      return result;
    }
    const request = http.expectOne('/api/setup');
    if (answer === 'error') {
      request.flush(null, { status: 500, statusText: 'Error' });
    } else {
      request.flush(answer);
    }
    return result;
  }

  it('sends every page to the wizard while it is not finished', async () => {
    const result = await guard('/app/dashboard', view());
    expect(String(result)).toBe('/app/setup');
  });

  it('lets the app open when finished, on the wizard itself, and when the API is down', async () => {
    expect(await guard('/app/projects', view({}, { complete: true }))).toBe(
      true,
    );
    TestBed.resetTestingModule();
    expect(await guard('/app/setup?step=ai', view())).toBe(true);
    // F11.21: the guide stays open during the wizard (its link from the wizard).
    TestBed.resetTestingModule();
    expect(await guard('/app/help#setup', view())).toBe(true);
    TestBed.resetTestingModule();
    expect(String(await guard('/app/helpers', view()))).toBe('/app/setup');
    TestBed.resetTestingModule();
    expect(await guard('/app/dashboard', 'error')).toBe(true);
  });
});
