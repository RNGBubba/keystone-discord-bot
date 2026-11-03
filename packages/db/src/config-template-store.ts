import { and, desc, eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import {
  SavedTemplateNameTakenError,
  type SavedTemplateInput,
  type SavedTemplateModule,
  type SavedTemplatePatch,
  type SavedTemplateRecord,
  type SavedTemplateStore,
} from "@keystone/kernel";
import { configTemplates } from "./schema";
import type { schema } from "./schema";

/**
 * Postgres implementation of the saved-template port.
 *
 * The table stores one JSON snapshot per template. The `lower(name)` unique
 * index is the only cross-guild invariant; the service checks it first for a
 * friendly `409`, and this adapter turns the race's PostgreSQL `23505` into the
 * same typed error.
 */
export class DrizzleSavedTemplateStore implements SavedTemplateStore {
  constructor(private readonly db: PgDatabase<any, typeof schema>) {}

  async list(guildId: string): Promise<readonly SavedTemplateRecord[]> {
    const rows = await this.db
      .select()
      .from(configTemplates)
      .where(eq(configTemplates.guildId, guildId))
      .orderBy(desc(configTemplates.updatedAt));
    return rows.map(toRecord);
  }

  async get(guildId: string, id: string): Promise<SavedTemplateRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(configTemplates)
      .where(and(eq(configTemplates.guildId, guildId), eq(configTemplates.id, id)))
      .limit(1);
    return row ? toRecord(row) : undefined;
  }

  async create(input: SavedTemplateInput): Promise<SavedTemplateRecord> {
    const at = new Date(input.at ?? Date.now());
    try {
      const [row] = await this.db
        .insert(configTemplates)
        .values({
          guildId: input.guildId,
          name: input.name,
          description: input.description,
          modules: input.modules,
          createdBy: input.createdBy ?? null,
          createdAt: at,
          updatedAt: at,
        })
        .returning();
      if (!row) throw new Error("The saved-template insert returned no row.");
      return toRecord(row);
    } catch (error) {
      if (isUniqueViolation(error)) throw new SavedTemplateNameTakenError(input.name);
      throw error;
    }
  }

  async update(
    guildId: string,
    id: string,
    patch: SavedTemplatePatch,
  ): Promise<SavedTemplateRecord | undefined> {
    try {
      const [row] = await this.db
        .update(configTemplates)
        .set({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.modules !== undefined ? { modules: patch.modules } : {}),
          updatedAt: new Date(patch.at ?? Date.now()),
        })
        .where(and(eq(configTemplates.guildId, guildId), eq(configTemplates.id, id)))
        .returning();
      return row ? toRecord(row) : undefined;
    } catch (error) {
      if (isUniqueViolation(error)) throw new SavedTemplateNameTakenError(patch.name ?? "");
      throw error;
    }
  }

  async delete(guildId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(configTemplates)
      .where(and(eq(configTemplates.guildId, guildId), eq(configTemplates.id, id)))
      .returning({ id: configTemplates.id });
    return rows.length > 0;
  }
}

function toRecord(row: typeof configTemplates.$inferSelect): SavedTemplateRecord {
  return {
    id: row.id,
    guildId: row.guildId,
    name: row.name,
    description: row.description,
    modules: Array.isArray(row.modules)
      ? (row.modules as SavedTemplateModule[])
      : [],
    ...(row.createdBy ? { createdBy: row.createdBy } : {}),
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  let current = error as { code?: unknown; cause?: unknown } | null;
  for (let depth = 0; current && depth < 4; depth += 1) {
    if (current.code === "23505") return true;
    current = current.cause as { code?: unknown; cause?: unknown } | null;
  }
  return false;
}
