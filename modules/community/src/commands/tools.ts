import { defineCommand, UserError, type CommandContext, type CommandOption } from "@keystone/kernel";
import { ContentService } from "../content";
import {
  BirthdayService,
  StickyService,
  SuggestionService,
} from "../extras";
import { GiveawayService, ReactionRoleService, WelcomeService } from "../engagement";
import { AutoResponderService, type ResponderMatch } from "../responder";
import {
  channelId,
  integer,
  port,
  requirePermission,
  settingsFor,
  text,
  timeFromMinutes,
  userId,
} from "./helpers";

const OPTIONS = {
  name: { type: "string", name: "name", description: "Name, title, question or id" },
  value: { type: "string", name: "value", description: "Text, options, date, URL or status" },
  channel: { type: "channel", name: "channel", description: "Target or source channel" },
  target: { type: "channel", name: "target", description: "Override destination channel" },
  role: { type: "role", name: "role", description: "Role for welcome or reaction roles" },
  user: { type: "user", name: "user", description: "Target member" },
  duration: { type: "integer", name: "duration", description: "Minutes from now", minValue: 1 },
  limit: { type: "integer", name: "limit", description: "Winners, threshold or delay", minValue: 1 },
  url: { type: "string", name: "url", description: "Feed URL" },
  match: {
    type: "string",
    name: "match",
    description: "Auto-responder match mode",
    choices: ["exact", "contains", "regex"].map((value) => ({ name: value, value })),
  },
} satisfies Record<string, CommandOption>;

function opts(...names: (keyof typeof OPTIONS)[]): CommandOption[] {
  return names.map((name) => OPTIONS[name]);
}

export const tools = defineCommand({
  name: "tools",
  description: "Community utilities: birthdays, suggestions, content, roles, giveaways, feeds and auto-responders.",
  subcommands: [
    { name: "embed", description: "Send a simple embed to a channel.", options: opts("channel", "name", "value") },
    { name: "tag", description: "Show a tag, or save one for this server.", options: opts("name", "value") },
    { name: "reminder", description: "Set a reminder for yourself.", options: opts("value", "duration", "channel") },
    { name: "schedule", description: "Schedule a message for a channel.", options: opts("value", "duration", "channel") },
    { name: "giveaway", description: "Start a giveaway in a channel.", options: opts("value", "duration", "channel", "limit") },
    { name: "giveaway-end", description: "End a giveaway now and pick winners.", options: opts("value") },
    { name: "giveaway-reroll", description: "Reroll winners for a finished giveaway.", options: opts("value") },
    { name: "poll", description: "Post a poll with pipe-separated options.", options: opts("name", "value", "channel") },
    { name: "feed", description: "Subscribe a channel to an RSS feed.", options: opts("url", "channel") },
    { name: "stat", description: "Create a member, online or booster stat channel.", options: opts("channel", "value") },
    { name: "welcome", description: "Configure the welcome message and autorole.", options: opts("value", "channel", "role", "limit") },
    { name: "goodbye", description: "Configure the goodbye message for departing members.", options: opts("value", "channel") },
    { name: "roles", description: "Post a reaction-role or select-role panel.", options: opts("channel", "value", "role", "name", "limit") },
    { name: "starboard", description: "Configure the starboard channel and threshold.", options: opts("channel", "limit") },
    { name: "starboard-override", description: "Set a per-channel starboard threshold or turn it off.", options: opts("channel", "target", "value", "limit") },
    { name: "voice", description: "Configure the temporary voice hub.", options: opts("channel", "value") },
    { name: "birthdays", description: "Configure birthday announcements.", options: opts("channel", "role", "value") },
    { name: "birthday", description: "Save or remove a member's birthday.", options: opts("user", "value") },
    { name: "suggestions", description: "Configure the suggestions channel.", options: opts("channel") },
    { name: "suggestion", description: "Submit a suggestion.", options: opts("value", "channel") },
    { name: "suggestion-decide", description: "Approve or reject a suggestion.", options: opts("name", "value") },
    { name: "sticky", description: "Configure a sticky message in a channel.", options: opts("channel", "value", "limit") },
    { name: "responder", description: "Create or update an auto-responder trigger.", options: opts("name", "value", "match", "limit") },
    { name: "responders", description: "List auto-responders, or enable and disable them.", options: opts("value") },
    { name: "responder-remove", description: "Remove an auto-responder by id.", options: opts("name") },
  ],
  guards: [
    (ctx) =>
      ctx.guildId
        ? { ok: true }
        : { ok: false, message: "This command only works in a server." },
  ],
  async execute(ctx: CommandContext): Promise<void> {
    const { store, actions } = port(ctx);
    const settings = await settingsFor(ctx);
    const content = new ContentService(store, actions, settings, ctx.now, ctx.componentSigner);
    const giveaways = new GiveawayService(
      store,
      actions,
      settings,
      ctx.now,
      Math.random,
      ctx.componentSigner,
    );
    const birthdays = new BirthdayService(store, actions, settings, ctx.now);
    const suggestions = new SuggestionService(
      store,
      actions,
      settings,
      ctx.now,
      ctx.componentSigner,
    );
    const sticky = new StickyService(store, actions);
    const responders = new AutoResponderService(store, actions, settings, ctx.now);
    const guildId = ctx.guildId as string;
    const selected = ctx.commandPath[0] ?? text(ctx, "action");

    if (selected === "embed") {
      requirePermission(ctx, "ManageGuild");
      const target = channelId(ctx, "channel");
      if (!target) throw new UserError("Choose a channel.");
      const name = text(ctx, "name") ?? "embed";
      const description = text(ctx, "value");
      if (!description) throw new UserError("Give the embed a description.");
      const result = await content.createEmbed(guildId, target, name, {
        title: name,
        description,
      });
      await ctx.interaction.reply({ content: `Embed sent (${result.messageId}).`, ephemeral: true });
      return;
    }

    if (selected === "tag") {
      const name = text(ctx, "name");
      const value = text(ctx, "value");
      if (!name) throw new UserError("Name the tag.");
      if (!value) {
        const found = await content.getTag(guildId, name);
        if (!found) throw new UserError("That tag does not exist.");
        await ctx.interaction.reply({ content: found });
        return;
      }
      requirePermission(ctx, "ManageGuild");
      await content.createTag(guildId, name, value, ctx.userId);
      await ctx.interaction.reply({ content: `Saved tag \`${name}\`.`, ephemeral: true });
      return;
    }

    if (selected === "reminder") {
      const value = text(ctx, "value");
      const minutes = integer(ctx, "duration");
      if (!value || !minutes) throw new UserError("Reminder needs text and a duration in minutes.");
      const record = await content.createReminder(
        guildId,
        ctx.userId,
        channelId(ctx, "channel"),
        value,
        timeFromMinutes(minutes, ctx.now),
        ctx.timers ?? ctx.queue,
      );
      await ctx.interaction.reply({
        content: `Reminder set for <t:${Math.floor(new Date(record.dueAt).getTime() / 1000)}:R>.`,
        ephemeral: true,
      });
      return;
    }

    if (selected === "schedule") {
      requirePermission(ctx, "ManageGuild");
      const value = text(ctx, "value");
      const minutes = integer(ctx, "duration");
      const target = channelId(ctx, "channel");
      if (!value || !minutes || !target) throw new UserError("Schedule needs text, a channel and minutes.");
      await content.scheduleMessage(
        guildId,
        target,
        value,
        timeFromMinutes(minutes, ctx.now),
        ctx.timers ?? ctx.queue,
      );
      await ctx.interaction.reply({ content: "Scheduled message saved.", ephemeral: true });
      return;
    }

    if (selected === "giveaway") {
      requirePermission(ctx, "ManageGuild");
      const prize = text(ctx, "value");
      const minutes = integer(ctx, "duration");
      const target = channelId(ctx, "channel");
      if (!prize || !minutes || !target) throw new UserError("Giveaway needs a prize, channel and duration.");
      const record = await giveaways.start(guildId, target, prize, minutes, integer(ctx, "limit") ?? 1);
      await ctx.interaction.reply({ content: `Giveaway started (${record.id}).`, ephemeral: true });
      return;
    }

    if (selected === "giveaway-end" || selected === "giveaway-reroll") {
      requirePermission(ctx, "ManageGuild");
      const giveawayId = text(ctx, "value");
      if (!giveawayId) throw new UserError("Pass the giveaway id as value.");
      if (selected === "giveaway-end") {
        const result = await giveaways.end(guildId, giveawayId);
        await ctx.interaction.reply({
          content: result.ended
            ? `Giveaway ended. Winners: ${result.winners.map((id) => `<@${id}>`).join(", ") || "none"}.`
            : (result.reason ?? "Giveaway not ended."),
          ephemeral: true,
        });
      } else {
        const result = await giveaways.reroll(guildId, giveawayId);
        await ctx.interaction.reply({
          content: result.winners.length
            ? `Rerolled winners: ${result.winners.map((id) => `<@${id}>`).join(", ")}.`
            : (result.reason ?? "No reroll winners."),
          ephemeral: true,
        });
      }
      return;
    }

    if (selected === "poll") {
      const question = text(ctx, "name");
      const options = text(ctx, "value")?.split("|").map((option) => option.trim()).filter(Boolean);
      const target = channelId(ctx, "channel");
      if (!question || !options || !target) throw new UserError("Poll needs a question, options and channel.");
      const poll = await content.createPoll(guildId, target, question, options);
      await ctx.interaction.reply({ content: `Poll posted (${poll.id}).`, ephemeral: true });
      return;
    }

    if (selected === "feed") {
      requirePermission(ctx, "ManageGuild");
      const url = text(ctx, "url") ?? text(ctx, "value");
      const target = channelId(ctx, "channel");
      if (!url || !target) throw new UserError("Feed needs a URL and channel.");
      const feed = await content.addFeed(guildId, url, target);
      await ctx.interaction.reply({ content: `Feed saved (${feed.id}).`, ephemeral: true });
      return;
    }

    if (selected === "stat") {
      requirePermission(ctx, "ManageGuild");
      const target = channelId(ctx, "channel");
      const raw = (text(ctx, "value") ?? "members").toLowerCase();
      if (!target || !["members", "online", "boosters"].includes(raw)) {
        throw new UserError("Stat channel needs a channel and members, online or boosters.");
      }
      await content.addStatChannel(guildId, target, raw as "members" | "online" | "boosters");
      await ctx.interaction.reply({ content: "Stat channel configured.", ephemeral: true });
      return;
    }

    if (selected === "welcome") {
      requirePermission(ctx, "ManageGuild");
      const message = text(ctx, "value");
      const target = channelId(ctx, "channel");
      if (!message || !target) throw new UserError("Welcome needs a message and channel.");
      await ctx.settings.update(guildId, {
        welcome: {
          ...settings.welcome,
          enabled: true,
          channelId: target,
          message,
          roleId: text(ctx, "role") ?? settings.welcome.roleId,
          roleDelayMinutes: integer(ctx, "limit") ?? settings.welcome.roleDelayMinutes,
        },
      });
      await ctx.interaction.reply({ content: "Welcome message enabled.", ephemeral: true });
      return;
    }

    if (selected === "goodbye") {
      requirePermission(ctx, "ManageGuild");
      const message = text(ctx, "value");
      const target = channelId(ctx, "channel");
      if (!message || !target) throw new UserError("Goodbye needs a message and channel.");
      await ctx.settings.update(guildId, {
        goodbye: { enabled: true, channelId: target, message },
      });
      await ctx.interaction.reply({ content: "Goodbye message enabled.", ephemeral: true });
      return;
    }

    if (selected === "roles") {
      requirePermission(ctx, "ManageGuild");
      const target = channelId(ctx, "channel");
      if (!target) throw new UserError("Choose a channel.");
      const raw = text(ctx, "value");
      if (raw) {
        const roles = raw.split(",").map((entry) => {
          const [roleId, ...label] = entry.trim().split(":");
          if (!roleId || label.length === 0) {
            throw new UserError("Select roles look like `roleId:Label,roleId:Label`.");
          }
          return { roleId, label: label.join(":") };
        });
        if (roles.length < 2) throw new UserError("A select panel needs at least two roles.");
        const result = await new ReactionRoleService(
          store,
          actions,
          ctx.componentSigner,
          ctx.now,
        ).createSelectPanel(
          guildId,
          target,
          text(ctx, "name") ?? "Choose your roles",
          roles,
          { maxValues: integer(ctx, "limit") ?? roles.length },
        );
        await ctx.interaction.reply({
          content: `Select-role panel posted (${result.messageId}).`,
          ephemeral: true,
        });
        return;
      }
      const role = text(ctx, "role");
      if (!role) throw new UserError("Choose a role, or use value for a multi-select panel.");
      const label = text(ctx, "name") ?? "Choose a role";
      const result = await new ReactionRoleService(
        store,
        actions,
        ctx.componentSigner,
        ctx.now,
      ).createPanel(guildId, target, label, [{ roleId: role, label }]);
      await ctx.interaction.reply({ content: `Reaction-role panel posted (${result.messageId}).`, ephemeral: true });
      return;
    }

    if (selected === "starboard") {
      requirePermission(ctx, "ManageGuild");
      const target = channelId(ctx, "channel");
      if (!target) throw new UserError("Choose a starboard channel.");
      const threshold = integer(ctx, "limit") ?? settings.starboard.threshold;
      await ctx.settings.update(guildId, {
        starboard: { ...settings.starboard, channelId: target, threshold },
      });
      await ctx.interaction.reply({ content: "Starboard configured.", ephemeral: true });
      return;
    }

    if (selected === "starboard-override") {
      requirePermission(ctx, "ManageGuild");
      const source = channelId(ctx, "channel");
      if (!source) throw new UserError("Choose the source channel.");
      const overrides = { ...settings.starboard.overrides };
      if (text(ctx, "value") === "off") {
        delete overrides[source];
      } else {
        const threshold = integer(ctx, "limit");
        if (!threshold) throw new UserError("Give the override a threshold.");
        overrides[source] = {
          threshold,
          channelId: channelId(ctx, "target") ?? settings.starboard.channelId,
        };
      }
      await ctx.settings.update(guildId, {
        starboard: { ...settings.starboard, overrides },
      });
      await ctx.interaction.reply({ content: "Per-channel starboard override saved.", ephemeral: true });
      return;
    }

    if (selected === "voice") {
      requirePermission(ctx, "ManageGuild");
      const hub = channelId(ctx, "channel");
      if (!hub) throw new UserError("Choose the voice hub channel.");
      await ctx.settings.update(guildId, {
        tempVoice: {
          ...settings.tempVoice,
          hubChannelId: hub,
          nameTemplate: text(ctx, "value") ?? settings.tempVoice.nameTemplate,
        },
      });
      await ctx.interaction.reply({ content: "Temporary voice hub configured.", ephemeral: true });
      return;
    }

    if (selected === "birthdays") {
      requirePermission(ctx, "ManageGuild");
      const target = channelId(ctx, "channel");
      if (!target) throw new UserError("Choose a birthday announcement channel.");
      await ctx.settings.update(guildId, {
        birthdays: {
          ...settings.birthdays,
          enabled: true,
          channelId: target,
          roleId: text(ctx, "role") ?? settings.birthdays.roleId,
          timezone: text(ctx, "value") ?? settings.birthdays.timezone,
        },
      });
      await ctx.interaction.reply({ content: "Birthday announcements enabled.", ephemeral: true });
      return;
    }

    if (selected === "birthday") {
      const target = userId(ctx, "user") ?? ctx.userId;
      if (target !== ctx.userId) requirePermission(ctx, "ManageGuild");
      const value = text(ctx, "value");
      if (!value) throw new UserError("Give a birthday as `MM-DD`, or `off`.");
      if (value.toLowerCase() === "off") {
        await birthdays.remove(guildId, target);
        await ctx.interaction.reply({ content: "Birthday removed.", ephemeral: true });
        return;
      }
      const record = await birthdays.set(guildId, target, value);
      await ctx.interaction.reply({
        content: `Birthday saved for <@${target}>: ${record.month}/${record.day}.`,
        ephemeral: true,
      });
      return;
    }

    if (selected === "suggestions") {
      requirePermission(ctx, "ManageGuild");
      const target = channelId(ctx, "channel");
      if (!target) throw new UserError("Choose a suggestions channel.");
      await ctx.settings.update(guildId, {
        suggestions: { ...settings.suggestions, enabled: true, channelId: target },
      });
      await ctx.interaction.reply({ content: "Suggestions enabled.", ephemeral: true });
      return;
    }

    if (selected === "suggestion") {
      const value = text(ctx, "value");
      if (!value) throw new UserError("Write the suggestion in value.");
      const record = await suggestions.submit(guildId, ctx.userId, value, text(ctx, "channel"));
      await ctx.interaction.reply({ content: `Suggestion posted (${record.id}).`, ephemeral: true });
      return;
    }

    if (selected === "suggestion-decide") {
      requirePermission(ctx, "ManageGuild");
      const id = text(ctx, "name");
      const status = text(ctx, "value")?.toLowerCase();
      if (!id || (status !== "approved" && status !== "rejected")) {
        throw new UserError("Pass the suggestion id and `approved` or `rejected`.");
      }
      const result = await suggestions.decide(guildId, id, ctx.userId, status);
      await ctx.interaction.reply({
        content: result.changed
          ? `Suggestion ${status}.`
          : `Suggestion was already ${status}.`,
        ephemeral: true,
      });
      return;
    }

    if (selected === "sticky") {
      requirePermission(ctx, "ManageGuild");
      const target = channelId(ctx, "channel");
      const message = text(ctx, "value");
      const after = integer(ctx, "limit") ?? 5;
      if (!target || !message) throw new UserError("Sticky needs a channel, message and refresh count.");
      await sticky.configure(guildId, target, message, after);
      await ctx.interaction.reply({ content: "Sticky message configured.", ephemeral: true });
      return;
    }

    if (selected === "responder") {
      requirePermission(ctx, "ManageGuild");
      const trigger = text(ctx, "name");
      const response = text(ctx, "value");
      if (!trigger || !response) {
        throw new UserError("Auto-responder needs a trigger in name and a reply in value.");
      }
      const record = await responders.save(guildId, {
        trigger,
        match: (text(ctx, "match") ?? "exact") as ResponderMatch,
        response,
        createdBy: ctx.userId,
        cooldownSeconds: integer(ctx, "limit"),
      });
      await ctx.interaction.reply({
        content: `Auto-responder saved (${record.id}).`,
        ephemeral: true,
      });
      return;
    }

    if (selected === "responders") {
      requirePermission(ctx, "ManageGuild");
      const toggle = text(ctx, "value")?.toLowerCase();
      if (toggle) {
        if (toggle !== "on" && toggle !== "off") {
          throw new UserError("Use value=on or value=off, or omit value to list triggers.");
        }
        await ctx.settings.update(guildId, {
          responders: { ...settings.responders, enabled: toggle === "on" },
        });
        await ctx.interaction.reply({
          content: `Auto-responders ${toggle === "on" ? "enabled" : "disabled"}.`,
          ephemeral: true,
        });
        return;
      }

      const records = await responders.list(guildId);
      if (records.length === 0) {
        await ctx.interaction.reply({
          content: "No auto-responders configured.",
          ephemeral: true,
        });
        return;
      }
      // Discord caps a message at 2,000 characters. Show the newest 10 with
      // short trigger/reply previews; the full id is still removable.
      const listed = records.slice(0, 10);
      const lines = listed.map((record) => {
        const trigger = record.trigger.length > 40
          ? `${record.trigger.slice(0, 39)}…`
          : record.trigger;
        const reply = record.response.length > 40
          ? `${record.response.slice(0, 39)}…`
          : record.response;
        return `\`${record.id}\` · ${record.match} · ${trigger} → ${reply}`;
      });
      const suffix = records.length > listed.length
        ? ` (showing ${listed.length} of ${records.length})`
        : "";
      await ctx.interaction.reply({
        content: `Auto-responders${suffix}:\n${lines.join("\n")}`,
        ephemeral: true,
      });
      return;
    }

    if (selected === "responder-remove") {
      requirePermission(ctx, "ManageGuild");
      const id = text(ctx, "name");
      if (!id) throw new UserError("Pass the auto-responder id in name.");
      const removed = await responders.remove(guildId, id);
      await ctx.interaction.reply({
        content: removed ? "Auto-responder removed." : "No auto-responder with that id.",
        ephemeral: true,
      });
      return;
    }
  },
  notes: "One root command replaces Carl/MEE6 utility command sprawl; every action is data-only.",
});
