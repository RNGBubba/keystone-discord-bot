import type { ModalSpec, ModalTextInput } from "@keystone/kernel";
import { LayoutError } from "./layout";

export const MAX_MODAL_INPUTS = 5;
export const MAX_MODAL_TITLE = 45;
export const MAX_MODAL_LABEL = 45;
export const MAX_MODAL_TEXT = 4_000;

export interface ModalBuilder {
  input(input: {
    customId: string;
    label: string;
    style: "short" | "paragraph";
    placeholder?: string;
    value?: string;
    required?: boolean;
    minLength?: number;
    maxLength?: number;
  }): void;
}

/**
 * Build a modal from typed text inputs. Discord shows each input inside a
 * Label, caps a modal at five rows and a 45-character title; a shape that
 * would be rejected at submit time fails here instead.
 */
export function modal(
  input: { customId: string; title: string },
  build: (modal: ModalBuilder) => void,
): ModalSpec {
  // Signed ids are mixed-case base64url with colons, so the rule is Discord's:
  // one to 100 characters with no whitespace.
  if (!/^[A-Za-z0-9:_-]{1,100}$/.test(input.customId)) {
    throw new LayoutError(
      `a modal custom id is 1-100 letters, digits, _ or -; got ${JSON.stringify(input.customId)}`,
    );
  }
  if (input.title.length < 1 || input.title.length > MAX_MODAL_TITLE) {
    throw new LayoutError(
      `a modal title is 1-${MAX_MODAL_TITLE} characters; got ${JSON.stringify(input.title)}`,
    );
  }

  const components: ModalTextInput[] = [];
  build({
    input(spec) {
      if (spec.customId.length < 1 || spec.customId.length > 100) {
        throw new LayoutError(`a modal input custom id is 1-100 characters: ${spec.label}`);
      }
      if (spec.label.length < 1 || spec.label.length > MAX_MODAL_LABEL) {
        throw new LayoutError(
          `a modal input label is 1-${MAX_MODAL_LABEL} characters; got ${JSON.stringify(spec.label)}`,
        );
      }
      if (spec.style !== "short" && spec.style !== "paragraph") {
        throw new LayoutError(`a modal input style is short or paragraph: ${spec.label}`);
      }
      const minLength = spec.minLength ?? 0;
      const maxLength = spec.maxLength ?? MAX_MODAL_TEXT;
      if (
        !Number.isInteger(minLength) ||
        !Number.isInteger(maxLength) ||
        minLength < 0 ||
        maxLength > MAX_MODAL_TEXT ||
        minLength > maxLength
      ) {
        throw new LayoutError(
          `a modal input needs 0 <= minLength <= maxLength <= ${MAX_MODAL_TEXT}: ${spec.label}`,
        );
      }
      components.push({
        type: "text-input",
        customId: spec.customId,
        label: spec.label,
        style: spec.style,
        ...(spec.placeholder ? { placeholder: spec.placeholder } : {}),
        ...(spec.value ? { value: spec.value } : {}),
        ...(spec.required === undefined ? {} : { required: spec.required }),
        minLength,
        maxLength,
      });
    },
  });

  if (components.length === 0 || components.length > MAX_MODAL_INPUTS) {
    throw new LayoutError(
      `a modal holds 1-${MAX_MODAL_INPUTS} text inputs; got ${components.length}`,
    );
  }
  return { customId: input.customId, title: input.title, components };
}
