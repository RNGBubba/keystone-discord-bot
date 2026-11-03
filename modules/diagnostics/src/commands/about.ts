import { defineCommand, requireGuild } from "@keystone/kernel";
import { guildLocale, t } from "@keystone/i18n";
import { VERSION } from "../changelog";

export const about = defineCommand({
  name: "about",
  description: "Show what Keystone is and how this server is configured.",
  guards: [requireGuild],
  async execute(ctx) {
    const guildId = ctx.guildId;
    if (!guildId) return; // requireGuild already guarantees this; keeps TS honest.

    const settings = await ctx.settings.get(guildId);
    const enabled = settings.enabled === true;
    const locale = await guildLocale(ctx.config, guildId);

    await ctx.interaction.reply({
      ephemeral: true,
      embeds: [
        {
          // i18n-exempt: the product name is not translated.
          title: "Keystone",
          description: t(locale, "about.description"),
          color: 0x5865f2,
          fields: [
            { name: t(locale, "about.field.version"), value: VERSION, inline: true },
            { name: t(locale, "about.field.module"), value: "diagnostics", inline: true },
            {
              name: t(locale, "about.field.enabled"),
              value: t(locale, enabled ? "about.enabled.yes" : "about.enabled.no"),
              inline: true,
            },
            {
              name: t(locale, "about.field.learn"),
              value: "`memory/vault/04-Modules/diagnostics/Spec.md`",
            },
          ],
          footer: { text: t(locale, "about.footer") },
        },
      ],
    });
  },
  notes:
    "Demonstrates reading per-guild settings inside a command. Defaults come from the manifest, so this works on a server that has never run /setup.",
});
