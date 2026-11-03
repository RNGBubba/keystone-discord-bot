import { describe, expect, it } from "vitest";
import { LayoutError, modal } from "./index";

describe("modal", () => {
  it("builds typed text inputs inside the Discord limits", () => {
    const spec = modal({ customId: "form_submit", title: "Staff application" }, (m) => {
      m.input({ customId: "why", label: "Why do you want to help?", style: "paragraph" });
      m.input({
        customId: "timezone",
        label: "Timezone",
        style: "short",
        required: true,
        minLength: 2,
        maxLength: 40,
      });
    });

    expect(spec).toEqual({
      customId: "form_submit",
      title: "Staff application",
      components: [
        {
          type: "text-input",
          customId: "why",
          label: "Why do you want to help?",
          style: "paragraph",
          minLength: 0,
          maxLength: 4_000,
        },
        {
          type: "text-input",
          customId: "timezone",
          label: "Timezone",
          style: "short",
          required: true,
          minLength: 2,
          maxLength: 40,
        },
      ],
    });
  });

  it("refuses a sixth input", () => {
    expect(() =>
      modal({ customId: "form_submit", title: "Too many" }, (m) => {
        for (let index = 0; index < 6; index += 1) {
          m.input({ customId: `field${index}`, label: `Field ${index}`, style: "short" });
        }
      }),
    ).toThrow(/1-5 text inputs/);
  });

  it("refuses a title or label that Discord would truncate", () => {
    expect(() =>
      modal({ customId: "form_submit", title: "x".repeat(46) }, (m) => {
        m.input({ customId: "a", label: "A", style: "short" });
      }),
    ).toThrow(/modal title is 1-45/);

    expect(() =>
      modal({ customId: "form_submit", title: "Fine" }, (m) => {
        m.input({ customId: "a", label: "l".repeat(46), style: "short" });
      }),
    ).toThrow(/input label is 1-45/);
  });

  it("refuses an empty modal, a malformed id and an inverted length range", () => {
    expect(() => modal({ customId: "form_submit", title: "Empty" }, () => undefined)).toThrow(
      LayoutError,
    );
    expect(() =>
      modal({ customId: "Form Submit", title: "Bad id" }, (m) => {
        m.input({ customId: "a", label: "A", style: "short" });
      }),
    ).toThrow(/letters, digits/);
    expect(() =>
      modal({ customId: "form_submit", title: "Range" }, (m) => {
        m.input({ customId: "a", label: "A", style: "short", minLength: 10, maxLength: 5 });
      }),
    ).toThrow(/0 <= minLength <= maxLength/);
  });
});
