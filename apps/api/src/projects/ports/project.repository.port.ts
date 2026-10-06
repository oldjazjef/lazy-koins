import type {
  CreateProjectInput,
  Project,
  UpdateProjectInput,
} from '../domain/project';

/**
 * Persistence contract for projects. An abstract class so it is both the contract and the Nest
 * DI token; the Prisma binding lives in `PersistenceModule`. Ownership is checked by the
 * handlers, never by the adapter guessing from the caller.
 */
export abstract class ProjectRepositoryPort {
  /** The owner's projects, newest tax year first (then newest created). */
  abstract findByOwner(ownerId: string): Promise<Project[]>;

  abstract findById(id: string): Promise<Project | undefined>;

  abstract create(ownerId: string, input: CreateProjectInput): Promise<Project>;

  /** `undefined` when the project no longer exists. */
  abstract update(
    id: string,
    input: UpdateProjectInput,
  ): Promise<Project | undefined>;

  /** Hard delete (F4.6); `false` when there was nothing to delete. */
  abstract delete(id: string): Promise<boolean>;
}
