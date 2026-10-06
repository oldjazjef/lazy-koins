import { AppController } from './app.controller';
import { BUILD_INFO } from './build-info';

describe('AppController (meta)', () => {
  const controller = new AppController();

  it('reports the build version in the health probe and on /api/version', () => {
    expect(controller.health()).toMatchObject({
      status: 'ok',
      version: BUILD_INFO.full,
    });
    expect(controller.version()).toEqual(BUILD_INFO);
  });

  it('falls back to a dev version when not bundled by webpack', () => {
    expect(BUILD_INFO).toEqual({
      version: '0.0.0-dev',
      commit: 'unknown',
      full: '0.0.0-dev+unknown',
      builtAt: null,
    });
  });
});
