import { Injectable } from '@nestjs/common';
import type { SetupProgress as SetupProgressRow } from '../../../generated/prisma/client';
import {
  SETUP_STEPS,
  type SaveSetupProgressInput,
  type SetupProgress,
  type SetupStepId,
  STEP_STATES,
  type StepState,
} from '../../../setup/domain/setup';
import { SetupProgressRepositoryPort } from '../../../setup/ports/setup-progress.repository.port';
import { toIsoString } from '../mappers/scalar.mapper';
import { PrismaService } from '../prisma.service';

/** The JSON column → known steps with known states only (anything else is dropped). */
function parseSteps(json: string): Partial<Record<SetupStepId, StepState>> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {};
  }
  if (typeof raw !== 'object' || raw === null) return {};
  const steps: Partial<Record<SetupStepId, StepState>> = {};
  for (const [id, state] of Object.entries(raw)) {
    if (
      (SETUP_STEPS as readonly string[]).includes(id) &&
      (STEP_STATES as readonly unknown[]).includes(state)
    ) {
      steps[id as SetupStepId] = state as StepState;
    }
  }
  return steps;
}

function toProgress(row: SetupProgressRow): SetupProgress {
  return {
    userId: row.userId,
    steps: parseSteps(row.steps),
    currentStep: (SETUP_STEPS as readonly string[]).includes(row.currentStep)
      ? (row.currentStep as SetupStepId)
      : 'profile',
    completedAt: row.completedAt ? toIsoString(row.completedAt) : null,
    updatedAt: toIsoString(row.updatedAt),
  };
}

@Injectable()
export class SetupProgressPrismaRepository extends SetupProgressRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async find(userId: string): Promise<SetupProgress | undefined> {
    const row = await this.prisma.setupProgress.findUnique({
      where: { userId },
    });
    return row ? toProgress(row) : undefined;
  }

  async save(
    userId: string,
    input: SaveSetupProgressInput,
  ): Promise<SetupProgress> {
    const data = {
      steps: JSON.stringify(input.steps),
      currentStep: input.currentStep,
      completedAt: input.completedAt ? new Date(input.completedAt) : null,
    };
    const row = await this.prisma.setupProgress.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return toProgress(row);
  }
}
