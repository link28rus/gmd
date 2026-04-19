import { z } from 'zod';

export const ClaimSchema = z
  .object({
    code: z.string().min(4).max(32),
    deviceName: z.string().max(120).optional(),
    osVersion: z.string().max(64).optional(),
    appVersion: z.string().max(32).optional(),
    consent14Plus: z.boolean().optional(),
  })
  .strict();
export type ClaimDto = z.infer<typeof ClaimSchema>;
