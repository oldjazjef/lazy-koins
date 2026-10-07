import type { HintState, StoredHintStatus } from '../domain/project-hint';

/** Dismissed F5.8 hints per project, keyed by the hint's stable key. No row = open. */
export abstract class HintStateRepositoryPort {
  abstract listByProject(projectId: string): Promise<HintState[]>;

  /** Creates or replaces the state of one hint. */
  abstract save(
    projectId: string,
    hintKey: string,
    state: { readonly status: StoredHintStatus; readonly note: string },
  ): Promise<HintState>;

  /** "Wieder öffnen": removes the state (no-op when there is none). */
  abstract remove(projectId: string, hintKey: string): Promise<void>;
}
