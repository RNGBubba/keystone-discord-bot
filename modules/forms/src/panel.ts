import type { FormDefinition, ModalSpec, V2Component } from "@keystone/kernel";
import { layout, modal } from "@keystone/ui";

/**
 * A Discord modal holds five text inputs. A form with more questions keeps its
 * command path (`/form submit`) instead of silently dropping the extras.
 */
export const MAX_MODAL_FIELDS = 5;
/** Long enough to answer, short enough that a stale panel cannot be replayed. */
export const FORM_MODAL_TTL_MS = 15 * 60_000;

export interface FormPanelActions {
  /** Signed id for the Apply button. */
  readonly apply: string;
  /** Signed id for the staff review button. */
  readonly review: string;
}

/**
 * The public application panel. The module owns the copy and the shape; the
 * bot owns the signed ids because only it has the signing secret.
 */
export function formPanel(form: FormDefinition, actions: FormPanelActions): V2Component[] {
  const questions = form.fields.map((field) => `**${field.label}**`).join("\n");
  return layout((ui) => {
    ui.container({ accentColor: 0x5865f2 }, (box) => {
      box.text(`## ${form.name}`);
      box.text(
        form.description ||
          `Applications for **${form.name}** are open. Staff review every submission.`,
      );
      box.separator();
      box.text(`**Questions**\n${questions}`);
      box.text(
        form.fields.length <= MAX_MODAL_FIELDS
          ? "Press **Apply** to answer in a form. One pending application per member."
          : `This form has ${form.fields.length} questions; Discord modals hold ${MAX_MODAL_FIELDS}. Use \`/form submit form:${form.key}\` instead.`,
      );
      box.actions([ui.button({ style: "primary", label: "Apply", customId: actions.apply })]);
      box.actions([
        ui.button({ style: "secondary", label: "Review submissions", customId: actions.review }),
      ]);
      box.text("Answers are stored in this server and read only by staff.");
    });
  });
}

/**
 * One Label per question, keyed by the field's stable key so the modal values
 * parse with the same `parseAnswers` the command path uses.
 */
export function formModal(form: FormDefinition, customId: string): ModalSpec {
  if (form.fields.length === 0) throw new Error(`form "${form.key}" has no fields`);
  if (form.fields.length > MAX_MODAL_FIELDS) {
    throw new Error(`form "${form.key}" has ${form.fields.length} fields; a modal holds ${MAX_MODAL_FIELDS}`);
  }
  return modal({ customId, title: form.name.slice(0, 45) }, (m) => {
    for (const field of form.fields) {
      m.input({
        customId: field.key,
        // Discord's label limit is 45; the key, not the label, is the answer id.
        label: field.label.slice(0, 45),
        style: "paragraph",
        required: field.required,
        maxLength: Math.min(field.maxLength, 4_000),
      });
    }
  });
}

/**
 * Turn modal values into the `key=value; key=value` form `FormService.submit`
 * already validates. Values are trimmed once here so a whitespace-only answer
 * is the same as an empty one on both input paths.
 */
export function modalAnswers(
  form: FormDefinition,
  fields: Readonly<Record<string, string>>,
): string {
  return form.fields
    .flatMap((field) => {
      const value = fields[field.key]?.trim();
      return value ? [`${field.key}=${value}`] : [];
    })
    .join("; ");
}

/** True when the panel's Apply button can open a modal at all. */
export function modalFits(form: FormDefinition): boolean {
  return form.fields.length > 0 && form.fields.length <= MAX_MODAL_FIELDS;
}
