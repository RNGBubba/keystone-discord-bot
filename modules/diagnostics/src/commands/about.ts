import { defineCommand, requireGuild } from "@keystone/kernel";
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

    await ctx.interaction.reply({
      ephemeral: true,
      embeds: [
        {
          title: "Keystone",
          description:
            "An open-source, teach-by-default all-in-one Discord bot. Free forever, no feature is ever moved behind a paywall.",
          color: 0x5865f2,
          fields: [
            { name: "Version", value: VERSION, inline: true },
            { name: "Module", value: "diagnostics", inline: true },
            { name: "Enabled here", value: enabled ? "yes" : "no", inline: true },
            {
              name: "Learn how this works",
              value: "`memory/vault/04-Modules/diagnostics/Spec.md`",
            },
          ],
          footer: { text: "Settings are validated by this module's Zod schema." },
        },
      ],
    });
  },
  notes:
    "Demonstrates reading per-guild settings inside a command. Defaults come from the manifest, so this works on a server that has never run /setup.",
});
