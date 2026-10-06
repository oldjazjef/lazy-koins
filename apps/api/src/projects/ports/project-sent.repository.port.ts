import type {
  ProjectChangeFacts,
  ProjectSentState,
  SaveProjectSentInput,
} from '../domain/project-sent';

/** Persistence contract for F4.7 (`project_sent_state`, at most one row per project). */
export abstract class ProjectSentRepositoryPort {
  abstract find(projectId: string): Promise<ProjectSentState | undefined>;

  /** The sent states of these projects (absent = never sent). */
  abstract findMany(
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, ProjectSentState>>;

  /** Creates or replaces the project's state. */
  abstract save(
    projectId: string,
    input: SaveProjectSentInput,
  ): Promise<ProjectSentState>;

  /** "rückgängig"; `false` when nothing was set. */
  abstract remove(projectId: string): Promise<boolean>;

  /** What happened in these projects (latest calculation, exports, corrections, files). */
  abstract changeFacts(
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, ProjectChangeFacts>>;
}
