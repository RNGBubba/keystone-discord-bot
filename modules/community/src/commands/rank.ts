import { defineCommand, UserError, type CommandContext, type CommandOption } from "@keystone/kernel";
import { guildLocale, t } from "@keystone/i18n";
import { EconomyService, LevelingService } from "../progress";
import { rankPanel } from "../panels";
import { SeasonService } from "../extras";
import { action, integer, port, requirePermission, settingsFor, text, userId } from "./helpers";

const OPTIONS = {
  user: { type: "user", name: "user", description: "Member to look at or pay" },
  amount: { type: "integer", name: "amount", description: "Coins to move or gamble", minValue: 1 },
  level: { type: "integer", name: "level", description: "Level for admin changes", minValue: 0 },
  value: { type: "string", name: "value", description: "Rewards, season key or status" },
  item: { type: "string", name: "item", description: "Shop item id" },
  limit: { type: "integer", name: "limit", description: "Rows to show", minValue: 1, maxValue: 25 },
  days: { type: "integer", name: "days", description: "Season length in days", minValue: 1, maxValue: 365 },
} satisfies Record<string, CommandOption>;

function opts(...names: (keyof typeof OPTIONS)[]): CommandOption[] {
  return names.map((name) => OPTIONS[name]);
}

export const rank = defineCommand({
  name: "rank",
  description: "View levels, leaderboards, rewards, currency, shop and transfers.",
  subcommands: [
    { name: "view", description: "Show your or another member's level and XP.", options: opts("user") },
    { name: "leaderboard", description: "Show the server XP leaderboard.", options: opts("limit") },
    { name: "rewards", description: "List or set level role rewards.", options: opts("value") },
    { name: "admin", description: "Set a member's level directly.", options: opts("user", "level") },
    { name: "balance", description: "Show a member's currency balance.", options: opts("user") },
    { name: "daily", description: "Claim your daily currency." },
    { name: "pay", description: "Send currency to another member.", options: opts("user", "amount") },
    { name: "shop", description: "List the server currency shop." },
    { name: "buy", description: "Buy a shop item.", options: opts("item") },
    { name: "gamble", description: "Gamble currency with a capped stake.", options: opts("amount") },
    { name: "ledger", description: "Show your recent currency movements.", options: opts("limit") },
    { name: "season", description: "Start a new XP season and archive the old one.", options: opts("value", "days") },
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
    const leveling = new LevelingService(store, actions, settings, ctx.now);
    const economy = new EconomyService(store, actions, settings, ctx.now, Math.random, ctx.cooldowns);
    const guildId = ctx.guildId as string;
    const locale = await guildLocale(ctx.config, guildId);
    const selected = ctx.commandPath[0] ?? action(ctx);

    if (selected === "view") {
      const target = userId(ctx, "user") ?? ctx.userId;
      const result = await leveling.rank(guildId, target);
      await ctx.interaction.reply({
        v2: rankPanel(
          {
            userId: target,
            level: result.profile.level,
            xp: result.profile.xp,
            rank: result.rank,
          },
          locale,
        ),
      });
      return;
    }

    if (selected === "leaderboard") {
      const rows = await leveling.leaderboard(guildId, integer(ctx, "limit") ?? 10);
      await ctx.interaction.reply({
        embeds: [
          {
            title: t(locale, "rank.leaderboard.title"),
            description:
              rows.length === 0
                ? t(locale, "rank.leaderboard.empty")
                : rows
                    .map(
                      (profile, index) =>
                        t(locale, "rank.leaderboard.row", index + 1, profile.userId, profile.level, profile.xp),
                    )
                    .join("\n"),
            color: 0x5865f2,
          },
        ],
      });
      return;
    }

    if (selected === "rewards") {
      requirePermission(ctx, "ManageGuild", locale);
      const value = text(ctx, "value");
      if (!value) {
        await ctx.interaction.reply({
          content:
            settings.xp.rewards.length === 0
              ? t(locale, "rank.rewards.empty")
              : settings.xp.rewards
                  .map((reward) => t(locale, "rank.rewards.row", reward.level, reward.roleId))
                  .join("\n"),
          ephemeral: true,
        });
        return;
      }
      const rewards = value.split(",").map((entry) => {
        const [level, roleId] = entry.split(":");
        const parsed = Number(level);
        if (!Number.isInteger(parsed) || parsed < 1 || !roleId) {
          throw new UserError(t(locale, "rank.rewards.invalid"));
        }
        return { level: parsed, roleId };
      });
      await ctx.settings.update(guildId, { xp: { ...settings.xp, rewards } });
      await ctx.interaction.reply({ content: t(locale, "rank.rewards.updated"), ephemeral: true });
      return;
    }

    if (selected === "admin") {
      requirePermission(ctx, "ManageGuild", locale);
      const target = userId(ctx, "user");
      const level = integer(ctx, "level");
      if (!target || level === undefined) throw new UserError(t(locale, "rank.admin.missing"));
      const profile = await leveling.setLevel(guildId, target, level);
      await ctx.interaction.reply({
        content: t(locale, "rank.admin.updated", target, profile.level, profile.xp),
        ephemeral: true,
      });
      return;
    }

    if (selected === "balance") {
      const target = userId(ctx, "user") ?? ctx.userId;
      const balance = await economy.balance(guildId, target);
      await ctx.interaction.reply({
        content: t(locale, "rank.balance", target, balance, settings.economy.currency),
      });
      return;
    }

    if (selected === "daily") {
      const result = await economy.daily(guildId, ctx.userId);
      await ctx.interaction.reply({
        // The service owns its refusal sentence and returns it in English. It
        // gets its own line, so the translated balance never attaches to it.
        content: result.ok
          ? t(locale, "rank.daily.ok", result.amount, settings.economy.currency, result.balance)
          : [result.reason, t(locale, "rank.daily.balance", result.balance)]
              .filter(Boolean)
              .join("\n"),
        ephemeral: true,
      });
      return;
    }

    if (selected === "pay") {
      const target = userId(ctx, "user");
      const amount = integer(ctx, "amount");
      if (!target || !amount) throw new UserError(t(locale, "rank.pay.missing"));
      const result = await economy.transfer(
        guildId,
        ctx.userId,
        target,
        amount,
        ctx.interaction.id,
      );
      await ctx.interaction.reply({
        content: result.ok
          ? t(locale, "rank.pay.ok", amount, settings.economy.currency, target)
          : (result.reason ?? t(locale, "rank.transfer.failed")),
        ephemeral: true,
      });
      return;
    }

    if (selected === "shop") {
      const items = economy.shop();
      await ctx.interaction.reply({
        embeds: [
          {
            title: t(locale, "rank.shop.title", settings.economy.currency),
            description:
              items.length === 0
                ? t(locale, "rank.shop.empty")
                : items
                    .map((item) =>
                      item.description
                        ? t(
                            locale,
                            "rank.shop.itemWithDescription",
                            item.name,
                            item.price,
                            item.id,
                            item.description,
                          )
                        : t(locale, "rank.shop.item", item.name, item.price, item.id),
                    )
                    .join("\n\n"),
            color: 0x57f287,
          },
        ],
      });
      return;
    }

    if (selected === "buy") {
      const itemId = text(ctx, "item");
      if (!itemId) throw new UserError(t(locale, "rank.buy.missingItem"));
      const result = await economy.buy(guildId, ctx.userId, itemId, ctx.interaction.id);
      await ctx.interaction.reply({
        content: result.ok
          ? t(locale, "rank.buy.ok", result.item?.name ?? itemId, result.balance ?? 0)
          : (result.reason ?? t(locale, "rank.purchase.failed")),
        ephemeral: true,
      });
      return;
    }

    if (selected === "gamble") {
      const amount = integer(ctx, "amount");
      if (!amount) throw new UserError(t(locale, "rank.gamble.missingAmount"));
      const result = await economy.gamble(guildId, ctx.userId, amount, ctx.interaction.id);
      await ctx.interaction.reply({
        content: result.ok
          ? result.won
            ? t(locale, "rank.gamble.won", result.amount ?? amount, result.balance ?? 0)
            : t(locale, "rank.gamble.lost", amount, result.balance ?? 0)
          : (result.reason ?? t(locale, "rank.gamble.failed")),
        ephemeral: true,
      });
      return;
    }

    if (selected === "ledger") {
      const rows = await economy.ledger(guildId, ctx.userId, integer(ctx, "limit") ?? 10);
      await ctx.interaction.reply({
        embeds: [
          {
            title: t(locale, "rank.ledger.title"),
            description:
              rows.length === 0
                ? t(locale, "rank.ledger.empty")
                : rows
                    .map(
                      (entry) =>
                        `${entry.amount > 0 ? "+" : ""}${entry.amount} · ${entry.reason} · ${entry.createdAt.slice(0, 10)}`,
                    )
                    .join("\n"),
            color: 0xfaa61a,
          },
        ],
        ephemeral: true,
      });
      return;
    }

    if (selected === "season") {
      requirePermission(ctx, "ManageGuild", locale);
      const key =
        text(ctx, "value") ?? `season-${new Date(ctx.now()).toISOString().slice(0, 10)}`;
      const service = new SeasonService(store, ctx.now);
      const result = await service.start(guildId, key, integer(ctx, "days") ?? 30);
      await ctx.interaction.reply({
        content: result.alreadyReset
          ? t(locale, "rank.season.already", result.state.key)
          : t(locale, "rank.season.started", result.state.key, result.archived),
        ephemeral: true,
      });
    }
  },
  notes: "XP is an append-only event projection; the economy ledger is the balance source.",
});
