import {
  UserError,
  cooldown,
  defineCommand,
  requireGuild,
  type CommandContext,
} from "@keystone/kernel";
import { guildLocale, t } from "@keystone/i18n";
import { LevelingService } from "../progress";
import { rankPanel } from "../panels";
import { port, settingsFor } from "./helpers";

/**
 * The user menu is a one-click rank view. It reads the same level projection
 * and leaderboard as `/rank view`; there is no second XP store and no image
 * renderer in this build, so the card is a text embed rather than a fake PNG.
 */
export const rankCard = defineCommand({
  name: "Rank card",
  description: "Show the selected member's level, XP and server rank.",
  type: "user",
  guards: [requireGuild, cooldown(3_000)],
  async execute(ctx: CommandContext): Promise<void> {
    const target = ctx.interaction.targetId;
    const guildId = ctx.guildId as string;
    const locale = await guildLocale(ctx.config, guildId);
    if (!target) throw new UserError(t(locale, "rank.card.noTarget"));
    const { store, actions } = port(ctx);
    const settings = await settingsFor(ctx);
    const leveling = new LevelingService(store, actions, settings, ctx.now);
    const result = await leveling.rank(guildId, target);
    await ctx.interaction.reply({
      v2: rankPanel(
        {
          userId: target,
          level: result.profile.level,
          xp: result.profile.xp,
          rank: result.rank,
        },
        locale,
      ),
    });
  },
  help: {
    category: "Community",
    examples: ["Right-click a member → Apps → Rank card"],
  },
  notes:
    "Read-only and guild-scoped. `/rank view` and the menu share LevelingService; the card is an embed until a renderer dependency is justified.",
});
