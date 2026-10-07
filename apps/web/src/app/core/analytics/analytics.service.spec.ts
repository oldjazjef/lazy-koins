import { TestBed } from '@angular/core/testing';
import { AnalyticsService, umamiTracker } from './analytics.service';

describe('umamiTracker', () => {
  const env = {
    authMode: 'firebase' as const,
    umamiUrl: 'https://stats.example.ch',
    umamiWebsiteId: 'abc',
  };

  it('loads the tracker of the configured Umami for this website', () => {
    expect(umamiTracker(env)).toEqual({
      src: 'https://stats.example.ch/script.js',
      websiteId: 'abc',
    });
  });

  it('stays off without both values', () => {
    expect(umamiTracker({ ...env, umamiUrl: '' })).toBeNull();
    expect(umamiTracker({ ...env, umamiWebsiteId: '' })).toBeNull();
  });

  it('stays off in the desktop app', () => {
    expect(umamiTracker({ ...env, authMode: 'local' })).toBeNull();
  });
});

describe('AnalyticsService', () => {
  afterEach(() => {
    delete window.__LK_ENV__;
    document.head
      .querySelectorAll('script[data-website-id]')
      .forEach((script) => script.remove());
  });

  it('adds the tracker without query strings and fragments', () => {
    window.__LK_ENV__ = {
      authMode: 'firebase',
      umamiUrl: 'https://stats.example.ch/',
      umamiWebsiteId: 'abc',
    };
    TestBed.inject(AnalyticsService).init();
    const script = document.head.querySelector<HTMLScriptElement>(
      'script[data-website-id]',
    );
    expect(script?.src).toBe('https://stats.example.ch/script.js');
    expect(script?.dataset['websiteId']).toBe('abc');
    expect(script?.dataset['excludeSearch']).toBe('true');
    expect(script?.dataset['excludeHash']).toBe('true');
  });

  it('adds nothing when statistics are off', () => {
    TestBed.inject(AnalyticsService).init();
    expect(document.head.querySelector('script[data-website-id]')).toBeNull();
  });
});
