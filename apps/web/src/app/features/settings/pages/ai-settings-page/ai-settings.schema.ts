import { z } from 'zod';
import { AI_PROVIDERS } from '../../../../core/api/api.types';

/** The AI settings form, mirroring apps/api's SaveAiSettingsDto. Messages are i18n keys. */
export const AiSettingsFormSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(AI_PROVIDERS, 'settings.ai.form.providerRequired'),
  baseUrl: z
    .string()
    .trim()
    .max(300, 'settings.ai.form.baseUrlInvalid')
    .refine(
      (value) => value === '' || /^https?:\/\/[^\s/?#]+/i.test(value),
      'settings.ai.form.baseUrlInvalid',
    ),
  model: z.string().trim().max(120, 'settings.ai.form.modelTooLong'),
  /** Write-only: empty keeps the stored key. */
  apiKey: z.string().trim().max(500, 'settings.ai.form.apiKeyTooLong'),
});

export type AiSettingsFormValue = z.infer<typeof AiSettingsFormSchema>;
