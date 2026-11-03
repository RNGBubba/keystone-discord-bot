import { describe, expect, it } from "vitest";
import { LayoutError, MAX_COMPONENTS, layout } from "./index";

describe("layout", () => {
  it("builds a container with text, a separator and an action row", () => {
    const components = layout((ui) => {
      ui.container({ accentColor: 0x5865f2 }, (box) => {
        box.text("# Staff application");
        box.separator({ spacing: "small" });
        box.actions([
          ui.button({
            style: "primary",
            label: "Apply",
            customId: "k1:abc:1:form:submit:abc",
          }),
          ui.button({ style: "link", label: "Rules", url: "https://example.com/rules" }),
        ]);
      });
    });

    expect(components).toEqual([
      {
        type: "container",
        accentColor: 0x5865f2,
        components: [
          { type: "text-display", content: "# Staff application" },
          { type: "separator", spacing: "small" },
          {
            type: "action-row",
            components: [
              {
                type: "button",
                style: "primary",
                label: "Apply",
                customId: "k1:abc:1:form:submit:abc",
              },
              {
                type: "button",
                style: "link",
                label: "Rules",
                url: "https://example.com/rules",
              },
            ],
          },
        ],
      },
    ]);
  });

  it("counts every component and refuses more than 40", () => {
    const fiveButtons = (ui: Parameters<Parameters<typeof layout>[0]>[0]): void => {
      ui.actions(
        Array.from({ length: 5 }, (_, index) =>
          ui.button({ style: "secondary", label: `B${index}`, customId: `b${index}` }),
        ),
      );
    };

    // Six rows: 6 action rows + 30 buttons = 36 components, inside the budget.
    const built = layout((ui) => {
      for (let index = 0; index < 6; index += 1) fiveButtons(ui);
    });
    expect(built).toHaveLength(6);

    // Seven rows: 42 components, over the 40-slot cap.
    expect(() =>
      layout((ui) => {
        for (let index = 0; index < 7; index += 1) fiveButtons(ui);
      }),
    ).toThrow(new RegExp(`at most ${MAX_COMPONENTS} components`));
  });

  it("refuses more than 4,000 characters of text in total", () => {
    expect(() =>
      layout((ui) => {
        ui.text("a".repeat(2_500));
        ui.text("b".repeat(2_500));
      }),
    ).toThrow(LayoutError);

    expect(() => layout((ui) => ui.text("a".repeat(4_001)))).toThrow(/at most 4000/);
  });

  it("requires a select to be alone in its action row", () => {
    const select = {
      customId: "pick",
      placeholder: "Pick one",
      options: [{ label: "One", value: "1" }],
    };

    const components = layout((ui) => ui.actions([ui.select(select)]));
    expect(components[0]).toMatchObject({
      type: "action-row",
      components: [{ type: "select", customId: "pick", minValues: 0, maxValues: 1 }],
    });

    expect(() =>
      layout((ui) =>
        ui.actions([
          ui.select(select),
          ui.button({ style: "primary", label: "Go", customId: "go" }),
        ]),
      ),
    ).toThrow(/select must be the only/);
  });

  it("enforces link-url and custom-id button rules", () => {
    expect(() => layout((ui) => ui.button({ style: "link", label: "Docs" }))).toThrow(
      /link button needs a url/,
    );
    expect(() =>
      layout((ui) => ui.button({ style: "link", label: "Docs", url: "https://x", customId: "x" })),
    ).toThrow(/cannot carry a custom id/);
    expect(() => layout((ui) => ui.button({ style: "primary", label: "Go" }))).toThrow(
      /custom id is 1-100/,
    );
    expect(() =>
      layout((ui) => ui.button({ style: "primary", label: "Go", customId: "go", url: "https://x" })),
    ).toThrow(/only a link button can carry a url/);
  });

  it("enforces the container child count", () => {
    expect(() => layout((ui) => ui.container({}, () => undefined))).toThrow(
      /at least one child/,
    );
    expect(() =>
      layout((ui) =>
        ui.container({}, (box) => {
          for (let index = 0; index < 11; index += 1) box.text(`line ${index}`);
        }),
      ),
    ).toThrow(/at most 10 children/);
  });

  it("refuses malformed section and thumbnail accessories", () => {
    expect(() =>
      layout((ui) => ui.section(["a", "b", "c", "d"])),
    ).toThrow(/section holds 1-3/);
    expect(() =>
      layout((ui) =>
        ui.section("Read the rules", {
          type: "button",
          style: "link",
          label: "Rules",
          url: "https://x",
        }),
      ),
    ).toThrow(/accessory button cannot be a link/);
    expect(() =>
      layout((ui) => ui.thumbnail({ url: "" })),
    ).toThrow(/thumbnail needs a url/);
  });
});
