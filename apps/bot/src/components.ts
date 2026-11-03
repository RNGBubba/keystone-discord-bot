import { Events, type Client } from "discord.js";
import {
  ComponentRouter,
  UserError,
  type ComponentInteractionLike,
  type ComponentSigner,
  type FormStore,
  type Logger,
  type ModerationPort,
  type ModuleSettings,
} from "@keystone/kernel";
import {
  FORM_MODAL_TTL_MS,
  FormService,
  formModal,
  formSettingsSchema,
  modalAnswers,
  modalFits,
} from "@keystone/module-forms";
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
  readonly logger: Logger;
  /** Injectable clock so id expiry and submission timestamps are deterministic. */
  readonly now?: () => number;
}

/**
 * The form panel routes. The module owns the copy, the modal shape and the
 * submission rules; this file only connects an interaction to them, so the
 * command path and the button path end in the same FormService call.
 */
export function createFormRouter(deps: ComponentRuntimeDeps): ComponentRouter {
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
      async handle({ interaction, payload, now: current }) {
        if (!interaction.guildId) return;
        if (!interaction.showModal) {
          throw new UserError("This client cannot open a form. Run `/form submit` instead.");
        }
        const svc = await service(interaction.guildId);
        const form = await svc.panelForm(interaction.guildId, payload);
        if (!modalFits(form)) {
          await interaction.reply({
            content: `This form has ${form.fields.length} questions and a Discord modal holds five. Submit with \`/form submit form:${form.key} answers:"${form.fields.map((field) => `${field.key}=...`).join("; ")}"\`.`,
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
      async handle({ interaction, payload }) {
        if (!interaction.guildId) return;
        const svc = await service(interaction.guildId);
        // panelForm also re-checks that the form is still open, so a form
        // closed while the modal was open cannot accept a late answer.
        const form = await svc.panelForm(interaction.guildId, payload);
        const submission = await svc.submit(
          interaction.guildId,
          interaction.userId,
          form.key,
          modalAnswers(form, interaction.fields ?? {}),
        );
        await interaction.reply({
          content: `Submission received · \`${submission.id}\` · ${Object.keys(submission.answers).length} answers. Staff will review it; do not submit again while it is pending.`,
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
      async handle({ interaction, payload }) {
        if (!interaction.guildId) return;
        const svc = await service(interaction.guildId);
        const pending = await svc.pending(interaction.guildId, payload);
        if (pending.length === 0) {
          await interaction.reply({
            content: `No pending applications for \`${payload}\`. Review closed ones with \`/form review\`.`,
            ephemeral: true,
          });
          return;
        }
        const lines = pending
          .slice(0, 10)
          .map(
            ({ submission, form }) =>
              `\`${submission.id.slice(0, 8)}\` · ${form.key} · <@${submission.userId}> · ${Object.keys(submission.answers).length} answers`,
          );
        await interaction.reply({
          content: `${pending.length} pending application${pending.length === 1 ? "" : "s"} for \`${payload}\`:\n${lines.join("\n")}\nDecide with \`/form review submission:<id> decision:accept|deny\`.`,
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
  const router = createFormRouter(deps);

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
      await router.dispatch(like, deps.signer, deps.now?.() ?? Date.now());
    })().catch((error: unknown) => {
      deps.logger.error("component interaction failed", {
        kind: like.kind,
        error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      });
    });
  });
}
