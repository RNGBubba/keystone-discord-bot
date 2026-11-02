import { afterEach, describe, expect, it } from "vitest";
import { createPgliteDatabase, type PgliteHarness } from "./testing";
import { migrate } from "./migrator";

let harness: PgliteHarness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe("migrator transactions", () => {
  it("rolls back a failed migration and records nothing", async () => {
    harness = await createPgliteDatabase();

    await expect(
      migrate(harness.runner, [
        {
          version: "9999_bad",
          sql: "CREATE TABLE should_not_exist (id integer); SELECT * FROM missing_table;",
        },
      ]),
    ).rejects.toThrow(/9999_bad failed and was rolled back/);

    const tables = await harness.runner.query<{ name: string | null }>(
      "SELECT to_regclass('public.should_not_exist')::text AS name",
    );
    expect(tables[0]?.name).toBeNull();

    const ledger = await harness.runner.query<{ version: string }>(
      "SELECT version FROM schema_migrations",
    );
    expect(ledger.map((row) => row.version)).not.toContain("9999_bad");
  });

  it("commits a successful migration and its ledger row together", async () => {
    harness = await createPgliteDatabase();

    const result = await migrate(harness.runner, [
      {
        version: "9999_ok",
        sql: "CREATE TABLE migrator_probe (id integer PRIMARY KEY);",
      },
    ]);

    expect(result.applied).toEqual(["9999_ok"]);
    const tables = await harness.runner.query<{ name: string | null }>(
      "SELECT to_regclass('public.migrator_probe')::text AS name",
    );
    expect(tables[0]?.name).toBe("migrator_probe");
  });
});
