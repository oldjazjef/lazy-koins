import { FormBuilder } from '@angular/forms';
import { z } from 'zod';
import { zodValidator } from './zod-validator';

const EntrySchema = z.object({
  key: z.string().min(1, 'Key is required'),
  value: z.string(),
});

describe('zodValidator', () => {
  const fb = new FormBuilder();

  const buildForm = () =>
    fb.nonNullable.group(
      { key: [''], value: [''] },
      { validators: zodValidator(EntrySchema) },
    );

  it('puts the issue on the offending control', () => {
    const form = buildForm();

    expect(form.controls.key.errors?.['zod']).toBe('Key is required');
    expect(form.controls.value.errors).toBeNull();
  });

  it('clears the error once the value becomes valid', () => {
    const form = buildForm();
    form.patchValue({ key: 'greeting.hello' });

    expect(form.controls.key.errors).toBeNull();
    expect(form.valid).toBe(true);
  });

  it('strips only the zod key, leaving other errors in place', () => {
    const form = buildForm();
    form.patchValue({ key: 'greeting.hello' });

    // Simulate an async uniqueness check failing after the sync pass.
    // Note: this must be set *after* patchValue — Angular re-runs a control's
    // own validators on value change, which discards manually-set errors.
    form.controls.key.setErrors({ zod: 'stale', taken: true });
    form.updateValueAndValidity();

    expect(form.controls.key.errors).toEqual({ taken: true });
  });
});
