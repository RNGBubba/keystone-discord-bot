import {
  UserError,
  type ComponentRouter,
  type ComponentSigner,
  type FormStore,
  type ModuleSettings,
} from "@keystone/kernel";
import { t } from "@keystone/i18n";
import {
  FORM_MODAL_TTL_MS,
  FormService,
  formModal,
  formSettingsSchema,
  modalAnswers,
  modalFits,
} from "@keystone/module-forms";

/** The form module's store, settings and signer, wired by the composition root. */
export interface FormRouteDeps {
  readonly forms: FormStore;
  readonly settings: ModuleSettings;
  readonly signer: ComponentSigner;
  /** Injectable clock so modal expiry and submission timestamps stay deterministic. */
  readonly now?: () => number;
}

/**
 * The form panel's three routes: open the modal, accept its answers and list the
 * staff queue. The module owns the schema, the modal shape and the write rules;
 * this adapter only connects a routed interaction to the same `FormService` the
 * commands use.
 */
export function registerFormRoutes(router: ComponentRouter, deps: FormRouteDeps): ComponentRouter {
  const now = (): number => deps.now?.() ?? Date.now();

  const service = async (guildId: string): Promise<FormService> => {
    const settings = formSettingsSchema.parse(await deps.settings.get(guildId));
    return new FormService(deps.forms, settings, now);
  };

  return router
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
    });
}
