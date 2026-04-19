import { z } from 'zod';

export const AcceptConsentSchema = z
  .object({
    documents: z
      .array(z.enum(['PRIVACY_POLICY', 'TERMS_OF_USE']))
      .min(1, 'documents must not be empty'),
  })
  .strict();

export type AcceptConsentDto = z.infer<typeof AcceptConsentSchema>;
