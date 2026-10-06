import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { DEV_AUTH_STORAGE_KEY } from '../../../../core/auth/dev-auth.strategy';
import { LoginPage } from './login-page';
import { safeNext } from './login-page.service';

describe('safeNext', () => {
  it('keeps in-app targets and falls back for everything else', () => {
    expect(safeNext('/app/projects/1')).toBe('/app/projects/1');
    expect(safeNext(undefined)).toBe('/app');
    expect(safeNext('https://evil.example')).toBe('/app');
    expect(safeNext('//evil.example/app')).toBe('/app');
  });
});

describe('LoginPage (dev auth)', () => {
  afterEach(() => localStorage.clear());

  // Regression carried over from surf-lend: `/login` without `?next=` bound `next` to undefined
  // and the sign-in silently never navigated.
  it('signs in and continues to the app when no ?next= is given', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideTranslateService(),
        provideRouter([
          { path: 'login', component: LoginPage },
          { path: 'app', children: [] },
        ]),
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/login', LoginPage);

    const form = harness.routeNativeElement?.querySelector('form');
    form?.dispatchEvent(new Event('submit'));
    await harness.fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));

    expect(TestBed.inject(Router).url).toBe('/app');
    expect(localStorage.getItem(DEV_AUTH_STORAGE_KEY)).toBe(
      'anna@lazykoins.dev',
    );
  });
});
