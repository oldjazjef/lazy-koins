import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { LibraryStatus } from '../api/api.types';
import { AuthService } from '../auth/auth.service';
import { DataChanges } from '../data/data-changes';
import { navItemsFor } from '../layout/nav-config';
import { LibraryAvailability } from './library-availability.service';

const settle = () => new Promise((resolve) => setTimeout(resolve));

const LINKED: LibraryStatus = {
  mode: 'remote',
  available: true,
  readOnly: true,
  server: 'https://lazykoins.example.ch',
  suggestions: true,
  reason: null,
};

function setup(hasAccount: boolean) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: { hasAccount } },
    ],
  });
  return {
    service: TestBed.inject(LibraryAvailability),
    http: TestBed.inject(HttpTestingController),
    changes: TestBed.inject(DataChanges),
  };
}

describe('LibraryAvailability (F5.15–F5.18)', () => {
  it('web: the own library — available, writable, never asked for', async () => {
    const { service, http } = setup(true);
    TestBed.tick();
    await settle();
    http.expectNone(() => true);
    expect(service.available()).toBe(true);
    expect(service.readOnly()).toBe(false);
    expect(service.suggestions()).toBe(true);
    expect(await service.canOpen()).toBe(true);
    expect(
      navItemsFor(service.available()).find((i) => i.path === '/app/mappings')
        ?.children,
    ).toHaveLength(2);
  });

  it('desktop: asks the API; nothing linked = no library, no nav entry, no suggestions', async () => {
    const { service, http } = setup(false);
    const open = service.canOpen();
    TestBed.tick();
    http.expectOne('/api/library/status').flush({
      ...LINKED,
      available: false,
      server: null,
      suggestions: false,
      reason: 'libraryNotConfigured',
    } satisfies LibraryStatus);
    expect(await open).toBe(false);
    expect(service.available()).toBe(false);
    expect(service.suggestions()).toBe(false);
    expect(
      navItemsFor(service.available()).find((i) => i.path === '/app/mappings')
        ?.children,
    ).toBeUndefined();
  });

  it('desktop: linked = available but read-only; follows a settings change', async () => {
    const { service, http, changes } = setup(false);
    TestBed.tick();
    http.expectOne('/api/library/status').flush(LINKED);
    await settle();
    expect(service.available()).toBe(true);
    expect(service.readOnly()).toBe(true);
    expect(service.server()).toBe('https://lazykoins.example.ch');
    expect(await service.canOpen()).toBe(true);

    // The user switches online lookups off (Einstellungen › Kurse).
    changes.changed({ scope: 'settings' });
    TestBed.tick();
    http.expectOne('/api/library/status').flush({
      ...LINKED,
      available: false,
      suggestions: false,
      reason: 'offline',
    } satisfies LibraryStatus);
    await settle();
    expect(service.available()).toBe(false);
    expect(service.suggestions()).toBe(false);
  });

  it('desktop: an unreachable API leaves the library closed', async () => {
    const { service, http } = setup(false);
    const open = service.canOpen();
    TestBed.tick();
    http
      .expectOne('/api/library/status')
      .flush('down', { status: 503, statusText: 'Unavailable' });
    expect(await open).toBe(false);
    expect(service.status()).toBeNull();
  });
});
