import type { RouteContext } from "../request-context";
import * as api from "./api";
import * as auth from "./auth";
import * as dashboard from "./dashboard";
import * as instance from "./instance";
import * as tokens from "./tokens";

export type RouteHandler = (
  ctx: RouteContext,
  params: readonly string[],
) => Promise<boolean>;

export interface Route {
  readonly pattern: RegExp;
  readonly methods?: readonly string[];
  readonly handler: RouteHandler;
}

const GUILD_ID = String.raw`(\d{15,20})`;
const MODULE_ID = String.raw`([a-z][a-z0-9-]{1,31})`;
const TEMPLATE_ID = String.raw`([0-9a-fA-F-]{36})`;
const TOKEN_ID = TEMPLATE_ID;
const exact = (path: string): RegExp => new RegExp(`^${path}$`);

export const ROUTES: readonly Route[] = [
  { pattern: exact("/healthz"), methods: ["GET"], handler: auth.health },
  { pattern: exact("/login"), methods: ["GET"], handler: auth.login },
  { pattern: exact("/auth/callback"), methods: ["GET"], handler: auth.oauthCallback },
  { pattern: exact("/logout"), methods: ["POST"], handler: auth.logout },
  { pattern: exact("/"), methods: ["GET"], handler: auth.landing },
  { pattern: exact("/dashboard"), methods: ["GET"], handler: dashboard.dashboardList },
  { pattern: exact("/dashboard/fleet"), methods: ["GET"], handler: dashboard.fleet },
  {
    pattern: exact("/dashboard/fleet/preview"),
    methods: ["POST"],
    handler: dashboard.fleetPreview,
  },
  {
    pattern: exact("/dashboard/fleet/apply"),
    methods: ["POST"],
    handler: dashboard.fleetApply,
  },
  { pattern: exact("/dashboard/instance"), methods: ["GET"], handler: instance.instancePage },
  {
    pattern: exact("/dashboard/instance/sessions/revoke"),
    methods: ["POST"],
    handler: instance.instanceRevokeSessions,
  },
  {
    pattern: exact(`/dashboard/guilds/${GUILD_ID}/config/export`),
    methods: ["GET"],
    handler: dashboard.configExport,
  },
  {
    pattern: exact(`/dashboard/guilds/${GUILD_ID}/config/drift`),
    methods: ["GET"],
    handler: dashboard.configDriftPage,
  },
  {
    pattern: exact(`/dashboard/guilds/${GUILD_ID}/config/import/preview`),
    methods: ["POST"],
    handler: dashboard.configImportPreview,
  },
  {
    pattern: exact(`/dashboard/guilds/${GUILD_ID}/config/import/apply`),
    methods: ["POST"],
    handler: dashboard.configImportApply,
  },
  {
    pattern: exact(`/dashboard/guilds/${GUILD_ID}`),
    methods: ["GET"],
    handler: dashboard.guildOverview,
  },
  {
    pattern: exact(`/dashboard/guilds/${GUILD_ID}/analytics`),
    methods: ["GET"],
    handler: dashboard.analyticsPage,
  },
  {
    pattern: exact(`/dashboard/guilds/${GUILD_ID}/settings/${MODULE_ID}`),
    handler: dashboard.settingsPage,
  },
  {
    pattern: exact(`/dashboard/guilds/${GUILD_ID}/templates`),
    methods: ["GET"],
    handler: dashboard.templatesPage,
  },
  {
    pattern: exact(`/dashboard/guilds/${GUILD_ID}/templates`),
    methods: ["POST"],
    handler: dashboard.templateCreate,
  },
  {
    pattern: exact(`/dashboard/guilds/${GUILD_ID}/templates/${TEMPLATE_ID}`),
    methods: ["GET"],
    handler: dashboard.templateEditorPage,
  },
  {
    pattern: exact(`/dashboard/guilds/${GUILD_ID}/templates/${TEMPLATE_ID}`),
    methods: ["POST"],
    handler: dashboard.templateUpdate,
  },
  {
    pattern: exact(`/dashboard/guilds/${GUILD_ID}/templates/${TEMPLATE_ID}/delete`),
    methods: ["POST"],
    handler: dashboard.templateDelete,
  },
  {
    pattern: exact(`/dashboard/guilds/${GUILD_ID}/templates/${TEMPLATE_ID}/preview`),
    methods: ["POST"],
    handler: dashboard.templatePreview,
  },
  {
    pattern: exact(`/dashboard/guilds/${GUILD_ID}/templates/${TEMPLATE_ID}/apply`),
    methods: ["POST"],
    handler: dashboard.templateApply,
  },
  {
    pattern: exact(`/dashboard/guilds/${GUILD_ID}/tokens`),
    methods: ["GET"],
    handler: tokens.tokensPage,
  },
  {
    pattern: exact(`/dashboard/guilds/${GUILD_ID}/tokens`),
    methods: ["POST"],
    handler: tokens.tokenCreate,
  },
  {
    pattern: exact(`/dashboard/guilds/${GUILD_ID}/tokens/${TOKEN_ID}/revoke`),
    methods: ["POST"],
    handler: tokens.tokenRevoke,
  },
  { pattern: exact("/api/v1/openapi.json"), methods: ["GET"], handler: api.openapi },
  { pattern: exact("/api/v1/me"), methods: ["GET"], handler: api.me },
  { pattern: exact("/api/v1/guilds"), methods: ["GET"], handler: api.guilds },
  {
    pattern: exact(`/api/v1/guilds/${GUILD_ID}/overview`),
    methods: ["GET"],
    handler: api.overview,
  },
  {
    pattern: exact(`/api/v1/guilds/${GUILD_ID}/analytics`),
    methods: ["GET"],
    handler: api.analytics,
  },
  {
    pattern: exact(`/api/v1/guilds/${GUILD_ID}/settings/${MODULE_ID}`),
    methods: ["PATCH"],
    handler: api.settings,
  },
  { pattern: /^\/api\//, handler: api.notFound },
];

/**
 * First matching route wins, in the order above. A handler returns false only
 * when it wants the normal method/not-found fallback to continue; the settings
 * page does that after preserving its authorization-before-fallthrough order.
 */
export async function dispatchRoutes(ctx: RouteContext): Promise<boolean> {
  for (const route of ROUTES) {
    if (route.methods && !route.methods.includes(ctx.method)) continue;
    const match = route.pattern.exec(ctx.path);
    if (!match) continue;
    if (await route.handler(ctx, match.slice(1))) return true;
  }
  return false;
}
