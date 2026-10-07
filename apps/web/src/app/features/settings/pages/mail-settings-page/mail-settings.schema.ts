import { z } from 'zod';
import { MAIL_SECURITIES } from '../../../../core/api/mail.types';

const ADDRESS =
  /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]+$/;
const HOST =
  /^(?:\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)$/i;

/** The mailer form, mirroring apps/api's SaveMailSettingsDto. Messages are i18n keys. */
export const MailSettingsFormSchema = z.object({
  enabled: z.boolean(),
  host: z
    .string()
    .trim()
    .max(253, 'settings.mail.form.hostInvalid')
    .refine(
      (value) => value === '' || HOST.test(value),
      'settings.mail.form.hostInvalid',
    ),
  port: z
    .number('settings.mail.form.portInvalid')
    .int('settings.mail.form.portInvalid')
    .min(1, 'settings.mail.form.portInvalid')
    .max(65535, 'settings.mail.form.portInvalid'),
  security: z.enum(MAIL_SECURITIES),
  username: z.string().trim().max(254, 'settings.mail.form.tooLong'),
  /** Write-only: empty keeps the stored password. */
  password: z.string().max(500, 'settings.mail.form.tooLong'),
  fromName: z.string().trim().max(120, 'settings.mail.form.tooLong'),
  fromAddress: z
    .string()
    .trim()
    .max(254, 'settings.mail.form.addressInvalid')
    .refine(
      (value) => value === '' || ADDRESS.test(value),
      'settings.mail.form.addressInvalid',
    ),
});

export type MailSettingsFormValue = z.infer<typeof MailSettingsFormSchema>;

/** The template form; unknown placeholders are flagged by the preview and refused on save. */
export const MailTemplateFormSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(1, 'settings.mail.template.subjectRequired')
    .max(300, 'settings.mail.template.subjectTooLong'),
  body: z
    .string()
    .refine(
      (value) => value.trim() !== '',
      'settings.mail.template.bodyRequired',
    )
    .refine(
      (value) => value.length <= 20000,
      'settings.mail.template.bodyTooLong',
    ),
});

export function isMailAddress(value: string): boolean {
  return ADDRESS.test(value);
}
