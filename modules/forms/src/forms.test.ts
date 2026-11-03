import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createTestContext, FakeInteraction } from "@keystone/testing";
import { UserError, type FormStore } from "@keystone/kernel";
import { form } from "./commands/form";
import { FormService, parseAnswers, parseFieldSpec } from "./forms";
import { formDefaultSettings } from "./settings";
import { InMemoryFormStore } from "./store";

function context(
  store: FormStore,
  options: {
    subcommand: string;
    values?: Record<string, string>;
    permissions?: string[];
    userId?: string;
    settings?: Record<string, unknown>;
  },
) {
  const interaction = new FakeInteraction({
    commandName: "form",
    subcommand: options.subcommand,
    options: options.values ?? {},
    permissions: options.permissions ?? ["ManageGuild"],
    userId: options.userId ?? "mod-1",
  });
  return createTestContext({
    moduleId: "forms",
    interaction,
    forms: store,
    settings: options.settings ?? formDefaultSettings,
  });
}

async function createOpenForm(store: FormStore): Promise<void> {
  await form.execute(
    context(store, {
      subcommand: "create",
      values: {
        name: "Staff application",
        fields: "why:Why join, tz:Timezone",
      },
    }),
  );
  await form.execute(
    context(store, {
      subcommand: "edit",
      values: { form: "staff-application", state: "open" },
    }),
  );
}

describe("field and answer parsing", () => {
  it("derives keys from labels and keeps explicit keys", () => {
    expect(parseFieldSpec("Why join, tz:Timezone", 10, 500)).toEqual([
      { key: "why-join", label: "Why join", required: true, maxLength: 500 },
      { key: "tz", label: "Timezone", required: true, maxLength: 500 },
    ]);
  });

  it("rejects an empty, duplicate or oversized field list", () => {
    expect(() => parseFieldSpec("", 10, 500)).toThrow(UserError);
    expect(() => parseFieldSpec("Why, why:Again", 10, 500)).toThrow(/used twice/);
    expect(() => parseFieldSpec("a:A, b:B", 1, 500)).toThrow(/at most 1/);
  });

  it("rejects an unknown answer and a missing required answer by name", () => {
    const fields = parseFieldSpec("why:Why join, tz:Timezone", 10, 500);
    expect(() => parseAnswers("why=Because; nope=x", fields)).toThrow(/Unknown field `nope`/);
    expect(() => parseAnswers("why=Because", fields)).toThrow(/Missing required field: tz/);
    expect(() => parseAnswers("why=Because; tz=", fields)).toThrow(/`tz` is required/);
  });

  it("accepts semicolons, newlines and values containing equals signs", () => {
    const fields = parseFieldSpec("why:Why join, link:Link", 10, 500);
    expect(parseAnswers("why=Because a=b\nlink=https://x.test/?a=b", fields)).toEqual({
      why: "Because a=b",
      link: "https://x.test/?a=b",
    });
  });
});

describe("/form vertical slice", () => {
  it("flows create → open → panel → submit → review and reads state back", async () => {
    const store = new InMemoryFormStore();
    await createOpenForm(store);

    const created = await store.getForm("1", "staff-application");
    expect(created).toMatchObject({
      key: "staff-application",
      name: "Staff application",
      state: "open",
      createdBy: "mod-1",
    });
    expect(created?.fields.map((field) => field.key)).toEqual(["why", "tz"]);

    const panel = context(store, {
      subcommand: "panel",
      values: { form: "staff-application" },
    });
    await form.execute(panel);
    expect(panel.interaction.deferred).toBe(true);
    expect(panel.interaction.lastReply?.ephemeral).toBeUndefined();
    // A Components V2 panel is a layout tree, not an embed.
    const container = panel.interaction.lastReply?.v2?.[0];
    expect(container?.type).toBe("container");
    if (container?.type === "container") {
      const text = container.components.find((child) => child.type === "text-display");
      expect(text?.type === "text-display" ? text.content : "").toContain("Staff application");
      const rows = container.components.filter((child) => child.type === "action-row");
      expect(rows).toHaveLength(2);
    }
    expect(await store.getForm("1", "staff-application")).toMatchObject({
      panelChannelId: "99",
    });

    const submitted = context(store, {
      subcommand: "submit",
      userId: "member-7",
      permissions: [],
      values: {
        form: "staff-application",
        answers: "why=I like helping; tz=UTC+2",
      },
    });
    await form.execute(submitted);
    const submissionId = /`([0-9a-f-]{36})`/.exec(
      String(submitted.interaction.lastReply?.content),
    )?.[1];
    expect(submissionId).toBeTruthy();

    const stored = await store.getSubmission("1", submissionId as string);
    expect(stored).toMatchObject({
      userId: "member-7",
      state: "submitted",
      answers: { why: "I like helping", tz: "UTC+2" },
    });
    expect(await store.countSubmissions("1")).toBe(1);

    const queue = context(store, { subcommand: "review" });
    await form.execute(queue);
    expect(String(queue.interaction.lastReply?.content)).toContain("1 pending submission");
    expect(String(queue.interaction.lastReply?.embeds?.[0]?.description)).toContain(
      submissionId as string,
    );

    const review = context(store, {
      subcommand: "review",
      values: { submission: submissionId as string, decision: "accepted", note: "Strong" },
    });
    await form.execute(review);
    expect(String(review.interaction.lastReply?.content)).toContain("accepted by <@mod-1>");
    expect((await store.getSubmission("1", submissionId as string))?.state).toBe("accepted");

    const again = context(store, {
      subcommand: "review",
      values: { submission: submissionId as string, decision: "denied" },
    });
    await expect(form.execute(again)).rejects.toThrow(/already accepted/);
  });

  it("refuses a duplicate pending submission and accepts one after a decision", async () => {
    const store = new InMemoryFormStore();
    await createOpenForm(store);
    const submit = () =>
      context(store, {
        subcommand: "submit",
        userId: "member-7",
        permissions: [],
        values: { form: "staff-application", answers: "why=Hello; tz=UTC" },
      });

    const first = submit();
    await form.execute(first);
    await expect(form.execute(submit())).rejects.toThrow(/already have a pending submission/);

    const pending = await store.listSubmissions("1", { state: "submitted" });
    await store.reviewSubmission("1", pending[0]?.id as string, "mod-1", "denied");
    await expect(form.execute(submit())).resolves.toBeUndefined();
    expect(await store.countSubmissions("1")).toBe(2);
  });

  it("refuses a panel for a draft, a submission for a closed form and a delete with history", async () => {
    const store = new InMemoryFormStore();
    await form.execute(
      context(store, {
        subcommand: "create",
        values: { name: "Draft form", fields: "why:Why" },
      }),
    );

    await expect(
      form.execute(context(store, { subcommand: "panel", values: { form: "draft-form" } })),
    ).rejects.toThrow(/is draft/);
    await expect(
      form.execute(
        context(store, {
          subcommand: "submit",
          userId: "member-1",
          permissions: [],
          values: { form: "draft-form", answers: "why=Here" },
        }),
      ),
    ).rejects.toThrow(/not accepting submissions/);

    await form.execute(
      context(store, { subcommand: "edit", values: { form: "draft-form", state: "open" } }),
    );
    await form.execute(
      context(store, {
        subcommand: "submit",
        userId: "member-1",
        permissions: [],
        values: { form: "draft-form", answers: "why=Here" },
      }),
    );
    await expect(
      form.execute(
        context(store, {
          subcommand: "delete",
          values: { form: "draft-form", confirm: "draft-form" },
        }),
      ),
    ).rejects.toThrow(/1 submission/);
  });

  it("requires the exact key to delete and removes an unused form", async () => {
    const store = new InMemoryFormStore();
    await form.execute(
      context(store, { subcommand: "create", values: { name: "Unused", fields: "why:Why" } }),
    );
    await expect(
      form.execute(
        context(store, { subcommand: "delete", values: { form: "unused", confirm: "nope" } }),
      ),
    ).rejects.toThrow(/confirm:unused/);

    await form.execute(
      context(store, { subcommand: "delete", values: { form: "unused", confirm: "unused" } }),
    );
    expect(await store.getForm("1", "unused")).toBeUndefined();
    expect(await store.listForms("1")).toHaveLength(0);
  });

  it("rejects a form key collision and a missing form", async () => {
    const store = new InMemoryFormStore();
    await form.execute(
      context(store, { subcommand: "create", values: { name: "Apply", fields: "why:Why" } }),
    );
    await expect(
      form.execute(
        context(store, { subcommand: "create", values: { name: "Apply", fields: "why:Why" } }),
      ),
    ).rejects.toThrow(/already exists/);
    await expect(
      form.execute(context(store, { subcommand: "edit", values: { form: "missing", state: "open" } })),
    ).rejects.toThrow(/was not found/);
  });

  it("gates management commands on ManageGuild but lets a member submit", async () => {
    const store = new InMemoryFormStore();
    await createOpenForm(store);
    await expect(
      form.execute(context(store, { subcommand: "list", permissions: [] })),
    ).rejects.toThrow(/Missing permission: ManageGuild/);

    await form.execute(
      context(store, {
        subcommand: "submit",
        userId: "member-2",
        permissions: [],
        values: { form: "staff-application", answers: "why=Hi; tz=UTC" },
      }),
    );
    expect(await store.countSubmissions("1")).toBe(1);
  });

  it("blocks creation and submission when forms are disabled but still exports rows", async () => {
    const store = new InMemoryFormStore();
    await createOpenForm(store);
    await form.execute(
      context(store, {
        subcommand: "submit",
        userId: "member-1",
        permissions: [],
        values: { form: "staff-application", answers: "why=Hi; tz=UTC" },
      }),
    );

    await expect(
      form.execute(
        context(store, {
          subcommand: "create",
          settings: { ...formDefaultSettings, enabled: false },
          values: { name: "Other", fields: "why:Why" },
        }),
      ),
    ).rejects.toThrow(/Forms are disabled here/);
    await expect(
      form.execute(
        context(store, {
          subcommand: "submit",
          settings: { ...formDefaultSettings, enabled: false },
          userId: "member-2",
          permissions: [],
          values: { form: "staff-application", answers: "why=Hi; tz=UTC" },
        }),
      ),
    ).rejects.toThrow(/Forms are disabled here/);

    const exported = context(store, { subcommand: "export" });
    await form.execute(exported);
    const file = exported.interaction.lastReply?.files?.[0];
    expect(file?.name).toBe("keystone.forms.1.json");
    const payload = JSON.parse(file?.content ?? "{}") as {
      counts: { forms: number; submissions: number };
      checksum: string;
    };
    expect(payload.counts).toEqual({ forms: 1, submissions: 1 });
    expect(payload.checksum).toMatch(/^[0-9a-f]{64}$/);

    const { checksum: storedChecksum, ...withoutChecksum } = payload;
    const expected = createHash("sha256").update(JSON.stringify(withoutChecksum)).digest("hex");
    expect(storedChecksum).toBe(expected);
  });

  it("enforces the form cap from settings through the service", async () => {
    const store = new InMemoryFormStore();
    const service = new FormService(store, { ...formDefaultSettings, maxForms: 1 });
    await service.create("1", "mod-1", { name: "One", fields: "why:Why" });
    await expect(
      service.create("1", "mod-1", { name: "Two", fields: "why:Why" }),
    ).rejects.toThrow(/already has 1 forms/);
  });
});
