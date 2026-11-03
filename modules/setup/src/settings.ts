import { z } from "zod";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "@keystone/i18n";

/**
 * Setup is the module that already owns guild-wide operator questions, so the
 * locale lives here rather than in a new settings mechanism. The zone's own
 * schema rejects an unsupported locale, which means `/config set`, the
 * dashboard form and the dashboard API all enforce the same list.
 */
export const setupSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  locale: z.enum(SUPPORTED_LOCALES).default(DEFAULT_LOCALE),
});

export type SetupSettings = z.infer<typeof setupSettingsSchema>;

export const setupDefaultSettings = setupSettingsSchema.parse({});
