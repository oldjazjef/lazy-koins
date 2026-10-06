import { resolve } from 'node:path';
import { sqliteFilePath } from './sqlite-url';

describe('sqliteFilePath', () => {
  // `resolve` on the expectation too: on Windows `/repo` resolves to `C:\repo` (surf-lend's copy of
  // this spec only ever ran on Linux and hard-coded the POSIX form).
  it('resolves relative paths against the working directory', () => {
    expect(sqliteFilePath('file:./.data/lazykoins.db', '/repo')).toBe(
      resolve('/repo', '.data/lazykoins.db'),
    );
    expect(sqliteFilePath('file:dev.db', '/repo')).toBe(
      resolve('/repo', 'dev.db'),
    );
  });

  it('keeps absolute paths and drops query parameters', () => {
    expect(
      sqliteFilePath('file:/data/lazykoins.db?connection_limit=1', '/repo'),
    ).toBe('/data/lazykoins.db');
  });

  it('rejects anything that is not a file URL', () => {
    expect(() => sqliteFilePath('postgres://u:p@h/db')).toThrow(
      /SQLite file URL/,
    );
    expect(() => sqliteFilePath('file:')).toThrow(/no file path/);
  });
});
