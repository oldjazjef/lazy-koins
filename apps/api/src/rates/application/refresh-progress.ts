import { Injectable } from '@nestjs/common';

/** How far a running "Kurse aktualisieren" is (one per project; in memory, one API instance). */
export interface RefreshStatus {
  readonly running: boolean;
  /** Series handled so far (FX + assets) of `total`. */
  readonly done: number;
  readonly total: number;
  /** The asset being fetched right now, if any. */
  readonly current: string | null;
}

const IDLE: RefreshStatus = {
  running: false,
  done: 0,
  total: 0,
  current: null,
};

/**
 * Progress of the rate refreshes in flight, so the app can show "Kurse werden aktualisiert
 * (12/40)" while the request is still open (`GET …/rates/refresh/status`, polled only while it
 * runs). Lost on restart — it only describes requests of this process.
 */
@Injectable()
export class RefreshProgress {
  private readonly running = new Map<string, RefreshStatus>();

  start(projectId: string, total: number): void {
    this.running.set(projectId, {
      running: true,
      done: 0,
      total,
      current: null,
    });
  }

  working(projectId: string, current: string): void {
    const status = this.running.get(projectId);
    if (status) this.running.set(projectId, { ...status, current });
  }

  step(projectId: string): void {
    const status = this.running.get(projectId);
    if (!status) return;
    this.running.set(projectId, {
      ...status,
      done: Math.min(status.done + 1, status.total),
      current: null,
    });
  }

  finish(projectId: string): void {
    this.running.delete(projectId);
  }

  of(projectId: string): RefreshStatus {
    return this.running.get(projectId) ?? IDLE;
  }
}
