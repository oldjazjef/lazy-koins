import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AppVersionService } from './app-version.service';

describe('AppVersionService', () => {
  it('reads the build version from /api/version', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const service = TestBed.inject(AppVersionService);
    TestBed.tick();
    expect(service.info()).toBeNull();

    TestBed.inject(HttpTestingController).expectOne('/api/version').flush({
      version: '1.2.3',
      commit: 'abc1234',
      full: '1.2.3+abc1234',
      builtAt: '2026-10-07T12:00:00.000Z',
    });
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
    expect(service.info()?.full).toBe('1.2.3+abc1234');
  });
});
