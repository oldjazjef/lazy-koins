import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';
import { DEV_AUTH_STORAGE_KEY } from './dev-auth.strategy';

/** The interceptor awaits the token (a promise) before the request is issued. */
const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('authInterceptor', () => {
  beforeEach(() => {
    localStorage.setItem(DEV_AUTH_STORAGE_KEY, 'anna@lazykoins.dev');
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    localStorage.clear();
  });

  it('sends the bearer token to the API', async () => {
    await TestBed.inject(AuthService).ready;
    const done = firstValueFrom(TestBed.inject(HttpClient).get('/api/me'));
    await settle();
    const request = TestBed.inject(HttpTestingController).expectOne('/api/me');
    expect(request.request.headers.get('Authorization')).toBe(
      'Bearer dev:anna@lazykoins.dev',
    );
    request.flush({});
    await done;
  });

  it('never sends it anywhere else', async () => {
    const done = firstValueFrom(
      TestBed.inject(HttpClient).get('/i18n/de-CH.json'),
    );
    const request = TestBed.inject(HttpTestingController).expectOne(
      '/i18n/de-CH.json',
    );
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({});
    await done;
  });
});
