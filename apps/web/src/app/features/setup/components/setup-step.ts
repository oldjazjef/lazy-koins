import { forwardRef, type Provider, type Type } from '@angular/core';

/**
 * What every step of the setup wizard (F11.0s) offers the page: "Weiter" calls `submit()` — it
 * validates and saves the step's form (through the settings' own services and endpoints) and
 * answers whether the wizard may move on.
 */
export abstract class SetupStepComponent {
  /** Validate and save; false = stay on the step (the form shows why). */
  abstract submit(): Promise<boolean>;
}

/** `providers: [provideSetupStep(() => MyStep)]` — lets the page find the step on screen. */
export function provideSetupStep(
  type: () => Type<SetupStepComponent>,
): Provider {
  return {
    provide: SetupStepComponent,
    useExisting: forwardRef(type),
  };
}
