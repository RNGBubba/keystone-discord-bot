import { describe, expect, it } from "vitest";
import {
  createComponentSigner,
  createSilentLogger,
  type ComponentInteractionLike,
  type ComponentSigner,
  type ModerationPort,
  type ModalSpec,
  type ReplyInput,
} from "@keystone/kernel";
import { t } from "@keystone/i18n";
import {
  InMemoryFormStore,
  FormService,
  formDefaultSettings,
  formModal,
  formPanel,
} from "@keystone/module-forms";
import {
  ContentService,
  GiveawayService,
  InMemoryCommunityStore,
  ReactionRoleService,
  SuggestionService,
  communitySettingsSchema,
} from "@keystone/module-community";
import {
  RecordingCommunityActions,
  firstRow,
} from "@keystone/module-community/testing";
import { createComponentRouter, type ComponentRuntimeDeps } from "./components";

const NOW = 1_800_000_000_000;
const GUILD = "g1";

class FakeComponent implements ComponentInteractionLike {
  readonly kind: "button" | "select" | "modal";
  readonly customId: string;
  readonly guildId: string;
  readonly channelId = "chan-1";
  readonly userId: string;
  readonly permissions: readonly string[];
  readonly values?: readonly string[];
  readonly fields?: Readonly<Record<string, string>>;
  readonly replies: ReplyInput[] = [];
  modal?: ModalSpec;
  #replied = false;

  constructor(init: {
    kind?: "button" | "select" | "modal";
    customId: string;
    guildId?: string;
    userId?: string;
    permissions?: string[];
    values?: string[];
    fields?: Record<string, string>;
  }) {
    this.kind = init.kind ?? "button";
    this.customId = init.customId;
    this.guildId = init.guildId ?? GUILD;
    this.userId = init.userId ?? "member-1";
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

  async showModal(modal: ModalSpec): Promise<unknown> {
    this.modal = modal;
    return undefined;
  }
}

async function fixture(fieldSpec = "why:Why join, tz:Timezone") {
  const store = new InMemoryFormStore();
  const service = new FormService(store, formDefaultSettings, () => NOW);
  const form = await service.create(GUILD, "staff-1", {
    name: "Staff application",
    key: "staff",
    fields: fieldSpec,
  });
  await service.edit(GUILD, form.key, { state: "open" });

  const settings = {
    get: async () => ({ ...formDefaultSettings }),
    update: async () => ({ ...formDefaultSettings }),
  };
  const signer: ComponentSigner = createComponentSigner("bot-test-secret");
  const communityStore = new InMemoryCommunityStore();
  const communityActions = new RecordingCommunityActions();
  const communitySettings = {
    get: async () => communitySettingsSchema.parse({}),
    update: async () => communitySettingsSchema.parse({}),
  };
  const deps: ComponentRuntimeDeps = {
    signer,
    forms: store,
    formSettings: settings,
    moderation: { settings, moderation: {} as ModerationPort },
    community: {
      store: communityStore,
      actions: communityActions,
      settings: communitySettings,
    },
    logger: createSilentLogger(),
    now: () => NOW,
  };
  const router = createComponentRouter(deps);
  const signed = (action: string, payload: string, ttlMs = 15 * 60_000): string =>
    signer.sign({ namespace: "form", action, payload, ttlMs }, NOW);
  return { store, service, form, router, signer, signed, communityStore, communityActions };
}

describe("form panel components", () => {
  it("opens a signed modal from the Apply button and files the answers", async () => {
    const { store, router, signed } = await fixture();

    const apply = new FakeComponent({ customId: signed("apply", "staff"), userId: "member-1" });
    expect(await router.dispatch(apply, createComponentSigner("bot-test-secret"), NOW)).toBe(true);
    expect(apply.modal?.title).toBe("Staff application");
    expect(apply.modal?.components.map((input) => input.customId)).toEqual(["why", "tz"]);

    const parsed = createComponentSigner("bot-test-secret").parse(apply.modal?.customId ?? "", NOW);
    expect(parsed).toMatchObject({ ok: true, action: "submit", payload: "staff" });

    const submit = new FakeComponent({
      kind: "modal",
      customId: apply.modal?.customId ?? "",
      userId: "member-1",
      fields: { why: " I like helping ", tz: "UTC+2" },
    });
    await router.dispatch(submit, createComponentSigner("bot-test-secret"), NOW);
    expect(submit.replies[0]?.content).toMatch(/Submission received/);
    expect(await store.countSubmissions(GUILD)).toBe(1);
    const [stored] = await store.listSubmissions(GUILD, { state: "submitted" });
    expect(stored?.answers).toEqual({ why: "I like helping", tz: "UTC+2" });
  });

  it("re-prompts a bad modal submit and writes nothing", async () => {
    const { store, router, signed } = await fixture();
    const submit = new FakeComponent({
      kind: "modal",
      customId: signed("submit", "staff"),
      fields: { why: "I like helping" },
    });
    await router.dispatch(submit, createComponentSigner("bot-test-secret"), NOW);
    expect(submit.replies[0]).toEqual({
      content: "Missing required field: tz.",
      ephemeral: true,
    });
    expect(await store.countSubmissions(GUILD)).toBe(0);
  });

  it("refuses expired panels and a member pressing the staff button", async () => {
    const { router, signed } = await fixture();

    const expired = new FakeComponent({ customId: signed("apply", "staff", 1_000) });
    await router.dispatch(expired, createComponentSigner("bot-test-secret"), NOW + 1_000);
    expect(expired.modal).toBeUndefined();
    expect(expired.replies[0]?.content).toMatch(/expired/);

    const member = new FakeComponent({ customId: signed("review", "staff"), permissions: [] });
    await router.dispatch(member, createComponentSigner("bot-test-secret"), NOW);
    expect(member.replies[0]?.content).toMatch(/permission/);
  });

  it("lists the pending queue for a manager without leaking another guild's form", async () => {
    const { router, signed, store } = await fixture();
    const submit = new FakeComponent({
      kind: "modal",
      customId: signed("submit", "staff"),
      userId: "member-2",
      fields: { why: "yes", tz: "UTC" },
    });
    await router.dispatch(submit, createComponentSigner("bot-test-secret"), NOW);

    const staff = new FakeComponent({
      customId: signed("review", "staff"),
      permissions: ["ManageGuild"],
    });
    await router.dispatch(staff, createComponentSigner("bot-test-secret"), NOW);
    expect(staff.replies[0]?.content).toMatch(/1 pending application/);
    expect(staff.replies[0]?.content).toMatch(/<@member-2>/);

    const foreign = new FakeComponent({ customId: signed("apply", "other-form"), userId: "member-3" });
    await router.dispatch(foreign, createComponentSigner("bot-test-secret"), NOW);
    expect(foreign.replies[0]?.content).toMatch(/was not found/);
    expect(await store.countSubmissions(GUILD)).toBe(1);
  });

  it("keeps the command path for forms too long for a modal", async () => {
    const { router, signed, service, form } = await fixture(
      "one:One, two:Two, three:Three, four:Four, five:Five, six:Six",
    );
    expect(form.fields).toHaveLength(6);
    const apply = new FakeComponent({ customId: signed("apply", "staff") });
    await router.dispatch(apply, createComponentSigner("bot-test-secret"), NOW);
    expect(apply.modal).toBeUndefined();
    expect(apply.replies[0]?.content).toMatch(/modal holds five/);
    // The command path still works and is the one the panel names.
    await expect(
      service.submit(GUILD, "member-9", "staff", "one=1; two=2; three=3; four=4; five=5; six=6"),
    ).resolves.toMatchObject({ userId: "member-9" });
  });

  it("renders the panel and router refusals in German, with English still the default", async () => {
    const { form, router, signer, signed } = await fixture();
    const german = JSON.stringify(
      formPanel(form, { apply: signed("apply", "staff"), review: signed("review", "staff") }, "de"),
    );
    expect(german).toContain("Bewerben");
    expect(german).toContain("Fragen");
    expect(german).toContain("Bewerbungen prüfen");

    const expired = new FakeComponent({ customId: signed("apply", "staff", 1_000) });
    await router.dispatch(expired, signer, NOW + 1_000, {
      locale: "de",
      messages: {
        expired: t("de", "component.expired"),
        noPermission: t("de", "component.noPermission"),
        guildOnly: t("de", "component.guildOnly"),
        wrongGuild: t("de", "component.wrongGuild"),
      },
    });
    expect(expired.replies[0]?.content).toContain("abgelaufen");

    const english = JSON.stringify(
      formPanel(form, { apply: signed("apply", "staff"), review: signed("review", "staff") }),
    );
    expect(english).toContain("Apply");
    expect(english).toContain("Questions");
  });

  it("builds a modal only for forms that fit and refuses an empty one", () => {
    const form = { key: "x", name: "X", fields: [] } as unknown as Parameters<typeof formModal>[0];
    expect(() => formModal(form, "form-submit-x")).toThrow(/no fields/);
  });
});

describe("ticket panel components", () => {
  const ticketId = (
    signer: ComponentSigner,
    payload = GUILD,
    ttlMs = 30 * 24 * 60 * 60_000,
  ): string => signer.sign({ namespace: "ticket", action: "open", payload, ttlMs }, NOW);

  it("opens a ticket from a signed panel button and ignores the legacy id", async () => {
    const { router, signer, communityStore, communityActions } = await fixture();
    const open = new FakeComponent({ customId: ticketId(signer), userId: "member-1" });
    expect(await router.dispatch(open, signer, NOW)).toBe(true);
    expect(open.replies[0]?.content).toMatch(/Ticket opened in <#thread-1>/);
    expect(await communityStore.listTickets(GUILD, { limit: 10 })).toMatchObject([
      { openerId: "member-1", state: "open", subject: "Support request" },
    ]);
    expect(communityActions.threads).toHaveLength(1);

    // The old unsigned id is no longer handled anywhere. It must not open a
    // second ticket or produce a reply that makes it look alive.
    const legacy = new FakeComponent({ customId: "keystone:ticket:open" });
    expect(await router.dispatch(legacy, signer, NOW)).toBe(false);
    expect(legacy.replies).toHaveLength(0);
    expect(await communityStore.listTickets(GUILD, { limit: 10 })).toHaveLength(1);
  });

  it("refuses an expired, copied or unauthorized id before creating a row", async () => {
    const { router, signer, communityStore } = await fixture();
    const expired = new FakeComponent({ customId: ticketId(signer, GUILD, 1_000) });
    await router.dispatch(expired, signer, NOW + 1_000);
    expect(expired.replies[0]?.content).toMatch(/expired/);

    const copied = new FakeComponent({ customId: ticketId(signer, "other-guild") });
    await router.dispatch(copied, signer, NOW);
    expect(copied.replies[0]?.content).toMatch(/another server/);

    // The route permission gate is shared: a staff-only form button pressed by
    // a member never reaches its handler.
    const member = new FakeComponent({
      customId: signer.sign(
        { namespace: "form", action: "review", payload: "staff", ttlMs: 15 * 60_000 },
        NOW,
      ),
      permissions: [],
    });
    await router.dispatch(member, signer, NOW);
    expect(member.replies[0]?.content).toMatch(/permission/);

    expect(await communityStore.listTickets(GUILD, { limit: 10 })).toHaveLength(0);
  });
});

describe("community interaction routes", () => {
  it("toggles a role and applies a select panel only from signed ids", async () => {
    const { router, signer, communityStore, communityActions } = await fixture();
    const roles = new ReactionRoleService(
      communityStore,
      communityActions,
      signer,
      () => NOW,
    );

    await roles.createPanel(GUILD, "roles", "Pick a role", [
      { roleId: "role-news", label: "News" },
    ]);
    const button = firstRow(communityActions.sent.at(-1)!.message)?.components[0];
    const press = new FakeComponent({ customId: button?.customId ?? "", userId: "member-1" });
    expect(await router.dispatch(press, signer, NOW)).toBe(true);
    expect(press.replies[0]).toMatchObject({ ephemeral: true });
    expect(await communityActions.hasRole(GUILD, "member-1", "role-news")).toBe(true);

    const panel = await roles.createSelectPanel(GUILD, "roles", "Pick roles", [
      { roleId: "role-a", label: "Alpha" },
      { roleId: "role-b", label: "Beta" },
    ]);
    const select = firstRow(communityActions.sent.at(-1)!.message)?.components[0];
    const pick = new FakeComponent({
      kind: "select",
      customId: select?.customId ?? "",
      userId: "member-1",
      values: ["role-b"],
    });
    expect(await router.dispatch(pick, signer, NOW)).toBe(true);
    expect(await communityActions.hasRole(GUILD, "member-1", "role-a")).toBe(false);
    expect(await communityActions.hasRole(GUILD, "member-1", "role-b")).toBe(true);
    expect(panel.panelId.length).toBeGreaterThan(0);

    // The old unsigned ids are not handled by the router at all.
    for (const customId of [
      "keystone:role:role-news",
      `keystone:roles:${panel.panelId}`,
      "keystone:giveaway:enter:old",
      "keystone:suggest:up:old",
      "keystone:poll:old:0",
    ]) {
      const legacy = new FakeComponent({ customId });
      expect(await router.dispatch(legacy, signer, NOW)).toBe(false);
      expect(legacy.replies).toHaveLength(0);
    }
  });

  it("refuses an expired, forged or cross-guild role id without changing the role", async () => {
    const { router, signer, communityStore, communityActions } = await fixture();
    const roles = new ReactionRoleService(
      communityStore,
      communityActions,
      signer,
      () => NOW,
    );
    await roles.createPanel(GUILD, "roles", "Pick a role", [
      { roleId: "role-news", label: "News" },
    ]);
    const id = firstRow(communityActions.sent.at(-1)!.message)?.components[0]?.customId ?? "";

    const expired = new FakeComponent({
      customId: signer.sign(
        { namespace: "role", action: "toggle", payload: "role-news", ttlMs: 1_000 },
        NOW,
      ),
    });
    await router.dispatch(expired, signer, NOW + 1_000);
    expect(expired.replies[0]?.content).toMatch(/expired/);
    expect(await communityActions.hasRole(GUILD, "member-1", "role-news")).toBe(false);

    const forged = new FakeComponent({
      customId: `${id.slice(0, -1)}${id.endsWith("a") ? "b" : "a"}`,
    });
    await router.dispatch(forged, signer, NOW);
    expect(forged.replies[0]?.ephemeral).toBe(true);
    expect(await communityActions.hasRole(GUILD, "member-1", "role-news")).toBe(false);

    const foreign = new FakeComponent({ customId: id, guildId: "other-guild" });
    await router.dispatch(foreign, signer, NOW);
    expect(foreign.replies[0]).toMatchObject({ ephemeral: true });
    expect(foreign.replies[0]?.content).toMatch(/no longer configured/);
    expect(await communityActions.hasRole("other-guild", "member-1", "role-news")).toBe(false);
  });

  it("enters a giveaway, records a suggestion vote and counts a poll vote", async () => {
    const { router, signer, communityStore, communityActions } = await fixture();

    const giveaways = new GiveawayService(
      communityStore,
      communityActions,
      communitySettingsSchema.parse({}),
      () => NOW,
      () => 0.5,
      signer,
    );
    const giveaway = await giveaways.start(GUILD, "events", "Nitro", 10, 1);
    const enter = firstRow(communityActions.sent.at(-1)!.message)?.components[0];
    const entry = new FakeComponent({ customId: enter?.customId ?? "", userId: "member-2" });
    expect(await router.dispatch(entry, signer, NOW)).toBe(true);
    const giveawayRow = await communityStore.getRecord<{ entries: string[] }>(
      GUILD,
      "giveaway",
      giveaway.id,
    );
    expect(giveawayRow?.data.entries).toEqual(["member-2"]);

    const suggestions = new SuggestionService(
      communityStore,
      communityActions,
      communitySettingsSchema.parse({
        suggestions: { enabled: true, channelId: "suggestions" },
      }),
      () => NOW,
      signer,
    );
    const suggestion = await suggestions.submit(GUILD, "author-1", "Movie night");
    const upvote = firstRow(communityActions.sent.at(-1)!.message)?.components[0];
    const vote = new FakeComponent({ customId: upvote?.customId ?? "", userId: "member-3" });
    expect(await router.dispatch(vote, signer, NOW)).toBe(true);
    const suggestionRow = await communityStore.getRecord<{
      votes: { up: string[]; down: string[] };
    }>(GUILD, "suggestion", suggestion.id);
    expect(suggestionRow?.data.votes.up).toEqual(["member-3"]);

    const content = new ContentService(
      communityStore,
      communityActions,
      communitySettingsSchema.parse({}),
      () => NOW,
      signer,
    );
    const poll = await content.createPoll(GUILD, "general", "Lunch?", ["Pizza", "Soup"]);
    const second = firstRow(communityActions.sent.at(-1)!.message)?.components[1];
    const ballot = new FakeComponent({ customId: second?.customId ?? "", userId: "member-4" });
    expect(await router.dispatch(ballot, signer, NOW)).toBe(true);
    const pollRow = await communityStore.getRecord<{ votes: Record<string, string[]> }>(
      GUILD,
      "poll",
      poll.id,
    );
    expect(pollRow?.data.votes["1"]).toEqual(["member-4"]);
  });
});
