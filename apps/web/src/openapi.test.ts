import { describe, expect, it } from "vitest";
import { API_SCOPES } from "@keystone/kernel";
import { API_OPERATIONS, openApiDocument } from "./openapi";
import { ROUTES, type Route } from "./routes";

/**
 * The document is only useful if it cannot drift. This test walks the real
 * route table and the operation table in both directions, so a new `/api/v1`
 * route without an entry fails, and an operation whose path no longer exists
 * fails too. The sample path is built from the same placeholder names the
 * document uses.
 */
const SAMPLE: Record<string, string> = {
  guildId: "12345678901234567",
  moduleId: "ai",
};

function samplePath(path: string): string {
  return path.replaceAll(/\{([a-zA-Z]+)\}/g, (_, name: string) => SAMPLE[name] ?? "sample");
}

function apiRoutes(): Route[] {
  // `RegExp#source` escapes `/` as `\/`; compare against the readable form.
  return ROUTES.filter((route) =>
    route.pattern.source.replaceAll("\\/", "/").startsWith("^/api/v1"),
  );
}

function matches(route: Route, method: string, path: string): boolean {
  if (route.methods && !route.methods.includes(method)) return false;
  // Reset lastIndex so a future global flag cannot make this order-dependent.
  route.pattern.lastIndex = 0;
  return route.pattern.test(path);
}

describe("API v1 OpenAPI document", () => {
  it("describes every registered /api/v1 route, and only those", () => {
    const routes = apiRoutes();
    expect(routes.length).toBeGreaterThan(0);

    for (const operation of API_OPERATIONS) {
      const path = samplePath(operation.path);
      expect(
        routes.some((route) => matches(route, operation.method, path)),
        `${operation.method} ${operation.path} has no registered route`,
      ).toBe(true);
    }

    for (const route of routes) {
      const described = API_OPERATIONS.some((operation) =>
        matches(route, operation.method, samplePath(operation.path)),
      );
      expect(described, `${route.pattern.source} is missing from API_OPERATIONS`).toBe(true);
    }

    const keys = API_OPERATIONS.map((operation) => `${operation.method} ${operation.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps the security model and scopes honest", () => {
    for (const operation of API_OPERATIONS) {
      if (operation.auth === "public") {
        expect(operation.scopes).toBeUndefined();
        continue;
      }
      expect(operation.scopes?.length, `${operation.path} has no scope`).toBeGreaterThan(0);
      for (const scope of operation.scopes ?? []) {
        expect(API_SCOPES).toContain(scope);
      }
    }

    const document = openApiDocument() as {
      openapi: string;
      paths: Record<string, Record<string, unknown>>;
      components: { securitySchemes: Record<string, unknown>; schemas: { ApiScope: { enum: string[] } } };
    };
    expect(document.openapi).toBe("3.1.0");
    expect(document.components.securitySchemes).toHaveProperty("bearerToken");
    expect(document.components.schemas.ApiScope.enum).toEqual([...API_SCOPES]);

    for (const operation of API_OPERATIONS) {
      const entry = document.paths[operation.path]?.[operation.method.toLowerCase()] as
        | { security: unknown[]; "x-keystone-scopes"?: string[] }
        | undefined;
      expect(entry, `${operation.method} ${operation.path} is missing from the document`).toBeDefined();
      if (operation.auth === "public") {
        expect(entry?.security).toEqual([]);
      } else {
        // Both principals are named wherever either one is accepted.
        expect(entry?.security.length).toBeGreaterThan(0);
        expect(entry?.["x-keystone-scopes"]).toEqual(operation.scopes);
      }
    }
  });

  it("does not describe a request body for a read", () => {
    const document = openApiDocument() as {
      paths: Record<string, Record<string, { requestBody?: unknown }>>;
    };
    for (const operation of API_OPERATIONS) {
      const entry = document.paths[operation.path]?.[operation.method.toLowerCase()];
      if (operation.method === "GET") expect(entry?.requestBody).toBeUndefined();
    }
  });
});
