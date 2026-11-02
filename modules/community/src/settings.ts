import { z } from "zod";

const rewardSchema = z.object({
  level: z.number().int().min(1).max(1_000),
  roleId: z.string().min(1),
});

const shopItemSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  price: z.number().int().min(1).max(1_000_000),
  roleId: z.string().min(1).optional(),
  description: z.string().max(200).optional(),
});

/**
 * Community settings. P3 features are off until an operator opts in, except
 * XP accumulation and the read-only rank/leaderboard commands: a fresh install
 * can be useful without sending messages or granting roles.
 */
export const communitySettingsSchema = z.object({
  enabled: z.boolean().default(true),
  xp: z
    .object({
      minPerMessage: z.number().int().min(1).max(100).default(15),
      maxPerMessage: z.number().int().min(1).max(100).default(25),
      cooldownMs: z.number().int().min(1_000).max(600_000).default(60_000),
      rewards: z.array(rewardSchema).max(50).default([]),
      multiplier: z.number().min(0.1).max(5).default(1),
    })
    .default({}),
  economy: z
    .object({
      currency: z.string().min(1).max(24).default("coins"),
      dailyAmount: z.number().int().min(1).max(100_000).default(100),
      dailyCooldownMs: z.number().int().min(60_000).max(7 * 86_400_000).default(86_400_000),
      transferMax: z.number().int().min(1).max(1_000_000).default(10_000),
      gambling: z.boolean().default(false),
      gambleMax: z.number().int().min(1).max(100_000).default(100),
      shop: z.array(shopItemSchema).max(25).default([]),
    })
    .default({}),
  welcome: z
    .object({
      enabled: z.boolean().default(false),
      channelId: z.string().min(1).optional(),
      message: z.string().min(1).max(1_500).default("Welcome {user} to {server}!"),
      roleId: z.string().min(1).optional(),
      dm: z.boolean().default(false),
      roleDelayMinutes: z.number().int().min(0).max(1_440).default(0),
    })
    .default({}),
  goodbye: z
    .object({
      enabled: z.boolean().default(false),
      channelId: z.string().min(1).optional(),
      message: z.string().min(1).max(1_500).default("Goodbye {user} from {server}."),
    })
    .default({}),
  starboard: z
    .object({
      channelId: z.string().min(1).optional(),
      threshold: z.number().int().min(1).max(50).default(3),
      emoji: z.string().min(1).max(40).default("⭐"),
      overrides: z
        .record(
          z.object({
            threshold: z.number().int().min(1).max(50),
            channelId: z.string().min(1).optional(),
          }),
        )
        .default({}),
    })
    .default({}),
  birthdays: z
    .object({
      enabled: z.boolean().default(false),
      channelId: z.string().min(1).optional(),
      roleId: z.string().min(1).optional(),
      timezone: z
        .string()
        .min(1)
        .max(64)
        .default("UTC")
        .refine((value) => {
          try {
            new Intl.DateTimeFormat("en-CA", { timeZone: value }).format();
            return true;
          } catch {
            return false;
          }
        }, "Unknown IANA timezone"),
    })
    .default({}),
  suggestions: z
    .object({
      enabled: z.boolean().default(false),
      channelId: z.string().min(1).optional(),
      minLength: z.number().int().min(3).max(200).default(10),
      maxLength: z.number().int().min(20).max(1_500).default(1_000),
    })
    .default({}),
  sticky: z
    .object({
      maxPerChannel: z.number().int().min(1).max(1).default(1),
    })
    .default({}),
  tickets: z
    .object({
      panelChannelId: z.string().min(1).optional(),
      supportRoleId: z.string().min(1).optional(),
      slaMinutes: z.number().int().min(1).max(10_080).default(60),
      maxOpenPerUser: z.number().int().min(1).max(10).default(1),
    })
    .default({}),
  giveaways: z
    .object({
      maxDurationMinutes: z.number().int().min(1).max(43_200).default(10_080),
      maxWinners: z.number().int().min(1).max(20).default(5),
    })
    .default({}),
  tempVoice: z
    .object({
      hubChannelId: z.string().min(1).optional(),
      categoryId: z.string().min(1).optional(),
      nameTemplate: z.string().min(1).max(90).default("{user}'s room"),
      userLimit: z.number().int().min(0).max(99).default(0),
    })
    .default({}),
  content: z
    .object({
      maxTags: z.number().int().min(1).max(500).default(50),
      maxEmbeds: z.number().int().min(1).max(50).default(20),
    })
    .default({}),
  feeds: z
    .object({
      max: z.number().int().min(1).max(20).default(5),
      pollMinutes: z.number().int().min(5).max(1_440).default(15),
    })
    .default({}),
  statChannels: z
    .object({
      max: z.number().int().min(1).max(10).default(3),
    })
    .default({}),
  responders: z
    .object({
      enabled: z.boolean().default(false),
      max: z.number().int().min(1).max(100).default(25),
      cooldownSeconds: z.number().int().min(0).max(3_600).default(10),
    })
    .default({}),
});

export type CommunitySettings = z.infer<typeof communitySettingsSchema>;

export const communityDefaultSettings = communitySettingsSchema.parse({});
