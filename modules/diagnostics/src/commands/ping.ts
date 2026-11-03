import { cooldown, defineCommand } from "@keystone/kernel";
import { DEFAULT_LOCALE, guildLocale, t } from "@keystone/i18n";
import { formatDuration } from "../format";

export const ping = defineCommand({
  name: "ping",
  description: "Check that Keystone is awake.",
  guards: [cooldown(3_000)],
  async execute(ctx) {
    const uptime = formatDuration(process.uptime() * 1000);
    const locale = ctx.guildId ? await guildLocale(ctx.config, ctx.guildId) : DEFAULT_LOCALE;
    await ctx.interaction.reply({ content: t(locale, "ping.reply", uptime) });
  },
  notes:
    "The smallest possible command: one guard, one reply, no dependencies. Start here when reading the codebase.",
});
