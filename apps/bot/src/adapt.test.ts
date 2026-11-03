import { describe, expect, it } from "vitest";
import type { ButtonInteraction, ChatInputCommandInteraction, ModalSubmitInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import { defineCommand, type ModalSpec, type V2Component } from "@keystone/kernel";
import { layout } from "@keystone/ui";
import {
  asComponentInteraction,
  asInteractionLike,
  buildApplicationCommandJson,
  buildCommandJson,
  buildContextMenuJson,
  toModalBuilder,
  toReplyOptions,
} from "./adapt";

interface JsonOption {
  name: string;
  type: number;
  options?: JsonOption[];
}

function optionsOf(json: ReturnType<typeof buildCommandJson>): JsonOption[] {
  return (json.options ?? []) as JsonOption[];
}

const noop = async () => undefined;

describe("buildCommandJson", () => {
  it("emits direct subcommands instead of a flat action option", () => {
    const json = buildCommandJson(
      defineCommand({
        name: "mod",
        description: "Moderation",
        subcommands: [
          {
            name: "ban",
            description: "Ban a member",
            options: [
              { type: "user", name: "user", description: "Member", required: true },
              { type: "string", name: "reason", description: "Reason", required: true },
            ],
          },
          { name: "history", description: "Show history" },
        ],
        execute: noop,
      }),
    );

    expect(optionsOf(json).map((option) => [option.name, option.type])).toEqual([
      ["ban", 1],
      ["history", 1],
    ]);
    expect(optionsOf(json)[0]?.options?.map((option) => [option.name, option.type])).toEqual([
      ["user", 6],
      ["reason", 3],
    ]);
  });

  it("emits a subcommand group with its own subcommands", () => {
    const json = buildCommandJson(
      defineCommand({
        name: "case",
        description: "Case commands",
        groups: [
          {
            name: "view",
            description: "View cases",
            subcommands: [
              { name: "one", description: "One case" },
              { name: "list", description: "List cases" },
            ],
          },
        ],
        execute: noop,
      }),
    );

    expect(optionsOf(json)[0]).toMatchObject({ name: "view", type: 2 });
    expect(optionsOf(json)[0]?.options?.map((option) => option.name)).toEqual(["one", "list"]);
  });

  it("emits an attachment option with Discord's attachment type", () => {
    const json = buildCommandJson(
      defineCommand({
        name: "export",
        description: "Export",
        subcommands: [
          {
            name: "import",
            description: "Import a bundle",
            options: [{ type: "attachment", name: "bundle", description: "Bundle", required: true }],
          },
        ],
        execute: noop,
      }),
    );

    expect(optionsOf(json)[0]?.options?.map((option) => [option.name, option.type])).toEqual([
      ["bundle", 11],
    ]);
  });

  it("keeps flat options for a root-only command", () => {
    const json = buildCommandJson(
      defineCommand({
        name: "ping",
        description: "Ping",
        options: [{ type: "boolean", name: "detailed", description: "More detail" }],
        execute: noop,
      }),
    );

    expect(optionsOf(json)).toEqual([
      expect.objectContaining({ name: "detailed", type: 5 }),
    ]);
  });

  it("emits no options for a command with none", () => {
    const json = buildCommandJson(
      defineCommand({ name: "about", description: "About", execute: noop }),
    );
    expect(json.options).toEqual([]);
  });
});

describe("context-menu payloads", () => {
  it("emits type 2 and type 3 without a description", () => {
    const user = buildApplicationCommandJson(
      defineCommand({
        name: "Rank card",
        description: "Show a rank card",
        type: "user",
        execute: noop,
      }),
    );
    const message = buildContextMenuJson(
      defineCommand({
        name: "Report message",
        description: "Report a message",
        type: "message",
        execute: noop,
      }),
    );
    expect(user).toMatchObject({ name: "Rank card", type: 2 });
    expect(message).toMatchObject({ name: "Report message", type: 3 });
    expect("description" in user).toBe(false);
    expect("description" in message).toBe(false);
  });

  it("refuses to build a context payload for a chat-input definition", () => {
    expect(() =>
      buildContextMenuJson(
        defineCommand({ name: "ping", description: "Ping", execute: noop }),
      ),
    ).toThrow(/not a context-menu/);
  });
});

describe("asInteractionLike context menus", () => {
  it("exposes the selected user", () => {
    const interaction = {
      id: "interaction-1",
      commandName: "Rank card",
      guildId: "guild-1",
      channelId: "channel-1",
      user: { id: "viewer" },
      memberPermissions: { toArray: () => [] },
      isChatInputCommand: () => false,
      isUserContextMenuCommand: () => true,
      isMessageContextMenuCommand: () => false,
      targetId: "author-1",
      replied: false,
      deferred: false,
      reply: noop,
      deferReply: noop,
      editReply: noop,
      followUp: noop,
    } as unknown as Parameters<typeof asInteractionLike>[0];

    const like = asInteractionLike(interaction);
    expect(like.commandType).toBe("user");
    expect(like.targetId).toBe("author-1");
    expect(like.options).toEqual({});
  });

  it("exposes the message author and content", () => {
    const interaction = {
      id: "interaction-2",
      commandName: "Report message",
      guildId: "guild-1",
      channelId: "channel-1",
      user: { id: "reporter" },
      memberPermissions: { toArray: () => [] },
      isChatInputCommand: () => false,
      isUserContextMenuCommand: () => false,
      isMessageContextMenuCommand: () => true,
      targetId: "message-1",
      targetMessage: { author: { id: "author-1" }, content: "spam" },
      replied: false,
      deferred: false,
      reply: noop,
      deferReply: noop,
      editReply: noop,
      followUp: noop,
    } as unknown as Parameters<typeof asInteractionLike>[0];

    const like = asInteractionLike(interaction);
    expect(like.commandType).toBe("message");
    expect(like.targetId).toBe("message-1");
    expect(like.targetUserId).toBe("author-1");
    expect(like.targetContent).toBe("spam");
  });
});

describe("asInteractionLike", () => {
  it("flattens a subcommand's nested options into the structural map", () => {
    const interaction = {
      id: "interaction-1",
      commandName: "mod",
      guildId: "guild-1",
      channelId: "channel-1",
      user: { id: "user-1" },
      memberPermissions: { toArray: () => ["BanMembers"] },
      isChatInputCommand: () => true,
      options: {
        data: [
          {
            name: "ban",
            type: 1,
            options: [
              { name: "user", type: 6, value: "target-1" },
              { name: "reason", type: 3, value: "spam" },
            ],
          },
        ],
        getSubcommand: () => "ban",
        getSubcommandGroup: () => null,
      },
      replied: false,
      deferred: false,
      reply: noop,
      deferReply: noop,
      editReply: noop,
      followUp: noop,
    } as unknown as ChatInputCommandInteraction;

    const like = asInteractionLike(interaction);

    expect(like.options).toEqual({ user: "target-1", reason: "spam" });
    expect(like.subcommand).toBe("ban");
    expect(like.permissions).toEqual(["BanMembers"]);
  });

  it("keeps an attachment's CDN URL and uploads a reply file", async () => {
    const captured: Array<{ files?: Array<{ name: string }> }> = [];
    const url = "https://cdn.discordapp.com/attachments/1/2/bundle.json";
    const interaction = {
      id: "interaction-2",
      commandName: "export",
      guildId: "guild-1",
      channelId: "channel-1",
      user: { id: "user-1" },
      memberPermissions: { toArray: () => ["ManageGuild"] },
      isChatInputCommand: () => true,
      options: {
        data: [
          {
            name: "import",
            type: 1,
            options: [{ name: "bundle", type: 11, attachment: { url } }],
          },
        ],
        getSubcommand: () => "import",
        getSubcommandGroup: () => null,
      },
      replied: false,
      deferred: false,
      reply: async (options: { files?: Array<{ name: string }> }) => {
        captured.push(options);
      },
      deferReply: noop,
      editReply: noop,
      followUp: noop,
    } as unknown as ChatInputCommandInteraction;

    const like = asInteractionLike(interaction);
    expect(like.options.bundle).toBe(url);

    await like.reply({
      content: "bundle",
      files: [{ name: "keystone.json", content: "{}" }],
    });
    expect(captured[0]?.files?.[0]?.name).toBe("keystone.json");
  });
});

describe("Components V2 adapter", () => {
  const panel: V2Component[] = layout((ui) => {
    ui.container({ accentColor: 0x5865f2 }, (box) => {
      box.text("## Form");
      box.separator();
      box.actions([ui.button({ style: "primary", label: "Apply", customId: "k1:x:y:form:apply:staff" })]);
    });
  });

  it("marks a v2 reply and drops content and embeds instead of sending both", () => {
    const options = toReplyOptions({ content: "ignored", embeds: [{ title: "ignored" }], v2: panel });
    expect(options.flags).toBe(MessageFlags.IsComponentsV2);
    expect(options.content).toBeUndefined();
    expect(options.embeds).toBeUndefined();
    expect(options.components).toHaveLength(1);
    expect((options.components?.[0] as unknown as { toJSON(): unknown }).toJSON()).toMatchObject({
      type: 17,
      accent_color: 0x5865f2,
      components: [
        { type: 10, content: "## Form" },
        { type: 14 },
        { type: 1, components: [{ type: 2, style: 1, label: "Apply" }] },
      ],
    });
  });

  it("turns a modal spec into Label-wrapped text inputs", () => {
    const spec: ModalSpec = {
      customId: "form-submit-staff",
      title: "Staff application",
      components: [
        {
          type: "text-input",
          customId: "why",
          label: "Why join",
          style: "paragraph",
          required: true,
          minLength: 0,
          maxLength: 500,
        },
      ],
    };
    const json = toModalBuilder(spec).toJSON();
    expect(json).toMatchObject({
      title: "Staff application",
      custom_id: "form-submit-staff",
      components: [
        {
          type: 18,
          label: "Why join",
          component: { type: 4, custom_id: "why", style: 2, required: true, max_length: 500 },
        },
      ],
    });
  });

  it("adapts a button and opens the modal through showModal", async () => {
    let shown: { custom_id?: string } | undefined;
    const interaction = {
      customId: "k1:abc:def:form:apply:staff",
      guildId: "guild-1",
      channelId: "channel-1",
      user: { id: "user-1" },
      memberPermissions: { toArray: () => ["ManageGuild"] },
      replied: false,
      deferred: false,
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      reply: noop,
      update: noop,
      deferReply: noop,
      editReply: noop,
      followUp: noop,
      showModal: async (modal: unknown) => {
        shown = (modal as { toJSON: () => { custom_id?: string } }).toJSON();
      },
    } as unknown as ButtonInteraction;

    const like = asComponentInteraction(interaction);
    expect(like).toMatchObject({
      kind: "button",
      customId: "k1:abc:def:form:apply:staff",
      userId: "user-1",
      permissions: ["ManageGuild"],
    });
    await like.showModal?.({
      customId: "form-submit-staff",
      title: "Staff",
      components: [
        { type: "text-input", customId: "why", label: "Why join", style: "short", required: true },
      ],
    });
    expect(shown?.custom_id).toBe("form-submit-staff");
  });

  it("maps a modal submit's fields by input custom id", async () => {
    const interaction = {
      customId: "form-submit-staff",
      guildId: "guild-1",
      channelId: "channel-1",
      user: { id: "user-1" },
      memberPermissions: null,
      replied: false,
      deferred: false,
      isButton: () => false,
      isStringSelectMenu: () => false,
      isModalSubmit: () => true,
      fields: {
        fields: new Map([
          ["why", { value: "I like helping" }],
          ["tz", { value: "UTC+2" }],
        ]),
      },
      reply: noop,
      update: noop,
      deferReply: noop,
      editReply: noop,
      followUp: noop,
    } as unknown as ModalSubmitInteraction;

    const like = asComponentInteraction(interaction);
    expect(like.kind).toBe("modal");
    expect(like.fields).toEqual({ why: "I like helping", tz: "UTC+2" });
  });
});
