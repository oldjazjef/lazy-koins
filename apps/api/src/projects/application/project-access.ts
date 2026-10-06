import { NotFoundException } from '@nestjs/common';
import type { Project } from '../domain/project';
import type { ProjectRepositoryPort } from '../ports/project.repository.port';

/**
 * The project, if `userId` owns it. Someone else's project reads exactly like a missing one —
 * 404, not 403 — so ids cannot be probed (CLAUDE.md, Decisions: every row is scoped to its owner).
 */
export async function loadOwnProject(
  projects: ProjectRepositoryPort,
  userId: string,
  projectId: string,
): Promise<Project> {
  const project = await projects.findById(projectId);
  if (!project || project.ownerId !== userId) {
    throw new NotFoundException('No such project');
  }
  return project;
}
