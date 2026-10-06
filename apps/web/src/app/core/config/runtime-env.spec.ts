import { runtimeEnv } from './runtime-env';

describe('runtimeEnv', () => {
  afterEach(() => {
    delete window.__LK_ENV__;
  });

  it('falls back to development values when env.js never loaded', () => {
    expect(runtimeEnv()).toEqual({
      apiBaseUrl: '',
      authMode: 'dev',
      firebase: { apiKey: '', authDomain: '', projectId: '', appId: '' },
    });
  });

  it('uses provided values, trimming whitespace and a trailing slash', () => {
    window.__LK_ENV__ = {
      apiBaseUrl: ' https://lazykoins.example/ ',
      authMode: 'firebase',
      firebase: { projectId: 'lazy-koins' },
    };
    expect(runtimeEnv()).toMatchObject({
      apiBaseUrl: 'https://lazykoins.example',
      authMode: 'firebase',
      firebase: { projectId: 'lazy-koins', apiKey: '' },
    });
  });

  it('treats empty and non-string values as absent', () => {
    window.__LK_ENV__ = {
      apiBaseUrl: '   ',
      firebase: { apiKey: 42 as unknown as string },
    };
    expect(runtimeEnv()).toMatchObject({
      apiBaseUrl: '',
      firebase: { apiKey: '' },
    });
  });

  it('only switches to firebase auth when asked for exactly that', () => {
    window.__LK_ENV__ = { authMode: 'FIREBASE' as 'firebase' };
    expect(runtimeEnv().authMode).toBe('dev');
  });

  it('accepts the desktop app’s local mode', () => {
    window.__LK_ENV__ = { authMode: 'local' };
    expect(runtimeEnv().authMode).toBe('local');
  });
});
