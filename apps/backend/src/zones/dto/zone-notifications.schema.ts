import { z } from 'zod';
import { MAX_CHILDREN_PER_ZONE } from './constants';

/** v0.65.0: PUT /zones/:id/my-notifications — личные настройки текущего родителя. */
export const ZoneMyNotificationsSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            childId: z.string().cuid(),
            onEntry: z.boolean(),
            onExit: z.boolean(),
            onMissedArrival: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_CHILDREN_PER_ZONE),
  })
  .strict();

export type ZoneMyNotificationsDto = z.infer<typeof ZoneMyNotificationsSchema>;
