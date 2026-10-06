import { z } from 'zod';

/** The wallet form (F6.1). Messages are i18n keys. Secrets are refused by the API (F6.2). */
export const WalletFormSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, 'wallets.form.labelRequired')
    .max(120, 'wallets.form.labelTooLong'),
  address: z.string().trim().max(200, 'wallets.form.addressTooLong'),
  notes: z.string().max(2000, 'wallets.form.notesTooLong'),
});

export type WalletFormValue = z.infer<typeof WalletFormSchema>;
