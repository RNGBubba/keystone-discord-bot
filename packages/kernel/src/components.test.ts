import { describe, expect, it } from "vitest";
import {
  ComponentRouter,
  MAX_CUSTOM_ID_LENGTH,
  createComponentSigner,
  type ComponentInteractionLike,
} from "./components";
import { UserError } from "./errors";
import type { ReplyInput } from "./types";

const NOW = 1_700_000_000_000;

class FakeComponent implements ComponentInteractionLike {
  readonly kind: "button" | "select" | "modal";
  readonly customId: string;
  readonly guildId: string | null;
  readonly channelId: string | null = "chan-1";
  readonly userId = "user-1";
  readonly permissions: readonly string[];
  readonly values?: readonly string[];
  readonly fields?: Readonly<Record<string, string>>;
  readonly replies: ReplyInput[] = [];
  #replied = false;

  constructor(init: {
    kind?: "button" | "select" | "modal";
    customId: string;
    guildId?: string | null;
    permissions?: string[];
    values?: string[];
    fields?: Record<string, string>;
  }) {
    this.kind = init.kind ?? "button";
    this.customId = init.customId;
    this.guildId = init.guildId === undefined ? "guild-1" : init.guildId;
    this.permissions = init.permissions ?? [];
    this.values = init.values;
    this.fields = init.fields;
  }

  get replied(): boolean {
    return this.#replied;
  }

  async reply(input: ReplyInput): Promise<unknown> {
    this.#replied = true;
    this.replies.push(input);
    return undefined;
  }

  async update(input: ReplyInput): Promise<unknown> {
    this.replies.push(input);
    return undefined;
  }

  async followUp(input: ReplyInput): Promise<unknown> {
    this.replies.push(input);
    return undefined;
  }
}

describe("component ids", () => {
  const signer = createComponentSigner("test-secret");

  it("round-trips namespace, action, payload and expiry", () => {
    const id = signer.sign({ namespace: "form", action: "submit", payload: "form-42", ttlMs: 60_000 }, NOW);
    expect(id.length).toBeLessThanOrEqual(MAX_CUSTOM_ID_LENGTH);
    expect(signer.parse(id, NOW)).toEqual({
      ok: true,
      namespace: "form",
      action: "submit",
      payload: "form-42",
      expiresAt: NOW + 60_000,
    });
  });

  it("keeps the longest legal id inside Discord's 100 characters", () => {
    const id = signer.sign(
      {
        namespace: "a".repeat(12),
        action: "b".repeat(12),
        payload: "c".repeat(40),
        ttlMs: 7 * 24 * 60 * 60_000,
      },
      NOW,
    );
    expect(id.length).toBeLessThanOrEqual(MAX_CUSTOM_ID_LENGTH);
  });

  it("leaves foreign ids alone and refuses an expired one", () => {
    expect(signer.parse("keystone:roles:panel-1", NOW)).toEqual({ ok: false, reason: "foreign" });
    const id = signer.sign({ namespace: "form", action: "submit", ttlMs: 1_000 }, NOW);
    expect(signer.parse(id, NOW + 1_000)).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses a tampered expiry or signature instead of parsing it", () => {
    const id = signer.sign({ namespace: "form", action: "submit", payload: "f1", ttlMs: 60_000 }, NOW);
    const parts = id.split(":");
    const extended = [parts[0], parts[1], (parseInt(parts[2] as string, 36) + 3_600).toString(36), ...parts.slice(3)];
    expect(signer.parse(extended.join(":"), NOW)).toEqual({ ok: false, reason: "signature" });

    const forged = [...parts];
    forged[1] = "aaaaaaaaaaaaaaaa";
    expect(signer.parse(forged.join(":"), NOW)).toEqual({ ok: false, reason: "signature" });
  });

  it("refuses malformed ids and invalid input rather than guessing", () => {
    expect(signer.parse("k1:short", NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(signer.parse("k1:aaaaaaaaaaaaaaaa:zz:UPPER:submit:", NOW)).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(() => signer.sign({ namespace: "Form", action: "submit", ttlMs: 1_000 }, NOW)).toThrow(
      /namespace/,
    );
    expect(() => signer.sign({ namespace: "form", action: "submit", ttlMs: 0 }, NOW)).toThrow(/expire/);
  });
});

describe("ComponentRouter", () => {
  const signer = createComponentSigner("test-secret");
  const id = (action: string, payload = "", ttlMs = 60_000) =>
    signer.sign({ namespace: "form", action, payload, ttlMs }, NOW);

  it("dispatches to the matching route with the parsed payload", async () => {
    const seen: string[] = [];
    const router = new ComponentRouter().register({
      namespace: "form",
      action: "submit",
      kind: "button",
      async handle(context) {
        seen.push(`${context.payload}:${context.interaction.userId}`);
      },
    });
    const interaction = new FakeComponent({ customId: id("submit", "form-1") });
    expect(await router.dispatch(interaction, signer, NOW)).toBe(true);
    expect(seen).toEqual(["form-1:user-1"]);
  });

  it("returns false for another feature's id and for an unregistered route", async () => {
    const router = new ComponentRouter().register({
      namespace: "form",
      action: "submit",
      kind: "button",
      async handle() {
        throw new Error("should not run");
      },
    });
    expect(await router.dispatch(new FakeComponent({ customId: "keystone:roles:p1" }), signer, NOW)).toBe(
      false,
    );
    expect(await router.dispatch(new FakeComponent({ customId: id("other") }), signer, NOW)).toBe(false);
  });

  it("refuses an expired interaction without running the handler", async () => {
    let ran = false;
    const router = new ComponentRouter().register({
      namespace: "form",
      action: "submit",
      kind: "button",
      async handle() {
        ran = true;
      },
    });
    const interaction = new FakeComponent({ customId: id("submit", "", 1_000) });
    expect(await router.dispatch(interaction, signer, NOW + 1_000)).toBe(true);
    expect(ran).toBe(false);
    expect(interaction.replies[0]?.content).toMatch(/expired/);
  });

  it("enforces the route's permission and guild gates", async () => {
    const router = new ComponentRouter().register({
      namespace: "form",
      action: "review",
      kind: "button",
      permissions: ["ManageGuild"],
      guildOnly: true,
      async handle() {
        throw new Error("should not run");
      },
    });

    const member = new FakeComponent({ customId: id("review") });
    await router.dispatch(member, signer, NOW);
    expect(member.replies[0]?.content).toMatch(/permission/);

    const staff = new FakeComponent({ customId: id("review"), permissions: ["ManageGuild"], guildId: null });
    await router.dispatch(staff, signer, NOW);
    expect(staff.replies[0]?.content).toMatch(/inside a server/);
  });

  it("turns a handler's UserError into an ephemeral reply and rethrows real bugs", async () => {
    const router = new ComponentRouter()
      .register({
        namespace: "form",
        action: "submit",
        kind: "modal",
        async handle() {
          throw new UserError("Answer every required question.");
        },
      })
      .register({
        namespace: "form",
        action: "crash",
        kind: "button",
        async handle() {
          throw new Error("bug");
        },
      });

    const modal = new FakeComponent({ kind: "modal", customId: id("submit") });
    await router.dispatch(modal, signer, NOW);
    expect(modal.replies[0]).toEqual({
      content: "Answer every required question.",
      ephemeral: true,
    });

    await expect(router.dispatch(new FakeComponent({ customId: id("crash") }), signer, NOW)).rejects.toThrow(
      "bug",
    );
  });
});
