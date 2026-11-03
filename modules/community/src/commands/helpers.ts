import { UserError, type CommandContext } from "@keystone/kernel";
import { DEFAULT_LOCALE, t } from "@keystone/i18n";
import { communitySettingsSchema, type CommunitySettings } from "../settings";

export async function settingsFor(ctx: CommandContext): Promise<CommunitySettings> {
  // No guild means no guild locale, so this refusal has no translation to use.
  if (!ctx.guildId) throw new UserError("This command only works in a server.");
  return communitySettingsSchema.parse(await ctx.settings.get(ctx.guildId));
}

export function port(ctx: CommandContext) {
  if (!ctx.community) throw new UserError("Community services are not wired.");
  return ctx.community;
}

export function requirePermission(
  ctx: CommandContext,
  permission: string,
  locale: string = DEFAULT_LOCALE,
): void {
  if (!ctx.interaction.permissions.includes(permission)) {
    throw new UserError(t(locale, "error.permission", permission));
  }
}

export function action(ctx: CommandContext): string {
  return String(ctx.interaction.options.action ?? "");
}

export function text(ctx: CommandContext, key: string): string | undefined {
  const value = ctx.interaction.options[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function integer(ctx: CommandContext, key: string): number | undefined {
  const value = ctx.interaction.options[key];
  return typeof value === "number" ? value : undefined;
}

export function userId(ctx: CommandContext, key: string): string | undefined {
  return text(ctx, key);
}

export function channelId(ctx: CommandContext, key: string): string | undefined {
  return text(ctx, key) ?? ctx.interaction.channelId ?? undefined;
}

export function timeFromMinutes(minutes: number, now: () => number = Date.now): string {
  return new Date(now() + minutes * 60_000).toISOString();
}
