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
import { createFormRouter, type ComponentRuntimeDeps } from "./components";

const NOW = 1_800_000_000_000;
const GUILD = "g1";

class FakeComponent implements ComponentInteractionLike {
  readonly kind: "button" | "select" | "modal";
  readonly customId: string;
  readonly guildId = GUILD;
  readonly channelId = "chan-1";
  readonly userId: string;
  readonly permissions: readonly string[];
  readonly fields?: Readonly<Record<string, string>>;
  readonly replies: ReplyInput[] = [];
  modal?: ModalSpec;
  #replied = false;

  constructor(init: {
    kind?: "button" | "select" | "modal";
    customId: string;
    userId?: string;
    permissions?: string[];
    fields?: Record<string, string>;
  }) {
    this.kind = init.kind ?? "button";
    this.customId = init.customId;
    this.userId = init.userId ?? "member-1";
    this.permissions = init.permissions ?? [];
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
  const deps: ComponentRuntimeDeps = {
    signer,
    forms: store,
    formSettings: settings,
    moderation: { settings, moderation: {} as ModerationPort },
    logger: createSilentLogger(),
    now: () => NOW,
  };
  const router = createFormRouter(deps);
  const signed = (action: string, payload: string, ttlMs = 15 * 60_000): string =>
    signer.sign({ namespace: "form", action, payload, ttlMs }, NOW);
  return { store, service, form, router, signer, signed };
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
