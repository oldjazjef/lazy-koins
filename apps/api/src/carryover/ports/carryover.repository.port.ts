import type {
  BundleResult,
  Carryover,
  ProjectBundle,
} from '../domain/carryover';

/** Carry-over rows of a project (read side). */
export abstract class CarryoverRepositoryPort {
  /** Oldest first. */
  abstract listByProject(projectId: string): Promise<Carryover[]>;
}

/**
 * Writes a whole bundle (a follow-up project, files taken over, an imported package) in ONE
 * transaction: either everything is there afterwards or nothing (F10.8 "transaktional"). The
 * stored files are reused by id or created; a bundle never changes its source project.
 */
export abstract class ProjectBundleRepositoryPort {
  abstract write(ownerId: string, bundle: ProjectBundle): Promise<BundleResult>;
}
