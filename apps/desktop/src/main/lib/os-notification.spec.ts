import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OS_TEXT_MAX,
  parseOsNotification,
  systemNotificationsEnabled,
} from './os-notification';
import { readConfig, writeConfig } from './storage';

describe('OS notifications (F11.13)', () => {
  it('accepts errors and "Handlungsbedarf" with plain one-line text only', () => {
    expect(
      parseOsNotification({
        kind: 'error',
        title: 'Kurse konnten nicht\nabgerufen werden: BTC',
        body: 'Steuern 2025',
        extra: 'ignored',
      }),
    ).toEqual({
      kind: 'error',
      title: 'Kurse konnten nicht abgerufen werden: BTC',
      body: 'Steuern 2025',
    });
    expect(parseOsNotification({ kind: 'action', title: 'x' })).toEqual({
      kind: 'action',
      title: 'x',
      body: '',
    });
    expect(
      parseOsNotification({ kind: 'action', title: 'y'.repeat(500), body: '' })
        ?.title,
    ).toHaveLength(OS_TEXT_MAX);
  });

  it('refuses info/success, missing titles and anything that is not an object', () => {
    expect(parseOsNotification({ kind: 'info', title: 'x' })).toBeNull();
    expect(parseOsNotification({ kind: 'success', title: 'x' })).toBeNull();
    expect(parseOsNotification({ kind: 'error', title: '  ' })).toBeNull();
    expect(parseOsNotification({ kind: 'error', title: 42 })).toBeNull();
    expect(parseOsNotification('error')).toBeNull();
    expect(parseOsNotification(null)).toBeNull();
  });

  it('is on by default, switchable, and survives a change of the data folder', () => {
    const userData = mkdtempSync(join(tmpdir(), 'lk-notify-'));
    expect(systemNotificationsEnabled(readConfig(userData))).toBe(true);
    writeConfig(userData, { systemNotifications: false });
    expect(systemNotificationsEnabled(readConfig(userData))).toBe(false);
    const chosen = join(userData, 'elsewhere');
    writeConfig(userData, { ...readConfig(userData), dataDir: chosen });
    expect(readConfig(userData)).toEqual({
      dataDir: chosen,
      systemNotifications: false,
    });
    writeConfig(userData, {
      dataDir: chosen,
      systemNotifications: 'yes' as never,
    });
    expect(readConfig(userData)).toEqual({ dataDir: chosen });
  });
});
