import { apiUrl, isApiRequest } from './api-url';

describe('apiUrl / isApiRequest', () => {
  afterEach(() => {
    delete window.__LK_ENV__;
  });

  it('builds same-origin API URLs by default', () => {
    expect(apiUrl('/projects')).toBe('/api/projects');
    expect(isApiRequest('/api/projects')).toBe(true);
  });

  it('never treats a foreign host as the API — the token must not leak there', () => {
    window.__LK_ENV__ = { apiBaseUrl: 'https://lazykoins.example' };
    expect(apiUrl('/me')).toBe('https://lazykoins.example/api/me');
    expect(isApiRequest('https://lazykoins.example/api/me')).toBe(true);
    expect(isApiRequest('https://evil.example/api/me')).toBe(false);
    expect(isApiRequest('/i18n/de-CH.json')).toBe(false);
  });
});
