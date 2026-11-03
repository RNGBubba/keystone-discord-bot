import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FALLBACK_MESSAGE, en, lookupMessage, resolveMessage } from "@keystone/i18n";
import { modules } from "@keystone/module-catalog";
import { buildCommandJson } from "./adapt";

interface CommandNode {
  readonly name: string;
  readonly description?: string;
  readonly type?: number;
  readonly description_localizations?: Record<string, string>;
  readonly options?: readonly CommandNode[];
}

function walk(node: CommandNode, path: string): void {
  for (const option of node.options ?? []) {
    expect(
      option.description_localizations?.de,
      `${path} ${option.name} has no German description`,
    ).toBeTruthy();
    if (option.type === 1 || option.type === 2) walk(option, `${path} ${option.name}`);
  }
}

const chatInput = modules
  .flatMap((module) => module.commands)
  .filter((command) => (command.type ?? "chat-input") === "chat-input");

/** Every description key the live registry implies. */
function registryKeys(): Set<string> {
  const keys = new Set<string>();
  for (const command of chatInput) {
    keys.add(`command.${command.name}.description`);
    for (const option of command.options ?? []) {
      keys.add(`command.${command.name}.option.${option.name}.description`);
    }
    for (const subcommand of command.subcommands ?? []) {
      keys.add(`command.${command.name}.${subcommand.name}.description`);
      for (const option of subcommand.options ?? []) {
        keys.add(`command.${command.name}.option.${option.name}.description`);
      }
    }
  }
  return keys;
}

describe("command description localization", () => {
  it("gives every registered root, subcommand and option a German description", () => {
    for (const command of chatInput) {
      const json = buildCommandJson(command) as unknown as CommandNode;
      expect(
        json.description_localizations?.de,
        `/${command.name} has no German root description`,
      ).toBeTruthy();
      walk(json, `/${command.name}`);
    }
  });

  it("does not reuse the English sentence as the German description", () => {
    for (const command of chatInput) {
      const json = buildCommandJson(command) as unknown as CommandNode;
      const nodes: CommandNode[] = [json, ...(json.options ?? [])];
      for (const node of nodes) {
        if (node.description_localizations?.de) {
          expect(node.description_localizations.de).not.toBe(node.description);
        }
      }
    }
  });

  it("resolves every catalog command key in German without falling back", () => {
    for (const key of registryKeys()) {
      const german = lookupMessage("de", key);
      expect(german, `${key} is missing from the German catalog`).toBeTruthy();
      expect(german).not.toBe(lookupMessage("en", key));
    }
  });

  it("has no catalog key for a command or option the registry does not expose", () => {
    const expected = registryKeys();
    for (const key of Object.keys(en)) {
      if (!key.startsWith("command.")) continue;
      expect(expected.has(key), `${key} no longer names a registered command`).toBe(true);
    }
  });
});

/**
 * Command files whose replies are translated. A file added to either command
 * directory must join this map or the English-only map below, so the next
 * command cannot quietly ship English-only: the test fails until someone
 * decides on purpose.
 */
const COVERED = new Map([
  ["modules/diagnostics/src/commands/about.ts", "brand card and settings read"],
  ["modules/diagnostics/src/commands/help.ts", "catalog, search, privacy and changelog"],
  ["modules/diagnostics/src/commands/ping.ts", "uptime reply"],
  ["modules/community/src/commands/rank.ts", "levels, economy and seasons"],
  ["modules/community/src/commands/rank-card.ts", "user context menu"],
  ["modules/community/src/commands/ticket.ts", "panel, open, claim, close and stats"],
]);

const ENGLISH_ONLY = new Map([
  [
    "modules/community/src/commands/tools.ts",
    "admin configuration replies; the journal names this remainder",
  ],
  [
    "modules/community/src/commands/helpers.ts",
    "shared helper refusals; service-not-wired copy, not a command flow",
  ],
]);

const UNTRANSLATED_LITERAL = /(?:content|title):\s*["'`]|UserError\(\s*["'`]/;

for (const directory of ["modules/diagnostics/src/commands", "modules/community/src/commands"]) {
  const files = readdirSync(join(process.cwd(), directory))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => `${directory}/${name}`);

  describe(`reply copy in ${directory}`, () => {
    it("classifies every command file as translated or deliberately English", () => {
      for (const file of files) {
        expect(
          COVERED.has(file) || ENGLISH_ONLY.has(file),
          `${file} is neither translated nor named as English-only`,
        ).toBe(true);
      }
    });

    it("has no untranslated reply in a translated file", () => {
      for (const file of files) {
        if (!COVERED.has(file)) continue;
        const lines = readFileSync(join(process.cwd(), file), "utf8").split("\n");
        const untranslated = lines
          .map((line, index) => ({ line, number: index + 1, previous: lines[index - 1] ?? "" }))
          .filter(({ line, previous }) => !`${previous}${line}`.includes("i18n-exempt"))
          .filter(({ line }) => UNTRANSLATED_LITERAL.test(line))
          .map(({ line, number }) => `${file}:${number} ${line.trim()}`);
        expect(untranslated, `${file} still ships English reply copy`).toEqual([]);
      }
    });
  });
}

describe("message fallback", () => {
  it("says a plain sentence for a key no locale defines, never the raw key", () => {
    expect(resolveMessage({ en }, "de", "definitely.not.a.key")).toBe(FALLBACK_MESSAGE);
  });

  it("falls back to English when the locale lacks the key", () => {
    const partial = { en: { "probe.onlyEnglish": () => "English only." } };
    expect(resolveMessage(partial, "de", "probe.onlyEnglish")).toBe("English only.");
  });
});
