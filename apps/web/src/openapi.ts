import { API_SCOPES, type ApiScope } from "@keystone/kernel";

/**
 * The OpenAPI document is generated from this table, and a test compares the
 * table with the registered `/api/v1` routes. A new route without an entry (or a
 * stale entry without a route) fails the suite, so the document describes the
 * surface that exists instead of a hand-maintained wish.
 */

export type ApiAuth = "public" | "session" | "session-or-token";

export interface ApiOperation {
  readonly method: "GET" | "PATCH";
  /** OpenAPI path template, e.g. `/api/v1/guilds/{guildId}/analytics`. */
  readonly path: string;
  readonly summary: string;
  readonly auth: ApiAuth;
  /** Scopes a bearer token may use. Absent for session-only routes. */
  readonly scopes?: readonly ApiScope[];
  readonly parameters?: readonly {
    readonly name: string;
    readonly in: "path" | "query" | "header";
    readonly required: boolean;
    readonly description: string;
  }[];
  readonly requestBody?: { readonly description: string };
  /** Adds a 409 response for a reused Idempotency-Key. */
  readonly conflicts?: boolean;
}

export const API_OPERATIONS: readonly ApiOperation[] = [
  {
    method: "GET",
    path: "/api/v1/openapi.json",
    summary: "This document, generated from the same table as the routes.",
    auth: "public",
  },
  {
    method: "GET",
    path: "/api/v1/me",
    summary: "The signed-in user, or the identity of the bearer token.",
    auth: "session-or-token",
    scopes: ["guild:read"],
  },
  {
    method: "GET",
    path: "/api/v1/guilds",
    summary:
      "Guilds the session user can manage; a bearer token sees only the guild it is scoped to.",
    auth: "session-or-token",
    scopes: ["guild:read"],
  },
  {
    method: "GET",
    path: "/api/v1/guilds/{guildId}/overview",
    summary: "Guild counts, module settings and the latest import receipt.",
    auth: "session-or-token",
    scopes: ["guild:read"],
    parameters: [
      { name: "guildId", in: "path", required: true, description: "Discord guild id." },
    ],
  },
  {
    method: "GET",
    path: "/api/v1/guilds/{guildId}/analytics",
    summary: "Bounded aggregates over the existing audit, case, invite, ticket and command ledgers.",
    auth: "session-or-token",
    scopes: ["analytics:read"],
    parameters: [
      { name: "guildId", in: "path", required: true, description: "Discord guild id." },
      {
        name: "days",
        in: "query",
        required: false,
        description: "Window in days, 1–90. Defaults to 7.",
      },
    ],
  },
  {
    method: "PATCH",
    path: "/api/v1/guilds/{guildId}/settings/{moduleId}",
    summary:
      "Update one module's settings through the module's own Zod schema. Session writes also require X-Keystone-CSRF.",
    auth: "session-or-token",
    scopes: ["settings:write"],
    parameters: [
      { name: "guildId", in: "path", required: true, description: "Discord guild id." },
      { name: "moduleId", in: "path", required: true, description: "Registered module id." },
      {
        name: "X-Keystone-CSRF",
        in: "header",
        required: false,
        description: "Session writes only; bearer tokens do not use CSRF.",
      },
      {
        name: "Idempotency-Key",
        in: "header",
        required: false,
        description:
          "8–128 characters. A retry with the same key and body replays the stored response; a different body is refused at 409.",
      },
    ],
    requestBody: { description: "A partial module settings object." },
    conflicts: true,
  },
];

function security(auth: ApiAuth): readonly Record<string, readonly string[]>[] {
  if (auth === "public") return [];
  if (auth === "session") return [{ sessionCookie: [] }];
  return [{ sessionCookie: [] }, { bearerToken: [] }];
}

export function openApiDocument(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const operation of API_OPERATIONS) {
    const entry: Record<string, unknown> = {
      summary: operation.summary,
      operationId: `${operation.method.toLowerCase()}_${operation.path
        .replace(/^\/api\/v1\/?/, "")
        .replaceAll("/", "_")
        .replaceAll(/[{}]/g, "") || "root"}`,
      security: security(operation.auth),
      parameters: [
        ...(operation.parameters ?? []).map((parameter) => ({
          name: parameter.name,
          in: parameter.in,
          required: parameter.required,
          description: parameter.description,
          schema:
            parameter.in === "query"
              ? { type: "integer", minimum: 1, maximum: 90 }
              : { type: "string" },
        })),
      ],
      responses: {
        "200": { description: "The requested representation." },
        "400": { $ref: "#/components/responses/BadRequest" },
        "401": { $ref: "#/components/responses/Unauthenticated" },
        "403": { $ref: "#/components/responses/Forbidden" },
        "404": { $ref: "#/components/responses/NotFound" },
        "429": { $ref: "#/components/responses/RateLimited" },
        ...(operation.conflicts
          ? { "409": { $ref: "#/components/responses/Conflict" } }
          : {}),
      },
      ...(operation.scopes
        ? {
            "x-keystone-scopes": operation.scopes,
          }
        : {}),
      ...(operation.requestBody
        ? {
            requestBody: {
              required: true,
              description: operation.requestBody.description,
              content: {
                "application/json": {
                  schema: { type: "object", additionalProperties: true },
                },
              },
            },
          }
        : {}),
    };
    if (operation.method === "GET") delete (entry as Record<string, unknown>).requestBody;
    paths[operation.path] ??= {};
    paths[operation.path]![operation.method.toLowerCase()] = entry;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Keystone API v1",
      version: "1.0.0",
      description:
        "Session-cookie access for the dashboard, and guild-scoped bearer tokens for automation. token scopes are listed on each operation as x-keystone-scopes.",
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: {
        sessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: "keystone_session",
          description: "The opaque dashboard session cookie, obtained through Discord OAuth.",
        },
        bearerToken: {
          type: "http",
          scheme: "bearer",
          description:
            "An issued `keystone_…` token. It is bound to one guild and can only exercise its scopes.",
        },
      },
      schemas: {
        ApiScope: {
          type: "string",
          enum: [...API_SCOPES],
        },
        Error: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message"],
              properties: {
                code: { type: "string" },
                message: { type: "string" },
              },
            },
          },
        },
        TokenIdentity: {
          type: "object",
          properties: {
            token: {
              type: "object",
              properties: {
                id: { type: "string", format: "uuid" },
                name: { type: "string" },
                guildId: { type: "string" },
                scopes: { type: "array", items: { $ref: "#/components/schemas/ApiScope" } },
                expiresAt: { type: "string", format: "date-time" },
              },
            },
          },
        },
      },
      responses: {
        BadRequest: {
          description: "The request is invalid.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
        Unauthenticated: {
          description: "No session and no valid bearer token.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
        Forbidden: {
          description: "The principal may not read or write this guild, or lacks the route scope.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
        NotFound: {
          description: "No such API route.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
        Conflict: {
          description:
            "The Idempotency-Key was already used with a different body, or the first request is still in flight.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
        RateLimited: {
          description: "The caller passed its route-class or per-token fixed window.",
          headers: {
            "Retry-After": {
              description: "Seconds until the current window ends.",
              schema: { type: "integer" },
            },
          },
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
      },
    },
    paths,
  };
}
