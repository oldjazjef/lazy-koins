import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsObject,
  IsOptional,
  ValidateBy,
  type ValidationOptions,
} from 'class-validator';
import type { SetupView } from '../application/setup.handlers';
import {
  SETUP_STEPS,
  type SetupStepId,
  STEP_STATES,
  type StepState,
} from '../domain/setup';

/** `{ <step>: <state> }` with known steps and states only. */
function IsStepStates(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isStepStates',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'object' &&
          value !== null &&
          !Array.isArray(value) &&
          Object.entries(value).every(
            ([id, state]) =>
              (SETUP_STEPS as readonly string[]).includes(id) &&
              (STEP_STATES as readonly unknown[]).includes(state),
          ),
        defaultMessage: () =>
          `states must map steps (${SETUP_STEPS.join(', ')}) to ${STEP_STATES.join(' | ')}`,
      },
    },
    options,
  );
}

export class UpdateSetupDto {
  @ApiPropertyOptional({ enum: SETUP_STEPS })
  @IsOptional()
  @IsIn(SETUP_STEPS)
  currentStep?: SetupStepId;

  @ApiPropertyOptional({
    description: 'Step id → open | done | skipped | error',
    type: 'object',
    additionalProperties: { type: 'string', enum: [...STEP_STATES] },
  })
  @IsOptional()
  @IsObject()
  @IsStepStates()
  states?: Partial<Record<SetupStepId, StepState>>;
}

class SetupStepDto {
  @ApiProperty({ enum: SETUP_STEPS }) id!: SetupStepId;
  @ApiProperty() required!: boolean;
  @ApiProperty({ enum: STEP_STATES }) state!: StepState;
}

export class SetupResponseDto {
  @ApiProperty({ enum: ['desktop', 'web'] }) mode!: 'desktop' | 'web';
  @ApiProperty({ type: [SetupStepDto] }) steps!: SetupStepDto[];
  @ApiProperty({ enum: SETUP_STEPS }) currentStep!: SetupStepId;
  @ApiProperty({ nullable: true, type: String }) completedAt!: string | null;
  @ApiProperty() complete!: boolean;
  @ApiProperty({ enum: SETUP_STEPS, isArray: true }) missing!: SetupStepId[];
  @ApiProperty({
    description: 'What is configured (profile, advisor, ai, keys, mail, pin)',
    type: 'object',
    additionalProperties: { type: 'boolean' },
  })
  facts!: Record<string, boolean>;

  static from(view: SetupView): SetupResponseDto {
    return {
      ...view,
      steps: view.steps.map((step) => ({ ...step })),
      missing: [...view.missing],
      facts: { ...view.facts },
    };
  }
}
