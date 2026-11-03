import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ApplicationCommandType,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  ContextMenuCommandBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThumbnailBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type CommandInteractionOption,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  type InteractionUpdateOptions,
  type MessageContextMenuCommandInteraction,
  type ModalSubmitInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
  type RESTPostAPIContextMenuApplicationCommandsJSONBody,
  type StringSelectMenuInteraction,
  type TextInputComponent,
  type UserContextMenuCommandInteraction,
} from "discord.js";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, lookupMessage } from "@keystone/i18n";
import type {
  ActionRow,
  CommandDefinition,
  CommandOption,
  ComponentInteractionLike,
  InteractionLike,
  ModalSpec,
  ReplyInput,
  V2ActionComponent,
  V2Button,
  V2Component,
  V2Container,
  V2ContainerChild,
  V2Section,
  V2Select,
} from "@keystone/kernel";

/**
 * The only file in the repo allowed to know what a discord.js interaction looks
 * like. Everything downstream speaks `InteractionLike`, which is why every
 * command can be tested with a plain object.
 */
/**
 * Discord nests a subcommand's arguments inside the subcommand option. A
 * structural flat map is what the registry speaks, so walk the tree and keep
 * only leaf values: `{ user: "…", reason: "…" }`, not `{ ban: null }`.
 */
function flattenOptions(
  data: readonly CommandInteractionOption[],
): Record<string, string | number | boolean | null> {
  const flat: Record<string, string | number | boolean | null> = {};
  for (const option of data) {
    if (
      option.type === ApplicationCommandOptionType.Subcommand ||
      option.type === ApplicationCommandOptionType.SubcommandGroup
    ) {
      Object.assign(flat, flattenOptions(option.options ?? []));
    } else if (option.type === ApplicationCommandOptionType.Attachment) {
      // An attachment option carries an object, not a scalar. The command only
      // needs the CDN URL; `ctx.attachments` downloads and size-checks it.
      flat[option.name] = option.attachment?.url ?? null;
    } else {
      flat[option.name] = (option.value ?? null) as string | number | boolean | null;
    }
  }
  return flat;
}

type AnyCommandInteraction =
  | ChatInputCommandInteraction
  | UserContextMenuCommandInteraction
  | MessageContextMenuCommandInteraction;

/**
 * One structural adapter for all three application-command kinds. A context
 * menu has no options or subcommands; its target is exposed as `targetId` plus
 * the message author/content when Discord provides them.
 */
export function asInteractionLike(interaction: AnyCommandInteraction): InteractionLike {
  const base = {
    id: interaction.id,
    commandName: interaction.commandName,
    guildId: interaction.guildId,
    channelId: interaction.channelId ?? null,
    userId: interaction.user.id,
    permissions: interaction.memberPermissions ? interaction.memberPermissions.toArray() : [],
    get replied() {
      return interaction.replied;
    },
    get deferred() {
      return interaction.deferred;
    },
    reply: (input: ReplyInput) => interaction.reply(toReplyOptions(input)),
    deferReply: (input?: { ephemeral?: boolean }) => interaction.deferReply(input ?? {}),
    editReply: (input: ReplyInput) => interaction.editReply(toEditOptions(input)),
    followUp: (input: ReplyInput) => interaction.followUp(toReplyOptions(input)),
  };

  if (interaction.isChatInputCommand()) {
    return {
      ...base,
      commandType: "chat-input",
      options: flattenOptions(interaction.options.data),
      subcommand: interaction.options.getSubcommand(false) ?? undefined,
      subcommandGroup: interaction.options.getSubcommandGroup(false) ?? undefined,
    };
  }

  if (interaction.isUserContextMenuCommand()) {
    return {
      ...base,
      commandType: "user",
      options: {},
      targetId: interaction.targetId,
    };
  }

  return {
    ...base,
    commandType: "message",
    options: {},
    targetId: interaction.targetId,
    targetUserId: interaction.targetMessage.author.id,
    targetContent: interaction.targetMessage.content,
  };
}

/**
 * A context menu is only a name and a type to Discord; its description lives
 * in the registry for docs and is deliberately not sent.
 */
export function buildContextMenuJson(
  definition: CommandDefinition,
): RESTPostAPIContextMenuApplicationCommandsJSONBody {
  if (definition.type !== "user" && definition.type !== "message") {
    throw new Error(`"${definition.name}" is not a context-menu command`);
  }
  const type =
    definition.type === "user" ? ApplicationCommandType.User : ApplicationCommandType.Message;
  return new ContextMenuCommandBuilder().setName(definition.name).setType(type).toJSON();
}

/**
 * The registration payload chooses the right Discord shape from the definition.
 * Keeping the branch here means the sync script and the bot cannot disagree.
 */
export function buildApplicationCommandJson(
  definition: CommandDefinition,
): RESTPostAPIChatInputApplicationCommandsJSONBody | RESTPostAPIContextMenuApplicationCommandsJSONBody {
  return (definition.type ?? "chat-input") === "chat-input"
    ? buildCommandJson(definition)
    : buildContextMenuJson(definition);
}

/**
 * Our embed type is a structural subset of Discord's. One cast here beats
 * importing discord.js into 40 modules.
 */
export function toReplyOptions(input: ReplyInput): InteractionReplyOptions {
  const { components, files, v2, ...rest } = input;
  const options = rest as unknown as InteractionReplyOptions;
  if (v2) {
    // A V2 message is layout, not content: Discord rejects the flag when the
    // payload also carries content or embeds.
    delete options.content;
    delete options.embeds;
    options.components = toV2Components(v2);
    options.flags = MessageFlags.IsComponentsV2;
  } else if (components) {
    options.components = toComponents(components);
  }
  if (files?.length) options.files = toFiles(files);
  return options;
}

/** Exports are UTF-8 JSON; the adapter owns the Buffer and file name mapping. */
function toFiles(files: NonNullable<ReplyInput["files"]>): AttachmentBuilder[] {
  return files.map(
    (file) =>
      new AttachmentBuilder(Buffer.from(file.content, "utf8"), {
        name: file.name,
        description: file.description,
      }),
  );
}

/**
 * Discord rejects the ephemeral flag on an edit, so edits get their own cast
 * instead of reusing the reply one.
 */
function toEditOptions(input: ReplyInput): InteractionEditReplyOptions {
  const { components, files, v2, ...rest } = input;
  const options = rest as unknown as InteractionEditReplyOptions;
  if (v2) {
    delete options.content;
    delete options.embeds;
    options.components = toV2Components(v2);
    options.flags = MessageFlags.IsComponentsV2;
  } else if (components) {
    options.components = toComponents(components);
  }
  if (files?.length) options.files = toFiles(files);
  return options;
}

/**
 * An interaction.update sends components but never a flag: the message keeps
 * the V2 marker it was created with, so repeating it is not part of the call.
 */
function toUpdateOptions(input: ReplyInput): InteractionUpdateOptions {
  const { components, files, v2, ...rest } = input;
  const options = rest as unknown as InteractionUpdateOptions;
  if (v2) {
    delete options.content;
    delete options.embeds;
    options.components = toV2Components(v2);
  } else if (components) {
    options.components = toComponents(components);
  }
  if (files?.length) options.files = toFiles(files);
  return options;
}

export function toComponents(rows: ActionRow[]): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
  return rows.map((row) => {
    const builder = new ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>();
    builder.addComponents(
      row.components.map((component) => {
        if (component.type === "select") {
          const select = new StringSelectMenuBuilder()
            .setCustomId(component.customId)
            .setPlaceholder(component.placeholder)
            .setMinValues(component.minValues ?? 0)
            .setMaxValues(component.maxValues ?? 1)
            .addOptions(
              component.options.slice(0, 25).map((option) => {
                const item = new StringSelectMenuOptionBuilder()
                  .setLabel(option.label.slice(0, 100))
                  .setValue(option.value);
                if (option.description) item.setDescription(option.description.slice(0, 100));
                if (option.default) item.setDefault(true);
                return item;
              }),
            );
          if (component.disabled) select.setDisabled(true);
          return select;
        }
        const button = new ButtonBuilder().setLabel(component.label);
        if (component.style === "link") {
          button.setStyle(ButtonStyle.Link);
          if (component.url) button.setURL(component.url);
        } else {
          button.setStyle(STYLES[component.style]).setCustomId(component.customId);
        }
        if (component.disabled) button.setDisabled(true);
        return button;
      }),
    );
    return builder;
  });
}

const STYLES = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
} as const;

/**
 * Components V2 is a layout tree, not a set of action rows. The builder in
 * `@keystone/ui` has already enforced the budgets and shapes; this function
 * only maps each node onto the discord.js builder that serialises it.
 */
export function toV2Components(
  components: readonly V2Component[],
): NonNullable<InteractionReplyOptions["components"]> {
  return components.map((component) => {
    switch (component.type) {
      case "container":
        return toV2Container(component);
      case "text-display":
        return new TextDisplayBuilder().setContent(component.content);
      case "separator":
        return toV2Separator(component);
      case "section":
        return toV2Section(component);
      case "action-row":
        return toV2ActionRow(component.components);
    }
  });
}

function toV2Container(container: V2Container): ContainerBuilder {
  const builder = new ContainerBuilder();
  if (container.accentColor !== undefined) builder.setAccentColor(container.accentColor);
  if (container.spoiler) builder.setSpoiler(true);
  for (const child of container.components) {
    addContainerChild(builder, child);
  }
  return builder;
}

function addContainerChild(builder: ContainerBuilder, child: V2ContainerChild): void {
  switch (child.type) {
    case "text-display":
      builder.addTextDisplayComponents(new TextDisplayBuilder().setContent(child.content));
      return;
    case "separator":
      builder.addSeparatorComponents(toV2Separator(child));
      return;
    case "section":
      builder.addSectionComponents(toV2Section(child));
      return;
    case "action-row":
      builder.addActionRowComponents(toV2ActionRow(child.components));
      return;
  }
}

function toV2Separator(separator: { divider?: boolean; spacing?: "small" | "large" }): SeparatorBuilder {
  const builder = new SeparatorBuilder();
  if (separator.divider !== undefined) builder.setDivider(separator.divider);
  if (separator.spacing) {
    builder.setSpacing(
      separator.spacing === "large" ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small,
    );
  }
  return builder;
}

function toV2Section(section: V2Section): SectionBuilder {
  const builder = new SectionBuilder();
  builder.addTextDisplayComponents(
    ...section.texts.map((text) => new TextDisplayBuilder().setContent(text.content)),
  );
  if (section.accessory?.type === "button") {
    builder.setButtonAccessory(toV2Button(section.accessory));
  } else if (section.accessory?.type === "thumbnail") {
    builder.setThumbnailAccessory(toV2Thumbnail(section.accessory));
  }
  return builder;
}

function toV2ActionRow(
  components: readonly V2ActionComponent[],
): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder> {
  const builder = new ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>();
  for (const component of components) {
    builder.addComponents(component.type === "select" ? toV2Select(component) : toV2Button(component));
  }
  return builder;
}

function toV2Button(button: V2Button): ButtonBuilder {
  const builder = new ButtonBuilder().setLabel(button.label);
  if (button.style === "link") {
    builder.setStyle(ButtonStyle.Link);
    if (button.url) builder.setURL(button.url);
  } else {
    builder.setStyle(STYLES[button.style]);
    if (button.customId) builder.setCustomId(button.customId);
  }
  if (button.disabled) builder.setDisabled(true);
  return builder;
}

function toV2Select(select: V2Select): StringSelectMenuBuilder {
  const builder = new StringSelectMenuBuilder()
    .setCustomId(select.customId)
    .setPlaceholder(select.placeholder)
    .setMinValues(select.minValues ?? 0)
    .setMaxValues(select.maxValues ?? 1)
    .addOptions(
      select.options.map((option) => {
        const item = new StringSelectMenuOptionBuilder().setLabel(option.label).setValue(option.value);
        if (option.description) item.setDescription(option.description);
        if (option.default) item.setDefault(true);
        return item;
      }),
    );
  if (select.disabled) builder.setDisabled(true);
  return builder;
}

function toV2Thumbnail(thumbnail: { url: string; description?: string; spoiler?: boolean }): ThumbnailBuilder {
  const builder = new ThumbnailBuilder().setURL(thumbnail.url);
  if (thumbnail.description) builder.setDescription(thumbnail.description);
  if (thumbnail.spoiler) builder.setSpoiler(true);
  return builder;
}

/** A modal is a title plus one Label per text input; nothing else is sent. */
export function toModalBuilder(spec: ModalSpec): ModalBuilder {
  const builder = new ModalBuilder().setCustomId(spec.customId).setTitle(spec.title);
  for (const input of spec.components) {
    const textInput = new TextInputBuilder()
      .setCustomId(input.customId)
      .setStyle(input.style === "paragraph" ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(input.required ?? true);
    if (input.placeholder) textInput.setPlaceholder(input.placeholder);
    if (input.value) textInput.setValue(input.value);
    if (input.minLength !== undefined) textInput.setMinLength(input.minLength);
    if (input.maxLength !== undefined) textInput.setMaxLength(input.maxLength);
    builder.addLabelComponents(new LabelBuilder().setLabel(input.label).setTextInputComponent(textInput));
  }
  return builder;
}

type AnyComponentInteraction =
  | ButtonInteraction
  | StringSelectMenuInteraction
  | ModalSubmitInteraction;

/**
 * The component counterpart of `asInteractionLike`: one structural shape for a
 * button, a string select and a modal submit, so routing is testable without a
 * gateway. `replied` treats a deferred interaction as answered, because a
 * second `reply` would be refused.
 */
export function asComponentInteraction(
  interaction: AnyComponentInteraction,
): ComponentInteractionLike {
  // A modal submit has already replaced the message; only buttons and selects
  // may update it, so the optional method exists only where Discord allows it.
  const update = "update" in interaction ? interaction.update.bind(interaction) : undefined;
  const base = {
    customId: interaction.customId,
    guildId: interaction.guildId,
    channelId: interaction.channelId ?? null,
    userId: interaction.user.id,
    permissions: interaction.memberPermissions ? interaction.memberPermissions.toArray() : [],
    get replied() {
      return interaction.replied || interaction.deferred;
    },
    reply: (input: ReplyInput) => interaction.reply(toReplyOptions(input)),
    ...(update ? { update: (input: ReplyInput) => update(toUpdateOptions(input)) } : {}),
    deferReply: (input?: { ephemeral?: boolean }) => interaction.deferReply(input ?? {}),
    editReply: (input: ReplyInput) => interaction.editReply(toEditOptions(input)),
    followUp: (input: ReplyInput) => interaction.followUp(toReplyOptions(input)),
  };

  if (interaction.isButton()) {
    return {
      ...base,
      kind: "button",
      showModal: (modal: ModalSpec) => interaction.showModal(toModalBuilder(modal)),
    };
  }

  if (interaction.isStringSelectMenu()) {
    return {
      ...base,
      kind: "select",
      values: interaction.values,
      showModal: (modal: ModalSpec) => interaction.showModal(toModalBuilder(modal)),
    };
  }

  const fields: Record<string, string> = {};
  for (const [customId, component] of interaction.fields.fields) {
    fields[customId] = (component as TextInputComponent).value;
  }
  return { ...base, kind: "modal", fields };
}

export function buildCommandJson(
  definition: CommandDefinition,
): RESTPostAPIChatInputApplicationCommandsJSONBody {
  const builder = new SlashCommandBuilder()
    .setName(definition.name)
    .setDescription(definition.description);

  if (definition.groups?.length) {
    for (const group of definition.groups) {
      builder.addSubcommandGroup((groupBuilder) => {
        groupBuilder.setName(group.name).setDescription(group.description);
        for (const subcommand of group.subcommands) {
          groupBuilder.addSubcommand((subBuilder) => {
            subBuilder.setName(subcommand.name).setDescription(subcommand.description);
            for (const option of subcommand.options ?? []) addOption(subBuilder, option);
            return subBuilder;
          });
        }
        return groupBuilder;
      });
    }
  } else if (definition.subcommands?.length) {
    for (const subcommand of definition.subcommands) {
      builder.addSubcommand((subBuilder) => {
        subBuilder.setName(subcommand.name).setDescription(subcommand.description);
        for (const option of subcommand.options ?? []) addOption(subBuilder, option);
        return subBuilder;
      });
    }
  } else {
    for (const option of definition.options ?? []) addOption(builder, option);
  }

  const json = builder.toJSON() as unknown as CommandJsonNode;
  localizeCommand(json, definition);
  return json as unknown as RESTPostAPIChatInputApplicationCommandsJSONBody;
}

interface CommandJsonNode {
  name: string;
  type?: number;
  description?: string;
  description_localizations?: Record<string, string>;
  options?: CommandJsonNode[];
}

/**
 * Discord displays a localized description when the client's locale matches;
 * the command name stays the invocation identifier. Both the text and the
 * locale list come from `@keystone/i18n`, so a description cannot drift into a
 * second hand-maintained localization table. An untranslated command simply
 * carries no localization map and renders in English.
 */
function localizeCommand(json: CommandJsonNode, definition: CommandDefinition): void {
  applyDescription(json, `command.${definition.name}`);

  // Each subcommand owns its own option nodes: two subcommands may share an
  // option name (`module` on /help browse and /help commands), and the JSON has
  // one node per appearance even though the description key is shared.
  for (const option of definition.options ?? []) {
    const node = (json.options ?? []).find(
      (entry) => entry.name === option.name && entry.type !== 1 && entry.type !== 2,
    );
    if (node) applyDescription(node, `command.${definition.name}.option.${option.name}`);
  }

  for (const subcommand of definition.subcommands ?? []) {
    const node = (json.options ?? []).find(
      (entry) => entry.name === subcommand.name && entry.type === 1,
    );
    if (!node) continue;
    applyDescription(node, `command.${definition.name}.${subcommand.name}`);
    for (const option of subcommand.options ?? []) {
      const optionNode = (node.options ?? []).find(
        (entry) => entry.name === option.name && entry.type !== 1 && entry.type !== 2,
      );
      if (optionNode) {
        applyDescription(optionNode, `command.${definition.name}.option.${option.name}`);
      }
    }
  }
}

function applyDescription(node: CommandJsonNode, key: string): void {
  const localizations: Record<string, string> = {};
  for (const locale of SUPPORTED_LOCALES) {
    if (locale === DEFAULT_LOCALE) continue;
    const text = lookupMessage(locale, `${key}.description`);
    if (text) localizations[locale] = text;
  }
  if (Object.keys(localizations).length > 0) node.description_localizations = localizations;
}

function addOption(
  builder: SlashCommandBuilder | SlashCommandSubcommandBuilder,
  option: CommandOption,
): void {
  const { name, description } = option;
  const required = option.required ?? false;

  switch (option.type) {
    case "string":
      builder.addStringOption((o) => {
        o.setName(name).setDescription(description).setRequired(required);
        if (option.choices) {
          o.addChoices(...option.choices.map((c) => ({ name: c.name, value: String(c.value) })));
        }
        return o;
      });
      break;

    case "integer":
      builder.addIntegerOption((o) => {
        o.setName(name).setDescription(description).setRequired(required);
        if (option.minValue !== undefined) o.setMinValue(option.minValue);
        if (option.maxValue !== undefined) o.setMaxValue(option.maxValue);
        if (option.choices) {
          o.addChoices(...option.choices.map((c) => ({ name: c.name, value: Number(c.value) })));
        }
        return o;
      });
      break;

    case "number":
      builder.addNumberOption((o) => {
        o.setName(name).setDescription(description).setRequired(required);
        if (option.minValue !== undefined) o.setMinValue(option.minValue);
        if (option.maxValue !== undefined) o.setMaxValue(option.maxValue);
        return o;
      });
      break;

    case "boolean":
      builder.addBooleanOption((o) => o.setName(name).setDescription(description).setRequired(required));
      break;

    case "user":
      builder.addUserOption((o) => o.setName(name).setDescription(description).setRequired(required));
      break;

    case "channel":
      builder.addChannelOption((o) => o.setName(name).setDescription(description).setRequired(required));
      break;

    case "role":
      builder.addRoleOption((o) => o.setName(name).setDescription(description).setRequired(required));
      break;

    case "mentionable":
      builder.addMentionableOption((o) =>
        o.setName(name).setDescription(description).setRequired(required),
      );
      break;

    case "attachment":
      builder.addAttachmentOption((o) =>
        o.setName(name).setDescription(description).setRequired(required),
      );
      break;
  }
}
