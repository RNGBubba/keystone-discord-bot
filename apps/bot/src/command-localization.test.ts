import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FALLBACK_MESSAGE, en, lookupMessage, resolveMessage } from "@keystone/i18n";
import { modules } from "@keystone/module-catalog";
import { buildCommandJson } from "./adapt";

interface JsonNode {
  readonly name: string;
  readonly description?: string;
  readonly type?: number;
  readonly description_localizations?: Record<string, string>;
  readonly options?: readonly JsonNode[];
}

const chatInput = modules
  .flatMap((module) => module.commands)
  .filter((command) => (command.type ?? "chat-input") === "chat-input");

interface OptionUsage {
  readonly root: string;
  readonly subcommand?: string;
  readonly name: string;
  readonly description: string;
  readonly genericKey: string;
  readonly specificKey: string;
}

/**
 * Every option declaration, with both candidate keys. The adapter prefers the
 * subcommand key and falls back to the root key, so the test reasons the same
 * way and the catalog cannot describe one subcommand with another's text.
 */
function optionUsages(): OptionUsage[] {
  const usages: OptionUsage[] = [];
  for (const command of chatInput) {
    const generic = (name: string) => `command.${command.name}.option.${name}.description`;
    const specific = (subcommand: string | undefined, name: string) =>
      `command.${command.name}.${subcommand}.option.${name}.description`;
    for (const option of command.options ?? []) {
      usages.push({
        root: command.name,
        name: option.name,
        description: option.description,
        genericKey: generic(option.name),
        specificKey: specific(undefined, option.name),
      });
    }
    for (const subcommand of command.subcommands ?? []) {
      for (const option of subcommand.options ?? []) {
        usages.push({
          root: command.name,
          subcommand: subcommand.name,
          name: option.name,
          description: option.description,
          genericKey: generic(option.name),
          specificKey: specific(subcommand.name, option.name),
        });
      }
    }
  }
  return usages;
}

/**
 * The exact key set the registry implies. A shared root-level key is used only
 * while every declaration of that option carries the same sentence; as soon as
 * siblings differ, each declaration needs its own key.
 */
function expectedKeys(): Map<string, string> {
  const expected = new Map<string, string>();
  const add = (key: string, text: string): void => {
    const existing = expected.get(key);
    if (existing !== undefined && existing !== text) {
      throw new Error(`${key} would need two different descriptions`);
    }
    expected.set(key, text);
  };

  for (const command of chatInput) {
    add(`command.${command.name}.description`, command.description);
    for (const subcommand of command.subcommands ?? []) {
      add(`command.${command.name}.${subcommand.name}.description`, subcommand.description);
    }
  }

  const groups = new Map<string, OptionUsage[]>();
  for (const usage of optionUsages()) {
    const list = groups.get(usage.genericKey) ?? [];
    list.push(usage);
    groups.set(usage.genericKey, list);
  }

  for (const [genericKey, usages] of groups) {
    const descriptions = new Set(usages.map((usage) => usage.description));
    const first = usages[0];
    if (!first) continue;
    if (descriptions.size === 1) {
      add(genericKey, first.description);
      continue;
    }
    for (const usage of usages) {
      if (usage.subcommand === undefined) {
        throw new Error(
          `${usage.root} declares a root-level ${usage.name} that differs from a subcommand; it needs a root-specific key`,
        );
      }
      add(usage.specificKey, usage.description);
    }
  }
  return expected;
}

describe("command description keys", () => {
  it("keeps English in the registry and out of the catalog", () => {
    // The English sentence is the command definition, so there is no second
    // copy to drift. German is the only catalog side of this contract.
    for (const key of Object.keys(en)) {
      expect(key.startsWith("command."), `${key} duplicates a command definition`).toBe(false);
    }
    expect(expectedKeys().size).toBeGreaterThan(0);
  });

  it("gives every key hand-written German that is not the English sentence", () => {
    for (const [key, english] of expectedKeys()) {
      const german = lookupMessage("de", key);
      expect(german, `${key} is missing from the German catalog`).toBeTruthy();
      expect(german).not.toBe(english);
    }
  });

  it("puts the right German on each subcommand's option node", () => {
    // The three options whose siblings describe them differently: the very
    // case a shared key could not express.
    for (const command of chatInput) {
      const json = buildCommandJson(command) as unknown as JsonNode;
      for (const subcommand of command.subcommands ?? []) {
        const node = (json.options ?? []).find(
          (entry) => entry.name === subcommand.name && entry.type === 1,
        );
        if (!node) continue;
        for (const option of subcommand.options ?? []) {
          const specificKey = `command.${command.name}.${subcommand.name}.option.${option.name}.description`;
          const genericKey = `command.${command.name}.option.${option.name}.description`;
          const expectedGerman =
            lookupMessage("de", specificKey) ?? lookupMessage("de", genericKey);
          const optionNode = (node.options ?? []).find(
            (entry) => entry.name === option.name && entry.type !== 1 && entry.type !== 2,
          );
          expect(
            optionNode?.description_localizations?.de,
            `/${command.name} ${subcommand.name} ${option.name} did not get its own German`,
          ).toBe(expectedGerman);
        }
      }
    }
  });
});

/**
 * Command files whose replies are translated. A file added anywhere under
 * `modules / * / src / commands` must join one of these maps, so the next
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
  ["modules/ai/src/commands/ai.ts", "AI administration replies"],
  ["modules/ai/src/commands/explain-message.ts", "message context menu"],
  ["modules/analytics/src/commands/analytics.ts", "analytics replies"],
  ["modules/community/src/commands/tools.ts", "operator configuration replies"],
  ["modules/community/src/commands/helpers.ts", "shared service-not-wired refusal"],
  ["modules/events/src/commands/event.ts", "event replies"],
  ["modules/forms/src/commands/form.ts", "form replies; the panel itself is translated"],
  ["modules/invites/src/commands/invites.ts", "invite replies"],
  ["modules/logging/src/commands/logging.ts", "logging replies"],
  ["modules/moderation/src/commands/appeal.ts", "appeal replies"],
  ["modules/moderation/src/commands/case-history.ts", "case history context menu"],
  ["modules/moderation/src/commands/mod.ts", "moderation replies"],
  ["modules/moderation/src/commands/report-message.ts", "report context menu"],
  ["modules/moderation/src/commands/verify.ts", "verification replies"],
  ["modules/modmail/src/commands/modmail.ts", "modmail replies"],
  ["modules/music/src/commands/music.ts", "music replies"],
  ["modules/setup/src/commands/config.ts", "operator configuration replies"],
  ["modules/setup/src/commands/export.ts", "portability replies"],
  ["modules/setup/src/commands/setup.ts", "operator setup replies"],
]);

function commandFiles(): string[] {
  const root = process.cwd();
  return readdirSync(join(root, "modules"))
    .map((name) => `modules/${name}/src/commands`)
    .filter((directory) => existsSync(join(root, directory)))
    .flatMap((directory) =>
      readdirSync(join(root, directory))
        .filter((name) => name.endsWith(".ts"))
        .map((name) => `${directory}/${name}`),
    );
}

const UNTRANSLATED_LITERAL = /(?:content|title):\s*["'`]|UserError\(\s*["'`]/;

describe("reply copy", () => {
  it("classifies every command file as translated or deliberately English", () => {
    const files = commandFiles();
    for (const file of files) {
      expect(
        COVERED.has(file) || ENGLISH_ONLY.has(file),
        `${file} is neither translated nor named as English-only`,
      ).toBe(true);
    }
    for (const file of [...COVERED.keys(), ...ENGLISH_ONLY.keys()]) {
      expect(files.includes(file), `${file} is classified but no longer exists`).toBe(true);
    }
  });

  it("has no untranslated reply in a translated file", () => {
    for (const file of COVERED.keys()) {
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

describe("message fallback", () => {
  it("says a plain sentence for a key no locale defines, never the raw key", () => {
    expect(resolveMessage({ en }, "de", "definitely.not.a.key")).toBe(FALLBACK_MESSAGE);
  });

  it("falls back to English when the locale lacks the key", () => {
    const partial = { en: { "probe.onlyEnglish": () => "English only." } };
    expect(resolveMessage(partial, "de", "probe.onlyEnglish")).toBe("English only.");
  });
});
