import { Events, type Client } from "discord.js";
import {
  ComponentRouter,
  UserError,
  type CommunityActions,
  type CommunityStore,
  type ComponentInteractionLike,
  type ComponentSigner,
  type ConfigPort,
  type FormStore,
  type Logger,
  type ModerationPort,
  type ModuleSettings,
} from "@keystone/kernel";
import { DEFAULT_LOCALE, guildLocale, t } from "@keystone/i18n";
import {
  FORM_MODAL_TTL_MS,
  FormService,
  formModal,
  formSettingsSchema,
  modalAnswers,
  modalFits,
} from "@keystone/module-forms";
import { TicketService, communitySettingsSchema } from "@keystone/module-community";
import { asComponentInteraction } from "./adapt";
import { handleModerationButton } from "./moderation-buttons";

export interface ComponentRuntimeDeps {
  /** Signs every button and modal id; only the composition root holds it. */
  readonly signer: ComponentSigner;
  readonly forms: FormStore;
  readonly formSettings: ModuleSettings;
  readonly moderation: {
    readonly settings: ModuleSettings;
    readonly moderation: ModerationPort;
  };
  /** Ticket panel writes and reads through the same community port as `/ticket`. */
  readonly community: {
    readonly store: CommunityStore;
    readonly actions: CommunityActions;
    readonly settings: ModuleSettings;
  };
  /** Reads the setup module's per-guild locale; absent means English. */
  readonly config?: ConfigPort;
  readonly logger: Logger;
  /** Injectable clock so id expiry and submission timestamps are deterministic. */
  readonly now?: () => number;
}

/**
 * Every signed component route. The module owns the copy, the modal shape and
 * the write rules; this file only connects an interaction to them, so the
 * command path and the button path end in the same service call.
 */
export function createComponentRouter(deps: ComponentRuntimeDeps): ComponentRouter {
  const now = (): number => deps.now?.() ?? Date.now();

  const service = async (guildId: string): Promise<FormService> => {
    const settings = formSettingsSchema.parse(await deps.formSettings.get(guildId));
    return new FormService(deps.forms, settings, now);
  };

  return new ComponentRouter()
    .register({
      namespace: "form",
      action: "apply",
      kind: "button",
      guildOnly: true,
      async handle({ interaction, payload, now: current, locale }) {
        if (!interaction.guildId) return;
        if (!interaction.showModal) {
          throw new UserError(t(locale, "form.apply.noModal"));
        }
        const svc = await service(interaction.guildId);
        const form = await svc.panelForm(interaction.guildId, payload);
        if (!modalFits(form)) {
          await interaction.reply({
            content: t(
              locale,
              "form.apply.tooMany",
              form.fields.length,
              form.key,
              form.fields.map((field) => `${field.key}=...`).join("; "),
            ),
            ephemeral: true,
          });
          return;
        }
        const customId = deps.signer.sign(
          { namespace: "form", action: "submit", payload: form.key, ttlMs: FORM_MODAL_TTL_MS },
          current,
        );
        await interaction.showModal(formModal(form, customId));
      },
    })
    .register({
      namespace: "form",
      action: "submit",
      kind: "modal",
      guildOnly: true,
      async handle({ interaction, payload, locale }) {
        if (!interaction.guildId) return;
        const svc = await service(interaction.guildId);
        // panelForm also re-checks that the form is still open, so a form
        // closed while the modal was open cannot accept a late answer.
        const form = await svc.panelForm(interaction.guildId, payload);
        const values = interaction.fields ?? {};
        // Check required answers before the service so the refusal is localized;
        // `FormService.submit` remains the final validator and the only writer.
        const missing = form.fields
          .filter((field) => field.required && !values[field.key]?.trim())
          .map((field) => field.key);
        if (missing.length > 0) {
          throw new UserError(t(locale, "form.errors.missing", missing.join(", ")));
        }
        const submission = await svc.submit(
          interaction.guildId,
          interaction.userId,
          form.key,
          modalAnswers(form, values),
        );
        await interaction.reply({
          content: t(
            locale,
            "form.submit.received",
            submission.id,
            Object.keys(submission.answers).length,
          ),
          ephemeral: true,
        });
      },
    })
    .register({
      namespace: "form",
      action: "review",
      kind: "button",
      guildOnly: true,
      permissions: ["ManageGuild"],
      async handle({ interaction, payload, locale }) {
        if (!interaction.guildId) return;
        const svc = await service(interaction.guildId);
        const pending = await svc.pending(interaction.guildId, payload);
        if (pending.length === 0) {
          await interaction.reply({
            content: t(locale, "form.review.empty", payload),
            ephemeral: true,
          });
          return;
        }
        const lines = pending
          .slice(0, 10)
          .map(({ submission, form }) =>
            t(
              locale,
              "form.review.row",
              submission.id.slice(0, 8),
              form.key,
              submission.userId,
              Object.keys(submission.answers).length,
            ),
          );
        await interaction.reply({
          content: t(locale, "form.review.pending", pending.length, payload, lines.join("\n")),
          ephemeral: true,
        });
      },
    })
    .register({
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
        const settings = communitySettingsSchema.parse(
          await deps.community.settings.get(interaction.guildId),
        );
        const ticket = await new TicketService(
          deps.community.store,
          deps.community.actions,
          settings,
          now,
        ).open(
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
}

function isModerationButton(customId: string): boolean {
  return customId.startsWith("keystone:appeal:") || customId.startsWith("keystone:verify:");
}

/**
 * One gateway listener for every component kind. Moderation's existing button
 * ids predate the signed format, so they are handed to their own handler; every
 * new panel goes through the router, which checks the signature, the expiry,
 * the guild and the route's permission before any handler runs.
 */
export function registerComponentInteractions(client: Client, deps: ComponentRuntimeDeps): void {
  const router = createComponentRouter(deps);

  client.on(Events.InteractionCreate, (interaction) => {
    if (
      !interaction.isButton() &&
      !interaction.isStringSelectMenu() &&
      !interaction.isModalSubmit()
    ) {
      return;
    }
    const like: ComponentInteractionLike = asComponentInteraction(interaction);

    void (async () => {
      if (like.kind === "button" && isModerationButton(like.customId)) {
        await handleModerationButton(like, deps.moderation);
        return;
      }
      const locale = like.guildId
        ? await guildLocale(deps.config, like.guildId)
        : DEFAULT_LOCALE;
      await router.dispatch(like, deps.signer, deps.now?.() ?? Date.now(), {
        locale,
        messages: {
          expired: t(locale, "component.expired"),
          noPermission: t(locale, "component.noPermission"),
          guildOnly: t(locale, "component.guildOnly"),
        },
      });
    })().catch((error: unknown) => {
      deps.logger.error("component interaction failed", {
        kind: like.kind,
        error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      });
    });
  });
}
