import { z } from 'zod';
import {
  CH_CANTONS,
  MAX_TAX_YEAR,
  MIN_TAX_YEAR,
  TAX_CURRENCIES,
} from '../../../../core/api/api.types';

/**
 * The new-project form, mirroring apps/api's CreateProjectDto. Messages are i18n keys, rendered
 * with `{{ error | translate }}`.
 */
export const ProjectFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'projects.form.nameRequired')
    .max(120, 'projects.form.nameTooLong'),
  taxYear: z
    .number('projects.form.taxYearInvalid')
    .int('projects.form.taxYearInvalid')
    .min(MIN_TAX_YEAR, 'projects.form.taxYearInvalid')
    .max(MAX_TAX_YEAR, 'projects.form.taxYearInvalid'),
  canton: z.enum(CH_CANTONS, 'projects.form.cantonRequired'),
  /** F4.1a: the currency every amount is valued in. */
  taxCurrency: z.enum(TAX_CURRENCIES, 'projects.form.taxCurrencyInvalid'),
  notes: z.string().max(5000, 'projects.form.notesTooLong'),
});

export type ProjectFormValue = z.infer<typeof ProjectFormSchema>;
