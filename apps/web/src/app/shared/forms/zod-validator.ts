import type {
  AbstractControl,
  ValidationErrors,
  ValidatorFn,
} from '@angular/forms';
import type { ZodType } from 'zod';

/**
 * Bridges a Zod schema into Angular's reactive-forms validation.
 *
 * Zod is the single source of truth for shape and constraints; Angular's built-in
 * `Validators.*` are not used, so a rule never has to be written twice.
 *
 * Errors are keyed under `zod` so templates can read them uniformly:
 *
 *   const form = fb.nonNullable.group({ key: [''] }, { validators: zodValidator(EntrySchema) });
 *   form.controls.key.errors?.['zod']  // -> first message for that control
 */
export function zodValidator<T>(schema: ZodType<T>): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const result = schema.safeParse(control.value);
    if (result.success) {
      clearZodErrors(control);
      return null;
    }

    // Distribute issues onto the child control they belong to, so each field
    // renders its own message instead of one lump error on the group.
    clearZodErrors(control);
    const groupIssues: string[] = [];

    for (const issue of result.error.issues) {
      const target = issue.path.length
        ? control.get(issue.path.map(String))
        : null;
      if (target) {
        target.setErrors({ ...(target.errors ?? {}), zod: issue.message });
      } else {
        groupIssues.push(issue.message);
      }
    }

    return groupIssues.length ? { zod: groupIssues[0] } : null;
  };
}

/**
 * Removes only the `zod` key, leaving any non-Zod errors (e.g. an async
 * uniqueness check) on the control untouched. Recurses into nested groups and
 * arrays (a `FormArray` of `FormGroup`s, e.g. a filter-row list) — a shallow
 * pass would leave a stale `zod` error on a grandchild control after it was
 * fixed, since `issue.path` addresses it directly regardless of depth.
 */
function clearZodErrors(control: AbstractControl): void {
  if (control.errors?.['zod'] !== undefined) {
    const rest = { ...control.errors };
    delete rest['zod'];
    control.setErrors(Object.keys(rest).length ? rest : null);
  }

  const children = (control as { controls?: unknown }).controls;
  if (Array.isArray(children)) {
    for (const child of children) clearZodErrors(child as AbstractControl);
  } else if (children && typeof children === 'object') {
    for (const child of Object.values(children))
      clearZodErrors(child as AbstractControl);
  }
}
