import { z } from 'zod';

/** 4–8 digits (F11.0p) — the API checks the same. */
export const PIN_PATTERN = /^\d{4,8}$/;

/** Auto-lock choices offered in the app (minutes; the API accepts 1–240). */
export const AUTO_LOCK_CHOICES = [5, 10, 15, 30, 60, 120, 240] as const;

/** A new PIN, entered twice. Messages are i18n keys. */
export const NewPinSchema = z
  .object({
    pin: z.string().regex(PIN_PATTERN, 'pin.form.invalid'),
    repeat: z.string(),
    autoLockMinutes: z.number().int().min(1).max(240),
  })
  .refine((value) => value.pin === value.repeat, {
    message: 'pin.form.mismatch',
    path: ['repeat'],
  });

/** Changing the PIN: the current one as well. */
export const ChangePinSchema = z
  .object({
    currentPin: z.string().regex(PIN_PATTERN, 'pin.form.invalid'),
    pin: z.string().regex(PIN_PATTERN, 'pin.form.invalid'),
    repeat: z.string(),
  })
  .refine((value) => value.pin === value.repeat, {
    message: 'pin.form.mismatch',
    path: ['repeat'],
  });

/** The first message for one field, or null. */
export function fieldError(
  result: { success: boolean; error?: z.ZodError },
  field: string,
): string | null {
  if (result.success || !result.error) return null;
  return (
    result.error.issues.find((issue) => issue.path[0] === field)?.message ??
    null
  );
}
