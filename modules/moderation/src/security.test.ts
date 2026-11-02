import { describe, expect, it } from "vitest";
import {
  createSilentLogger,
  type ModerationActions,
  type ModerationActionResult,
  type ModerationNotice,
} from "@keystone/kernel";
import { createTestSettings } from "@keystone/testing";
import { CaseService, InMemoryCaseStore } from "./cases";
import { InMemoryMemberStore } from "./members";
import { SecurityCoordinator, SecurityEngine } from "./security";
import { moderationSettingsSchema } from "./settings";
import { buildNativeAutoModPlan } from "./native-automod";

class RecordingActions implements ModerationActions {
  readonly calls: string[] = [];
  readonly notifications: {
    guildId: string;
    channelId: string | null | undefined;
    notice: ModerationNotice;
  }[] = [];

  private ok(): Promise<ModerationActionResult> {
    return Promise.resolve({ ok: true });
  }

  ban(): Promise<ModerationActionResult> {
    this.calls.push("ban");
    return this.ok();
  }

  unban(): Promise<ModerationActionResult> {
    this.calls.push("unban");
    return this.ok();
  }

  addRole(): Promise<ModerationActionResult> {
    this.calls.push("add-role");
    return this.ok();
  }

  removeRole(): Promise<ModerationActionResult> {
    this.calls.push("remove-role");
    return this.ok();
  }

  kick(): Promise<ModerationActionResult> {
    this.calls.push("kick");
    return this.ok();
  }

  timeout(): Promise<ModerationActionResult> {
    this.calls.push("timeout");
    return this.ok();
  }

  purge(): Promise<ModerationActionResult> {
    this.calls.push("purge");
    return this.ok();
  }

  lock(): Promise<ModerationActionResult> {
    this.calls.push("lock");
    return this.ok();
  }

  slowmode(): Promise<ModerationActionResult> {
    this.calls.push("slowmode");
    return this.ok();
  }

  deleteMessage(): Promise<ModerationActionResult> {
    this.calls.push("delete-message");
    return this.ok();
  }

  deleteWebhook(): Promise<ModerationActionResult> {
    this.calls.push("delete-webhook");
    return this.ok();
  }

  quarantine(): Promise<ModerationActionResult> {
    this.calls.push("quarantine");
    return this.ok();
  }

  unquarantine(): Promise<ModerationActionResult> {
    this.calls.push("unquarantine");
    return this.ok();
  }

  async notify(
    guildId: string,
    channelId: string | null | undefined,
    notice: ModerationNotice,
  ): Promise<void> {
    this.notifications.push({ guildId, channelId, notice });
  }

  directMessage(): Promise<ModerationActionResult> {
    this.calls.push("direct-message");
    return this.ok();
  }
}

function coordinator(settings: Record<string, unknown>): {
  coordinator: SecurityCoordinator;
  actions: RecordingActions;
  cases: CaseService;
  store: InMemoryCaseStore;
  members: InMemoryMemberStore;
} {
  const store = new InMemoryCaseStore();
  const cases = new CaseService(store);
  const actions = new RecordingActions();
  const members = new InMemoryMemberStore();
  return {
    store,
    cases,
    actions,
    members,
    coordinator: new SecurityCoordinator({
      engine: new SecurityEngine(),
      cases,
      actions,
      members,
      settings: createTestSettings(settings),
      logger: createSilentLogger(),
      now: () => 1_000,
    }),
  };
}

const ENFORCING = {
  dryRun: false,
  modLogChannelId: "mod-log",
  quarantineRoleId: "role-quarantine",
  automod: { invites: "timeout" },
};

describe("scripted raid", () => {
  it("contains 10 joins, 5 invite posts and one webhook, with a case for every action", async () => {
    const { coordinator: security, actions, cases, members } = coordinator(ENFORCING);

    for (let index = 0; index < 10; index += 1) {
      await security.handle({
        type: "member.join",
        guildId: "guild-raid",
        userId: `joiner-${index}`,
        accountAgeDays: 1,
        hasAvatar: false,
        at: 1_000 + index,
      });
    }
    for (let index = 0; index < 5; index += 1) {
      await security.handle({
        type: "message.create",
        guildId: "guild-raid",
        channelId: "general",
        messageId: `message-${index}`,
        userId: "inviter",
        content: `join discord.gg/raid-${index}`,
        at: 2_000 + index,
      });
    }
    await security.handle({
      type: "webhook.create",
      guildId: "guild-raid",
      channelId: "general",
      webhookId: "webhook-1",
      userId: "attacker",
      at: 3_000,
    });

    // The raid is contained, but anti-raid holds are moderator actions, not
    // join-gate verification rows.
    expect(actions.calls.filter((call) => call === "quarantine")).toHaveLength(11);
    expect(await members.get("guild-raid", "joiner-0")).toBeUndefined();
    expect(await members.get("guild-raid", "attacker")).toBeUndefined();
    expect(
      actions.notifications.some((notification) =>
        notification.notice.components?.some((row) =>
          row.components.some((component) => component.customId.startsWith("keystone:verify:")),
        ),
      ),
    ).toBe(false);
    expect(actions.calls.filter((call) => call === "delete-message")).toHaveLength(5);
    expect(actions.calls.filter((call) => call === "delete-webhook")).toHaveLength(1);
    expect(actions.calls.filter((call) => call === "timeout")).toHaveLength(1);

    const records = await cases.list("guild-raid", { limit: 100 });
    expect(records.length).toBe(20);
    expect(new Set(records.map((record) => record.caseNumber)).size).toBe(records.length);
    expect(records.every((record) => record.reason.length > 0)).toBe(true);
    expect(records.every((record) => record.caseNumber > 0)).toBe(true);

    // Every alert/action has the same appeal affordance.
    expect(actions.notifications).toHaveLength(20);
    expect(
      actions.notifications.every((notification) => {
        const row = notification.notice.components?.[0];
        return row?.components[0]?.customId.startsWith("keystone:appeal:") === true;
      }),
    ).toBe(true);
  });

  it("takes no punitive action in the default dry-run, but records alerts", async () => {
    const { coordinator: security, actions, cases, members } = coordinator({});

    for (let index = 0; index < 10; index += 1) {
      await security.handle({
        type: "member.join",
        guildId: "guild-dry",
        userId: `joiner-${index}`,
        accountAgeDays: 1,
        hasAvatar: false,
        at: 1_000 + index,
      });
    }

    expect(actions.calls).toEqual([]);
    expect(actions.notifications.length).toBeGreaterThan(0);
    const records = await cases.list("guild-dry", { limit: 100 });
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((record) => record.state === "alerted")).toBe(true);
    expect(await members.get("guild-dry", "joiner-0")).toBeUndefined();
  });

  it("persists a quarantined row only for an enforced join-gate hold", async () => {
    const { coordinator: security, members, actions } = coordinator({
      dryRun: false,
      joinGate: { enabled: true, minAccountAgeDays: 7 },
    });

    await security.handle({
      type: "member.join",
      guildId: "guild-gate",
      userId: "young",
      accountAgeDays: 1,
      hasAvatar: true,
      at: 1_000,
    });
    await security.handle({
      type: "member.join",
      guildId: "guild-gate",
      userId: "old-enough",
      accountAgeDays: 30,
      hasAvatar: true,
      at: 1_001,
    });

    expect(await members.get("guild-gate", "young")).toMatchObject({
      quarantined: true,
      verifiedAt: undefined,
    });
    expect(await members.get("guild-gate", "old-enough")).toBeUndefined();
    expect(
      actions.notifications.some((notification) =>
        notification.notice.components?.some((row) =>
          row.components.some((component) => component.customId.startsWith("keystone:verify:")),
        ),
      ),
    ).toBe(true);
  });

  it("does not mistake a single join for a raid", () => {
    const engine = new SecurityEngine();
    const settings = moderationSettingsSchema.parse({ antiRaid: { joinsPerWindow: 10 } });
    const findings = engine.evaluate(
      {
        type: "member.join",
        guildId: "guild-calm",
        userId: "one",
        accountAgeDays: 100,
        hasAvatar: true,
      },
      settings,
      1_000,
    );
    expect(findings).toEqual([]);
  });
});

describe("link filter", () => {
  const event = (content: string) =>
    ({
      type: "message.create" as const,
      guildId: `guild-link-${Math.random()}`,
      channelId: "general",
      messageId: "message-1",
      userId: "member-1",
      content,
    }) as const;

  it("does nothing when the filter is off", () => {
    const engine = new SecurityEngine();
    const settings = moderationSettingsSchema.parse({
      automod: { linkBlocklist: ["phish.test"] },
    });
    expect(engine.evaluate(event("https://phish.test/login"), settings, 1_000)).toEqual([]);
  });

  it("alerts on a blocklisted host and its subdomains", () => {
    const engine = new SecurityEngine();
    const settings = moderationSettingsSchema.parse({
      automod: { links: "alert", linkBlocklist: ["phish.test"] },
    });
    const findings = engine.evaluate(
      event("open https://login.phish.test/verify"),
      settings,
      1_000,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: "alert",
      rule: "automod.link",
      targetId: "member-1",
      evidence: { host: "login.phish.test", match: "blocklist" },
    });
  });

  it("deletes when configured and flags punycode without a list", () => {
    const engine = new SecurityEngine();
    const settings = moderationSettingsSchema.parse({
      automod: { links: "delete" },
    });
    const findings = engine.evaluate(
      event("verify at https://xn--pple-43d.test/login"),
      settings,
      1_000,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: "delete-message",
      rule: "automod.link",
      evidence: { host: "xn--pple-43d.test", match: "punycode" },
    });
  });

  it("does not flag an ordinary link", () => {
    const engine = new SecurityEngine();
    const settings = moderationSettingsSchema.parse({
      automod: { links: "delete", linkBlocklist: ["phish.test"] },
    });
    expect(engine.evaluate(event("read https://example.com/docs"), settings, 1_000)).toEqual([]);
  });
});

describe("profanity and zalgo filter", () => {
  const event = (content: string) =>
    ({
      type: "message.create" as const,
      guildId: `guild-words-${Math.random()}`,
      channelId: "general",
      messageId: "message-2",
      userId: "member-2",
      content,
    }) as const;

  it("does nothing when profanity is off", () => {
    const engine = new SecurityEngine();
    const settings = moderationSettingsSchema.parse({
      automod: { bannedWords: ["pineapple"] },
    });
    expect(engine.evaluate(event("pineapple pizza"), settings, 1_000)).toEqual([]);
  });

  it("matches whole words, not substrings", () => {
    const engine = new SecurityEngine();
    const settings = moderationSettingsSchema.parse({
      automod: { profanity: "alert", bannedWords: ["ass"] },
    });
    expect(engine.evaluate(event("a classic assignment"), settings, 1_000)).toEqual([]);

    const findings = engine.evaluate(event("you ass"), settings, 1_000);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: "alert",
      rule: "automod.profanity",
      evidence: { match: "ass" },
    });
  });

  it("is case-insensitive and keeps a phrase flexible", () => {
    const engine = new SecurityEngine();
    const settings = moderationSettingsSchema.parse({
      automod: { profanity: "alert", bannedWords: ["bad phrase"] },
    });
    const findings = engine.evaluate(event("A BAD   phrase appears"), settings, 1_000);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence.match).toBe("BAD   phrase");
  });

  it("deletes in delete mode", () => {
    const engine = new SecurityEngine();
    const settings = moderationSettingsSchema.parse({
      automod: { profanity: "delete", bannedWords: ["pineapple"] },
    });
    const findings = engine.evaluate(event("pineapple"), settings, 1_000);
    expect(findings[0]).toMatchObject({
      kind: "delete-message",
      rule: "automod.profanity",
      channelId: "general",
      messageId: "message-2",
    });
  });

  it("flags excessive combining marks as zalgo", () => {
    const engine = new SecurityEngine();
    const settings = moderationSettingsSchema.parse({
      automod: { zalgo: "alert", zalgoThreshold: 3 },
    });
    const findings = engine.evaluate(event("z\u0338\u0338\u0338a"), settings, 1_000);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: "alert",
      rule: "automod.zalgo",
      evidence: { combiningMarks: 3, threshold: 3 },
    });
  });

  it("leaves zalgo alone when the threshold is not met or the filter is off", () => {
    const engine = new SecurityEngine();
    const alerting = moderationSettingsSchema.parse({
      automod: { zalgo: "alert", zalgoThreshold: 8 },
    });
    expect(engine.evaluate(event("z\u0338a"), alerting, 1_000)).toEqual([]);

    const off = moderationSettingsSchema.parse({ automod: {} });
    expect(engine.evaluate(event("z\u0338\u0338\u0338\u0338a"), off, 1_000)).toEqual([]);
  });
});

describe("native AutoMod plan", () => {
  it("only manages prefixed rules and includes an alert action when a log channel is set", () => {
    const settings = moderationSettingsSchema.parse({
      nativeAutoMod: { sync: true },
      modLogChannelId: "mod-log",
    });
    const plan = buildNativeAutoModPlan(settings);

    expect(plan).toHaveLength(2);
    expect(plan.every((rule) => rule.name.startsWith("Keystone ·"))).toBe(true);
    expect(plan[0]?.actions.map((action) => action.type)).toEqual([
      "BLOCK_MESSAGE",
      "SEND_ALERT_MESSAGE",
    ]);
  });

  it("does nothing until the operator explicitly enables sync", () => {
    expect(buildNativeAutoModPlan(moderationSettingsSchema.parse({}))).toEqual([]);
  });
});
