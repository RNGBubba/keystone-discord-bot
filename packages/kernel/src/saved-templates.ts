/**
 * Saved configuration templates.
 *
 * A saved template is a snapshot of every module's effective settings plus the
 * metadata needed to find it again. It is not a second settings store: applying
 * one produces a plan and writes through `SettingsService.update`, exactly like
 * a built-in template. The store is deliberately small so the in-memory and
 * SQL adapters are interchangeable.
 */
export interface SavedTemplateModule {
  readonly id: string;
  readonly version: string;
  readonly settings: Readonly<Record<string, unknown>>;
}

export interface SavedTemplateRecord {
  readonly id: string;
  /** The guild this template belongs to; it is not a marketplace listing. */
  readonly guildId: string;
  readonly name: string;
  readonly description: string;
  readonly modules: readonly SavedTemplateModule[];
  readonly createdBy?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface SavedTemplateInput {
  readonly guildId: string;
  readonly name: string;
  readonly description: string;
  readonly modules: readonly SavedTemplateModule[];
  readonly createdBy?: string;
  /** Milliseconds since the epoch; the SQL adapter maps it to timestamptz. */
  readonly at?: number;
}

export interface SavedTemplatePatch {
  readonly name?: string;
  readonly description?: string;
  readonly modules?: readonly SavedTemplateModule[];
  /** Set by the service so a preview taken before the edit becomes stale. */
  readonly at?: number;
}

export interface SavedTemplateStore {
  list(guildId: string): Promise<readonly SavedTemplateRecord[]>;
  get(guildId: string, id: string): Promise<SavedTemplateRecord | undefined>;
  create(input: SavedTemplateInput): Promise<SavedTemplateRecord>;
  update(
    guildId: string,
    id: string,
    patch: SavedTemplatePatch,
  ): Promise<SavedTemplateRecord | undefined>;
  delete(guildId: string, id: string): Promise<boolean>;
}

/** A guild already has a template with this name (case-insensitive). */
export class SavedTemplateNameTakenError extends Error {
  constructor(readonly templateName: string) {
    super(`A saved template named "${templateName}" already exists in this guild.`);
    this.name = "SavedTemplateNameTakenError";
  }
}

function sameName(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase("en-US") === right.trim().toLocaleLowerCase("en-US");
}

export class InMemorySavedTemplateStore implements SavedTemplateStore {
  readonly #rows = new Map<string, SavedTemplateRecord>();

  async list(guildId: string): Promise<readonly SavedTemplateRecord[]> {
    return [...this.#rows.values()]
      .filter((row) => row.guildId === guildId)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((row) => structuredClone(row));
  }

  async get(guildId: string, id: string): Promise<SavedTemplateRecord | undefined> {
    const row = this.#rows.get(id);
    return row?.guildId === guildId ? structuredClone(row) : undefined;
  }

  async create(input: SavedTemplateInput): Promise<SavedTemplateRecord> {
    if ([...this.#rows.values()].some((row) => row.guildId === input.guildId && sameName(row.name, input.name))) {
      throw new SavedTemplateNameTakenError(input.name);
    }
    const at = input.at ?? Date.now();
    const record: SavedTemplateRecord = {
      id: globalThis.crypto.randomUUID(),
      guildId: input.guildId,
      name: input.name,
      description: input.description,
      modules: structuredClone(input.modules),
      ...(input.createdBy ? { createdBy: input.createdBy } : {}),
      createdAt: at,
      updatedAt: at,
    };
    this.#rows.set(record.id, record);
    return structuredClone(record);
  }

  async update(
    guildId: string,
    id: string,
    patch: SavedTemplatePatch,
  ): Promise<SavedTemplateRecord | undefined> {
    const existing = this.#rows.get(id);
    if (!existing || existing.guildId !== guildId) return undefined;
    const name = patch.name ?? existing.name;
    if (
      [...this.#rows.values()].some(
        (row) => row.id !== id && row.guildId === guildId && sameName(row.name, name),
      )
    ) {
      throw new SavedTemplateNameTakenError(name);
    }
    const record: SavedTemplateRecord = {
      ...existing,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.modules !== undefined ? { modules: structuredClone(patch.modules) } : {}),
      updatedAt: patch.at ?? Date.now(),
    };
    this.#rows.set(id, record);
    return structuredClone(record);
  }

  async delete(guildId: string, id: string): Promise<boolean> {
    const existing = this.#rows.get(id);
    if (!existing || existing.guildId !== guildId) return false;
    return this.#rows.delete(id);
  }
}
