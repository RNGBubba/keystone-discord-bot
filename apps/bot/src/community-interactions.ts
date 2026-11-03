import {
  UserError,
  type CommunityActions,
  type CommunityStore,
  type ComponentRouter,
  type ComponentSigner,
  type ModuleSettings,
} from "@keystone/kernel";
import { t } from "@keystone/i18n";
import {
  ContentService,
  GiveawayService,
  ReactionRoleService,
  SuggestionService,
  TicketService,
  communitySettingsSchema,
} from "@keystone/module-community";

/** The community module's store, actions, settings and signer. */
export interface CommunityRouteDeps {
  readonly store: CommunityStore;
  readonly actions: CommunityActions;
  readonly settings: ModuleSettings;
  readonly signer: ComponentSigner;
  /** Injectable clock so ticket and panel timestamps stay deterministic. */
  readonly now?: () => number;
}

/**
 * The community module's signed component routes: the ticket panel, role
 * buttons and select, giveaways, suggestions and polls. Each handler calls the
 * same service the command path calls; the module owns the panels and data.
 */
export function registerCommunityRoutes(
  router: ComponentRouter,
  deps: CommunityRouteDeps,
): ComponentRouter {
  const now = (): number => deps.now?.() ?? Date.now();

  const config = async (guildId: string) =>
    communitySettingsSchema.parse(await deps.settings.get(guildId));

  router.register({
    namespace: "ticket",
    action: "open",
    kind: "button",
    guildOnly: true,
    async handle({ interaction, payload, locale }) {
      if (!interaction.guildId) return;
      if (payload !== interaction.guildId) {
        throw new UserError(t(locale, "ticket.panel.wrongGuild"));
      }
      if (!interaction.channelId) {
        throw new UserError(t(locale, "ticket.open.noChannel"));
      }
      const settings = await config(interaction.guildId);
      const ticket = await new TicketService(deps.store, deps.actions, settings, now).open(
        interaction.guildId,
        interaction.userId,
        interaction.channelId,
        t(locale, "ticket.open.subject"),
        locale,
      );
      await interaction.reply({
        content: t(locale, "ticket.open.reply", ticket.channelId),
        ephemeral: true,
      });
    },
  });

  router.register({
    namespace: "role",
    action: "toggle",
    kind: "button",
    guildOnly: true,
    async handle({ interaction, payload }) {
      if (!interaction.guildId) return;
      const result = await new ReactionRoleService(deps.store, deps.actions).toggle(
        interaction.guildId,
        interaction.userId,
        payload,
      );
      await interaction.reply({
        content: `${result.added ? "Added" : "Removed"} **${result.label}**.`,
        ephemeral: true,
      });
    },
  });

  router.register({
    namespace: "roles",
    action: "select",
    kind: "select",
    guildOnly: true,
    async handle({ interaction, payload }) {
      if (!interaction.guildId) return;
      const result = await new ReactionRoleService(deps.store, deps.actions).applySelection(
        interaction.guildId,
        interaction.userId,
        payload,
        [...(interaction.values ?? [])],
      );
      await interaction.reply({
        content: `Roles updated: ${result.added} added, ${result.removed} removed.`,
        ephemeral: true,
      });
    },
  });

  router.register({
    namespace: "giveaway",
    action: "enter",
    kind: "button",
    guildOnly: true,
    async handle({ interaction, payload, now: current }) {
      if (!interaction.guildId) return;
      const settings = await config(interaction.guildId);
      const result = await new GiveawayService(
        deps.store,
        deps.actions,
        settings,
        () => current,
      ).enter(interaction.guildId, payload, interaction.userId);
      await interaction.reply({
        content: result.entered
          ? `Entered. ${result.entries} entry(ies) so far.`
          : (result.reason ?? "Could not enter."),
        ephemeral: true,
      });
    },
  });

  // One route per poll option, because Discord sends only the custom id. The
  // action carries the index, so the payload stays a plain poll id.
  for (let index = 0; index < 5; index += 1) {
    router.register({
      namespace: "poll",
      action: `v${index}`,
      kind: "button",
      guildOnly: true,
      async handle({ interaction, payload, now: current }) {
        if (!interaction.guildId) return;
        const settings = await config(interaction.guildId);
        const result = await new ContentService(
          deps.store,
          deps.actions,
          settings,
          () => current,
        ).vote(interaction.guildId, payload, interaction.userId, index);
        await interaction.reply({
          content: `Vote recorded. Totals: ${result.counts.join(" / ")}.`,
          ephemeral: true,
        });
      },
    });
  }

  for (const kind of ["up", "down"] as const) {
    router.register({
      namespace: "suggest",
      action: kind,
      kind: "button",
      guildOnly: true,
      async handle({ interaction, payload, now: current }) {
        if (!interaction.guildId) return;
        const settings = await config(interaction.guildId);
        const result = await new SuggestionService(
          deps.store,
          deps.actions,
          settings,
          () => current,
          deps.signer,
        ).vote(interaction.guildId, payload, interaction.userId, kind);
        await interaction.reply({
          content: `Vote ${result.changed ? "recorded" : "already counted"}: 👍 ${result.up} · 👎 ${result.down}.`,
          ephemeral: true,
        });
      },
    });
  }

  return router;
}
