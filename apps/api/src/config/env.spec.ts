import 'reflect-metadata';

import { apiDocsEnabled, NodeEnv, validateEnv } from './env';

const BASE = { DATABASE_URL: 'file:./.data/lazykoins.db' };

describe('validateEnv', () => {
  it('fills defaults', () => {
    const env = validateEnv({ ...BASE, AUTH_MODE: 'dev' });
    expect(env).toMatchObject({
      PORT: 3333,
      TRUST_PROXY_HOPS: 0,
      CORS_ORIGINS: 'http://localhost:4200',
      LOCAL_MODE: '',
    });
  });

  it('converts numbers from strings', () => {
    expect(validateEnv({ ...BASE, AUTH_MODE: 'dev', PORT: '4000' }).PORT).toBe(
      4000,
    );
  });

  it('requires the Firebase project in firebase mode', () => {
    expect(() => validateEnv(BASE)).toThrow(/FIREBASE_PROJECT_ID/);
    expect(
      validateEnv({ ...BASE, FIREBASE_PROJECT_ID: 'lazy-koins' }).AUTH_MODE,
    ).toBe('firebase');
  });

  it('refuses dev auth anywhere but development and test', () => {
    expect(() =>
      validateEnv({ ...BASE, AUTH_MODE: 'dev', NODE_ENV: 'production' }),
    ).toThrow(/only with NODE_ENV=development or test/);
    expect(
      validateEnv({ ...BASE, AUTH_MODE: 'dev', NODE_ENV: 'test' }).AUTH_MODE,
    ).toBe('dev');
  });

  it('allows local auth in any environment, but only with LOCAL_MODE=true', () => {
    expect(() => validateEnv({ ...BASE, AUTH_MODE: 'local' })).toThrow(
      /LOCAL_MODE=true/,
    );
    expect(
      validateEnv({
        ...BASE,
        AUTH_MODE: 'local',
        LOCAL_MODE: 'true',
        NODE_ENV: 'production',
      }),
    ).toMatchObject({
      AUTH_MODE: 'local',
      LOCAL_USER_EMAIL: 'local@lazykoins.local',
    });
  });

  it('refuses LOCAL_MODE without local auth, and a bad local e-mail', () => {
    expect(() =>
      validateEnv({ ...BASE, AUTH_MODE: 'dev', LOCAL_MODE: 'true' }),
    ).toThrow(/only valid with AUTH_MODE=local/);
    expect(() =>
      validateEnv({
        ...BASE,
        AUTH_MODE: 'local',
        LOCAL_MODE: 'true',
        LOCAL_USER_EMAIL: 'nobody',
      }),
    ).toThrow(/LOCAL_USER_EMAIL/);
  });

  it('rejects a database URL that is not a SQLite file', () => {
    expect(() =>
      validateEnv({
        AUTH_MODE: 'dev',
        DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      }),
    ).toThrow(/SQLite file URL/);
  });
});

describe('apiDocsEnabled', () => {
  it('is on outside production unless switched explicitly', () => {
    expect(
      apiDocsEnabled({ API_DOCS: '', NODE_ENV: NodeEnv.Development }),
    ).toBe(true);
    expect(apiDocsEnabled({ API_DOCS: '', NODE_ENV: NodeEnv.Production })).toBe(
      false,
    );
    expect(
      apiDocsEnabled({ API_DOCS: 'true', NODE_ENV: NodeEnv.Production }),
    ).toBe(true);
  });
});
