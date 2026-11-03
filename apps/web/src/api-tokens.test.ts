import { describe, expect, it } from "vitest";
import { API_SCOPES, InMemoryApiTokenStore, tokenIsActive } from "@keystone/kernel";
import { API_TOKEN_PREFIX, ApiTokenService, parseTokenScopes } from "./api-tokens";
import { sha256 } from "./crypto";

const GUILD = "12345678901234567";

function clockAt(iso: string): { now: () => number; advance: (ms: number) => void } {
  let current = Date.parse(iso);
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe("scoped API tokens", () => {
  it("shows the secret once and stores only its SHA-256 hash", async () => {
    const store = new InMemoryApiTokenStore();
    const service = new ApiTokenService(store, () => Date.parse("2026-11-03T00:00:00.000Z"));
    const issued = await service.issue({
      guildId: GUILD,
      guildName: "Probe",
      name: "deploy",
      scopes: ["guild:read"],
      createdBy: "user-1",
    });

    expect(issued.secret.startsWith(API_TOKEN_PREFIX)).toBe(true);
    expect(issued.secret.length).toBeGreaterThan(30);
    expect(issued.record.tokenHash).toBe(sha256(issued.secret));
    expect(JSON.stringify(issued.record)).not.toContain(issued.secret);

    const [listed] = await service.list(GUILD);
    expect(listed?.tokenHash).toBe(sha256(issued.secret));
    expect(listed?.lastUsedAt).toBeUndefined();

    const authenticated = await service.authenticate(issued.secret);
    expect(authenticated).toMatchObject({ id: issued.record.id, scopes: ["guild:read"] });

    // The first successful use is stamped; the store never sees the secret.
    const [touched] = await service.list(GUILD);
    expect(touched?.lastUsedAt).toBe("2026-11-03T00:00:00.000Z");
  });

  it("refuses an unknown scope, no scope, a bad lifetime and a bad name", async () => {
    const service = new ApiTokenService(new InMemoryApiTokenStore());
    const base = { guildId: GUILD, guildName: "Probe", name: "deploy" };

    await expect(service.issue({ ...base, scopes: ["guild:admin"] })).rejects.toMatchObject({
      status: 400,
      code: "token_scope_invalid",
    });
    await expect(service.issue({ ...base, scopes: [] })).rejects.toMatchObject({
      status: 400,
      code: "token_scope_missing",
    });
    await expect(service.issue({ ...base, scopes: ["guild:read"], expiresInDays: 0 })).rejects.toMatchObject({
      status: 400,
      code: "token_expiry_invalid",
    });
    await expect(service.issue({ ...base, name: "   ", scopes: ["guild:read"] })).rejects.toMatchObject({
      status: 400,
      code: "token_name_missing",
    });
    await expect(
      service.issue({ ...base, name: "x".repeat(81), scopes: ["guild:read"] }),
    ).rejects.toMatchObject({ status: 400, code: "token_name_too_long" });

    expect(await service.list(GUILD)).toEqual([]);
  });

  it("deduplicates scopes and accepts exactly the three declared scopes", () => {
    expect(parseTokenScopes(["guild:read", "guild:read", "analytics:read"])).toEqual([
      "guild:read",
      "analytics:read",
    ]);
    expect(API_SCOPES).toEqual(["guild:read", "analytics:read", "settings:write"]);
  });

  it("rejects malformed, unknown, revoked and expired secrets", async () => {
    const clock = clockAt("2026-11-03T00:00:00.000Z");
    const service = new ApiTokenService(new InMemoryApiTokenStore(), clock.now);

    expect(await service.authenticate("not-a-token")).toBeUndefined();
    expect(await service.authenticate(`${API_TOKEN_PREFIX}short`)).toBeUndefined();

    const issued = await service.issue({
      guildId: GUILD,
      guildName: "Probe",
      name: "deploy",
      scopes: ["guild:read"],
      expiresInDays: 1,
    });
    clock.advance(2 * 24 * 60 * 60_000);
    expect(await service.authenticate(issued.secret)).toBeUndefined();
    expect(tokenIsActive(issued.record, clock.now())).toBe(false);
  });

  it("revokes once: a second revocation writes nothing", async () => {
    const service = new ApiTokenService(new InMemoryApiTokenStore());
    const issued = await service.issue({
      guildId: GUILD,
      guildName: "Probe",
      name: "deploy",
      scopes: ["guild:read"],
    });

    const first = await service.revoke(GUILD, issued.record.id);
    expect(first?.revokedAt).toBeTruthy();
    expect(await service.revoke(GUILD, issued.record.id)).toBeUndefined();
    expect(await service.revoke("99999999999999999", issued.record.id)).toBeUndefined();
    expect(await service.authenticate(issued.secret)).toBeUndefined();
  });
});
