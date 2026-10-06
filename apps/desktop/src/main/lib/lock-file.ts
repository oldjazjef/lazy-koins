import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCK_FILE } from './storage';

/**
 * "This data folder is open on <host>" (F3.4). SQLite's own locks do not cross a sync client —
 * OneDrive & co. copy whole files — so two devices opening the same synced folder would each write
 * their own database and the sync client would keep one or produce a conflict copy. The app
 * writes this marker on start, refreshes it every minute and removes it on quit; another device
 * that finds a **fresh** marker from someone else warns before opening.
 */
export interface LockInfo {
  host: string;
  pid: number;
  startedAt: string;
  /** Refreshed periodically; a marker whose heartbeat is older than `staleAfterMs` is ignored. */
  heartbeatAt: string;
}

export const HEARTBEAT_MS = 60_000;
/** Generous on purpose: sync clients may take minutes to bring a newer marker over. */
export const STALE_AFTER_MS = 5 * 60_000;

export type LockAssessment =
  | { kind: 'free' }
  | { kind: 'own' }
  | { kind: 'stale'; lock: LockInfo }
  | { kind: 'foreign'; lock: LockInfo };

export function assessLock(
  existing: LockInfo | null,
  self: { host: string; pid: number },
  now: Date,
  isPidAlive: (pid: number) => boolean,
  staleAfterMs = STALE_AFTER_MS,
): LockAssessment {
  if (!existing) return { kind: 'free' };
  const sameHost = existing.host.toLowerCase() === self.host.toLowerCase();
  if (sameHost && existing.pid === self.pid) return { kind: 'own' };
  // Same machine: the process tells the truth (a crashed app leaves a marker behind).
  if (sameHost) {
    return isPidAlive(existing.pid)
      ? { kind: 'foreign', lock: existing }
      : { kind: 'stale', lock: existing };
  }
  const heartbeat = Date.parse(existing.heartbeatAt);
  if (Number.isNaN(heartbeat) || now.getTime() - heartbeat > staleAfterMs) {
    return { kind: 'stale', lock: existing };
  }
  return { kind: 'foreign', lock: existing };
}

export function parseLock(text: string): LockInfo | null {
  try {
    const raw = JSON.parse(text) as Partial<LockInfo>;
    if (
      typeof raw.host === 'string' &&
      typeof raw.pid === 'number' &&
      typeof raw.startedAt === 'string' &&
      typeof raw.heartbeatAt === 'string'
    ) {
      return {
        host: raw.host,
        pid: raw.pid,
        startedAt: raw.startedAt,
        heartbeatAt: raw.heartbeatAt,
      };
    }
  } catch {
    // Garbage = no usable marker.
  }
  return null;
}

export function readLock(dir: string): LockInfo | null {
  try {
    return parseLock(readFileSync(join(dir, LOCK_FILE), 'utf8'));
  } catch {
    return null;
  }
}

export function writeLock(dir: string, lock: LockInfo): void {
  writeFileSync(
    join(dir, LOCK_FILE),
    `${JSON.stringify(lock, null, 2)}\n`,
    'utf8',
  );
}

/** Removes the marker only if it is still ours — never another device's. */
export function releaseLock(
  dir: string,
  self: { host: string; pid: number },
): void {
  const current = readLock(dir);
  if (
    current &&
    current.host.toLowerCase() === self.host.toLowerCase() &&
    current.pid === self.pid
  ) {
    rmSync(join(dir, LOCK_FILE), { force: true });
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists, it just is not ours to signal.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
