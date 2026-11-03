import { and, eq, inArray, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type {
  BackupRecord,
  GuildSnapshot,
  ImportReceipt,
  ImportRecord,
  ImportState,
  LevelApplyMode,
  LevelApplyResult,
  LevelImportRow,
  PortabilityStore,
} from "@keystone/importer";
import { emptySnapshot, keystoneLevelForXp } from "@keystone/importer";
import {
  aiDocuments,
  aiUsage,
  auditEvents,
  backups,
  caseCounters,
  caseEvents,
  cases,
  communityRecords,
  configBaselines,
  economyLedger,
  guilds,
  imports,
  levels,
  members,
  settings,
  tickets,
  xpEvents,
} from "./schema";
import type { schema } from "./schema";

const iso = (value: Date | null | undefined): string | null => value?.toISOString() ?? null;

/** Parse the JSON text exactly once, preserving numeric strings. */
const readJson = (text: string | null): unknown => (text === null ? null : JSON.parse(text));

/**
 * The Drizzle implementation of the portability port.
 *
 * It is the only place that knows how to turn every guild table into one
 * document and back. Features keep using their narrow stores; restore gets the
 * one operation that necessarily spans tables.
 */
export class DrizzlePortabilityStore implements PortabilityStore {
  constructor(private readonly db: PgDatabase<any, typeof schema>) {}

  async snapshot(guildId: string): Promise<GuildSnapshot> {
    const [guildRow] = await this.db.select().from(guilds).where(eq(guilds.id, guildId)).limit(1);
    if (!guildRow) return emptySnapshot(guildId);

    const [
      settingRows,
      memberRows,
      caseRows,
      ticketRows,
      levelRows,
      xpRows,
      ledgerRows,
      auditRows,
      recordRows,
      documentRows,
      usageRows,
      counterRows,
    ] = await Promise.all([
      this.db
        .select({
          module: settings.module,
          key: settings.key,
          value: sql<string | null>`${settings.value}::text`,
          updatedAt: settings.updatedAt,
        })
        .from(settings)
        .where(eq(settings.guildId, guildId)),
      this.db.select().from(members).where(eq(members.guildId, guildId)),
      this.db
        .select({
          id: cases.id,
          caseNumber: cases.caseNumber,
          actorId: cases.actorId,
          targetId: cases.targetId,
          action: cases.action,
          reason: cases.reason,
          rule: cases.rule,
          state: cases.state,
          evidence: sql<string | null>`${cases.evidence}::text`,
          createdAt: cases.createdAt,
          updatedAt: cases.updatedAt,
        })
        .from(cases)
        .where(eq(cases.guildId, guildId)),
      this.db.select().from(tickets).where(eq(tickets.guildId, guildId)),
      this.db.select().from(levels).where(eq(levels.guildId, guildId)),
      this.db.select().from(xpEvents).where(eq(xpEvents.guildId, guildId)),
      this.db.select().from(economyLedger).where(eq(economyLedger.guildId, guildId)),
      this.db
        .select({
          id: auditEvents.id,
          actorId: auditEvents.actorId,
          action: auditEvents.action,
          targetId: auditEvents.targetId,
          data: sql<string | null>`${auditEvents.data}::text`,
          createdAt: auditEvents.createdAt,
        })
        .from(auditEvents)
        .where(eq(auditEvents.guildId, guildId)),
      this.db
        .select({
          kind: communityRecords.kind,
          key: communityRecords.key,
          data: sql<string | null>`${communityRecords.data}::text`,
          createdAt: communityRecords.createdAt,
          updatedAt: communityRecords.updatedAt,
        })
        .from(communityRecords)
        .where(eq(communityRecords.guildId, guildId)),
      this.db
        .select({
          id: aiDocuments.id,
          name: aiDocuments.name,
          content: aiDocuments.content,
          chunks: sql<string | null>`${aiDocuments.chunks}::text`,
          createdAt: aiDocuments.createdAt,
          updatedAt: aiDocuments.updatedAt,
        })
        .from(aiDocuments)
        .where(eq(aiDocuments.guildId, guildId)),
      this.db.select().from(aiUsage).where(eq(aiUsage.guildId, guildId)),
      this.db.select().from(caseCounters).where(eq(caseCounters.guildId, guildId)).limit(1),
    ]);

    const caseIds = caseRows.map((row) => row.id);
    const eventRows =
      caseIds.length === 0
        ? []
        : await this.db
            .select({
              id: caseEvents.id,
              caseId: caseEvents.caseId,
              type: caseEvents.type,
              actorId: caseEvents.actorId,
              data: sql<string | null>`${caseEvents.data}::text`,
              createdAt: caseEvents.createdAt,
            })
            .from(caseEvents)
            .where(inArray(caseEvents.caseId, caseIds));

    return {
      guild: {
        id: guildRow.id,
        name: guildRow.name,
        locale: guildRow.locale,
        plan: guildRow.plan,
        joinedAt: guildRow.joinedAt.toISOString(),
        leftAt: iso(guildRow.leftAt),
      },
      settings: settingRows
        .map((row) => ({
          module: row.module,
          key: row.key,
          value: readJson(row.value),
          updatedAt: row.updatedAt.toISOString(),
        }))
        .sort((a, b) => `${a.module}.${a.key}`.localeCompare(`${b.module}.${b.key}`)),
      members: memberRows
        .map((row) => ({
          userId: row.userId,
          joinedAt: row.joinedAt.toISOString(),
          quarantined: row.quarantined,
          verifiedAt: iso(row.verifiedAt),
          updatedAt: row.updatedAt.toISOString(),
        }))
        .sort((a, b) => a.userId.localeCompare(b.userId)),
      cases: caseRows
        .map((row) => ({
          id: row.id,
          caseNumber: row.caseNumber,
          actorId: row.actorId,
          targetId: row.targetId,
          action: row.action,
          reason: row.reason,
          rule: row.rule,
          state: row.state,
          evidence: readJson(row.evidence),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }))
        .sort((a, b) => a.caseNumber - b.caseNumber),
      caseEvents: eventRows
        .map((row) => ({
          id: row.id,
          caseId: row.caseId,
          type: row.type,
          actorId: row.actorId,
          data: readJson(row.data),
          createdAt: row.createdAt.toISOString(),
        }))
        .sort((a, b) => `${a.createdAt}:${a.id}`.localeCompare(`${b.createdAt}:${b.id}`)),
      tickets: ticketRows
        .map((row) => ({
          id: row.id,
          channelId: row.channelId,
          openerId: row.openerId,
          claimerId: row.claimerId,
          state: row.state,
          subject: row.subject,
          slaDueAt: iso(row.slaDueAt),
          closedAt: iso(row.closedAt),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }))
        .sort((a, b) => `${a.createdAt}:${a.id}`.localeCompare(`${b.createdAt}:${b.id}`)),
      levels: levelRows
        .map((row) => ({
          userId: row.userId,
          xp: Number(row.xp),
          level: row.level,
          updatedAt: row.updatedAt.toISOString(),
        }))
        .sort((a, b) => a.userId.localeCompare(b.userId)),
      xpEvents: xpRows
        .map((row) => ({
          id: row.id,
          userId: row.userId,
          amount: row.amount,
          source: row.source,
          idempotencyKey: row.idempotencyKey,
          createdAt: row.createdAt.toISOString(),
        }))
        .sort((a, b) => `${a.createdAt}:${a.id}`.localeCompare(`${b.createdAt}:${b.id}`)),
      economyLedger: ledgerRows
        .map((row) => ({
          id: row.id,
          userId: row.userId,
          amount: Number(row.amount),
          reason: row.reason,
          actorId: row.actorId,
          idempotencyKey: row.idempotencyKey,
          createdAt: row.createdAt.toISOString(),
        }))
        .sort((a, b) => `${a.createdAt}:${a.id}`.localeCompare(`${b.createdAt}:${b.id}`)),
      auditEvents: auditRows
        .map((row) => ({
          id: row.id,
          actorId: row.actorId,
          action: row.action,
          targetId: row.targetId,
          data: readJson(row.data),
          createdAt: row.createdAt.toISOString(),
        }))
        .sort((a, b) => `${a.createdAt}:${a.id}`.localeCompare(`${b.createdAt}:${b.id}`)),
      communityRecords: recordRows
        .map((row) => ({
          kind: row.kind,
          key: row.key,
          data: readJson(row.data),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }))
        .sort((a, b) => `${a.kind}.${a.key}`.localeCompare(`${b.kind}.${b.key}`)),
      aiDocuments: documentRows
        .map((row) => ({
          id: row.id,
          name: row.name,
          content: row.content,
          chunks: readJson(row.chunks),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }))
        .sort((a, b) => `${a.name}:${a.id}`.localeCompare(`${b.name}:${b.id}`)),
      aiUsage: usageRows
        .map((row) => ({
          period: row.period,
          requests: row.requests,
          inputTokens: Number(row.inputTokens),
          outputTokens: Number(row.outputTokens),
          costMicros: Number(row.costMicros),
          updatedAt: row.updatedAt.toISOString(),
        }))
        .sort((a, b) => a.period.localeCompare(b.period)),
      caseCounter:
        counterRows[0] !== undefined ? { nextCaseNumber: counterRows[0].nextCaseNumber } : null,
    };
  }

  async replaceGuild(guildId: string, snapshot: GuildSnapshot): Promise<void> {
    if (snapshot.guild.id !== guildId) {
      throw new Error(`Refusing to restore guild ${snapshot.guild.id} into ${guildId}.`);
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(caseEvents).where(
        sql`${caseEvents.caseId} IN (SELECT ${cases.id} FROM ${cases} WHERE ${cases.guildId} = ${guildId})`,
      );
      await tx.delete(cases).where(eq(cases.guildId, guildId));
      await tx.delete(tickets).where(eq(tickets.guildId, guildId));
      await tx.delete(levels).where(eq(levels.guildId, guildId));
      await tx.delete(xpEvents).where(eq(xpEvents.guildId, guildId));
      await tx.delete(economyLedger).where(eq(economyLedger.guildId, guildId));
      await tx.delete(auditEvents).where(eq(auditEvents.guildId, guildId));
      await tx.delete(communityRecords).where(eq(communityRecords.guildId, guildId));
      await tx.delete(aiDocuments).where(eq(aiDocuments.guildId, guildId));
      await tx.delete(aiUsage).where(eq(aiUsage.guildId, guildId));
      await tx.delete(members).where(eq(members.guildId, guildId));
      await tx.delete(settings).where(eq(settings.guildId, guildId));
      await tx.delete(caseCounters).where(eq(caseCounters.guildId, guildId));
      await tx.delete(configBaselines).where(eq(configBaselines.guildId, guildId));

      await tx
        .insert(guilds)
        .values({
          id: guildId,
          name: snapshot.guild.name,
          locale: snapshot.guild.locale,
          plan: snapshot.guild.plan,
          joinedAt: new Date(snapshot.guild.joinedAt),
          leftAt: snapshot.guild.leftAt ? new Date(snapshot.guild.leftAt) : null,
        })
        .onConflictDoUpdate({
          target: guilds.id,
          set: {
            name: snapshot.guild.name,
            locale: snapshot.guild.locale,
            plan: snapshot.guild.plan,
            joinedAt: new Date(snapshot.guild.joinedAt),
            leftAt: snapshot.guild.leftAt ? new Date(snapshot.guild.leftAt) : null,
          },
        });

      await this.insertChunked(snapshot.settings, (chunk) =>
        tx.insert(settings).values(chunk.map((row) => ({
          guildId,
          module: row.module,
          key: row.key,
          value: row.value,
          updatedAt: new Date(row.updatedAt),
        }))),
      );

      await this.insertChunked(snapshot.members, (chunk) =>
        tx.insert(members).values(chunk.map((row) => ({
          guildId,
          userId: row.userId,
          joinedAt: new Date(row.joinedAt),
          quarantined: row.quarantined,
          verifiedAt: row.verifiedAt ? new Date(row.verifiedAt) : null,
          updatedAt: new Date(row.updatedAt),
        }))),
      );

      await this.insertChunked(snapshot.cases, (chunk) =>
        tx.insert(cases).values(chunk.map((row) => ({
          id: row.id,
          guildId,
          caseNumber: row.caseNumber,
          actorId: row.actorId,
          targetId: row.targetId,
          action: row.action,
          reason: row.reason,
          rule: row.rule,
          state: row.state,
          evidence: row.evidence,
          createdAt: new Date(row.createdAt),
          updatedAt: new Date(row.updatedAt),
        }))),
      );

      await this.insertChunked(snapshot.caseEvents, (chunk) =>
        tx.insert(caseEvents).values(chunk.map((row) => ({
          id: row.id,
          caseId: row.caseId,
          type: row.type,
          actorId: row.actorId,
          data: row.data,
          createdAt: new Date(row.createdAt),
        }))),
      );

      await this.insertChunked(snapshot.tickets, (chunk) =>
        tx.insert(tickets).values(chunk.map((row) => ({
          id: row.id,
          guildId,
          channelId: row.channelId,
          openerId: row.openerId,
          claimerId: row.claimerId,
          state: row.state,
          subject: row.subject,
          slaDueAt: row.slaDueAt ? new Date(row.slaDueAt) : null,
          closedAt: row.closedAt ? new Date(row.closedAt) : null,
          createdAt: new Date(row.createdAt),
          updatedAt: new Date(row.updatedAt),
        }))),
      );

      await this.insertChunked(snapshot.levels, (chunk) =>
        tx.insert(levels).values(chunk.map((row) => ({
          guildId,
          userId: row.userId,
          xp: row.xp,
          level: row.level,
          updatedAt: new Date(row.updatedAt),
        }))),
      );

      await this.insertChunked(snapshot.xpEvents, (chunk) =>
        tx.insert(xpEvents).values(chunk.map((row) => ({
          id: row.id,
          guildId,
          userId: row.userId,
          amount: row.amount,
          source: row.source,
          idempotencyKey: row.idempotencyKey,
          createdAt: new Date(row.createdAt),
        }))),
      );

      await this.insertChunked(snapshot.economyLedger, (chunk) =>
        tx.insert(economyLedger).values(chunk.map((row) => ({
          id: row.id,
          guildId,
          userId: row.userId,
          amount: row.amount,
          reason: row.reason,
          actorId: row.actorId,
          idempotencyKey: row.idempotencyKey,
          createdAt: new Date(row.createdAt),
        }))),
      );

      await this.insertChunked(snapshot.auditEvents, (chunk) =>
        tx.insert(auditEvents).values(chunk.map((row) => ({
          id: row.id,
          guildId,
          actorId: row.actorId,
          action: row.action,
          targetId: row.targetId,
          data: row.data,
          createdAt: new Date(row.createdAt),
        }))),
      );

      await this.insertChunked(snapshot.communityRecords, (chunk) =>
        tx.insert(communityRecords).values(chunk.map((row) => ({
          guildId,
          kind: row.kind,
          key: row.key,
          data: row.data,
          createdAt: new Date(row.createdAt),
          updatedAt: new Date(row.updatedAt),
        }))),
      );

      await this.insertChunked(snapshot.aiDocuments, (chunk) =>
        tx.insert(aiDocuments).values(chunk.map((row) => ({
          id: row.id,
          guildId,
          name: row.name,
          content: row.content,
          chunks: row.chunks,
          createdAt: new Date(row.createdAt),
          updatedAt: new Date(row.updatedAt),
        }))),
      );

      await this.insertChunked(snapshot.aiUsage, (chunk) =>
        tx.insert(aiUsage).values(chunk.map((row) => ({
          guildId,
          period: row.period,
          requests: row.requests,
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
          costMicros: row.costMicros,
          updatedAt: new Date(row.updatedAt),
        }))),
      );

      if (snapshot.caseCounter) {
        await tx
          .insert(caseCounters)
          .values({ guildId, nextCaseNumber: snapshot.caseCounter.nextCaseNumber })
          .onConflictDoUpdate({
            target: caseCounters.guildId,
            set: { nextCaseNumber: snapshot.caseCounter.nextCaseNumber },
          });
      }
    });
  }

  async applyLevels(
    guildId: string,
    rows: readonly LevelImportRow[],
    mode: LevelApplyMode,
    dryRun: boolean,
  ): Promise<LevelApplyResult> {
    const existingRows = await this.db.select().from(levels).where(eq(levels.guildId, guildId));
    const existing = new Map(existingRows.map((row) => [row.userId, row]));
    const writes: Array<{ userId: string; xp: number; level: number; updatedAt: Date }> = [];
    let unchanged = 0;
    let skipped = 0;
    let created = 0;
    let updated = 0;

    for (const row of rows) {
      if (!Number.isSafeInteger(row.xp) || row.xp < 0) {
        skipped += 1;
        continue;
      }
      const current = existing.get(row.userId);
      const xp =
        mode === "add-on-top"
          ? (current ? Number(current.xp) : 0) + row.xp
          : mode === "keep-higher"
            ? Math.max(current ? Number(current.xp) : 0, row.xp)
            : row.xp;
      if (!Number.isSafeInteger(xp) || xp < 0) {
        skipped += 1;
        continue;
      }
      if (current && Number(current.xp) === xp) {
        unchanged += 1;
        continue;
      }
      if (current) updated += 1;
      else created += 1;
      writes.push({ userId: row.userId, xp, level: keystoneLevelForXp(xp), updatedAt: new Date() });
    }

    if (!dryRun && writes.length > 0) {
      await this.db.transaction(async (tx) => {
        for (const chunk of chunked(writes, 500)) {
          await tx
            .insert(levels)
            .values(chunk.map((row) => ({ guildId, ...row })))
            .onConflictDoUpdate({
              target: [levels.guildId, levels.userId],
              set: {
                xp: sql`excluded.xp`,
                level: sql`excluded.level`,
                updatedAt: sql`excluded.updated_at`,
              },
            });
        }
      });
    }

    return { created, updated, unchanged, skipped };
  }

  async archiveTranscript(guildId: string, key: string, data: unknown): Promise<void> {
    await this.db
      .insert(communityRecords)
      .values({ guildId, kind: "ticket_transcript", key, data })
      .onConflictDoUpdate({
        target: [communityRecords.guildId, communityRecords.kind, communityRecords.key],
        set: { data, updatedAt: new Date() },
      });
  }

  async createImport(guildId: string, source: string, receipt: ImportReceipt): Promise<ImportRecord> {
    const [row] = await this.db
      .insert(imports)
      .values({ guildId, source, state: "pending", receipt })
      .returning({ id: imports.id });
    if (!row) throw new Error("Could not create an import receipt");
    const saved = await this.getImport(row.id);
    if (!saved) throw new Error("Could not read the import receipt back");
    return saved;
  }

  async updateImport(id: string, state: ImportState, receipt: ImportReceipt): Promise<ImportRecord> {
    const [row] = await this.db
      .update(imports)
      .set({ state, receipt, updatedAt: new Date() })
      .where(eq(imports.id, id))
      .returning({ id: imports.id });
    if (!row) throw new Error(`Import ${id} was not found`);
    const saved = await this.getImport(row.id);
    if (!saved) throw new Error(`Import ${id} was not found after update`);
    return saved;
  }

  async getImport(id: string): Promise<ImportRecord | undefined> {
    const [row] = await this.db
      .select({
        id: imports.id,
        guildId: imports.guildId,
        source: imports.source,
        state: imports.state,
        receipt: sql<string | null>`${imports.receipt}::text`,
        createdAt: imports.createdAt,
        updatedAt: imports.updatedAt,
      })
      .from(imports)
      .where(eq(imports.id, id))
      .limit(1);
    return row ? toImport(row) : undefined;
  }

  async createBackup(guildId: string, kind: string, payload: unknown): Promise<BackupRecord> {
    const [row] = await this.db
      .insert(backups)
      .values({ guildId, kind, state: "ready", payload })
      .returning({ id: backups.id });
    if (!row) throw new Error("Could not create a backup");
    const saved = await this.getBackup(row.id);
    if (!saved) throw new Error("Could not read the backup back");
    return saved;
  }

  async getBackup(id: string): Promise<BackupRecord | undefined> {
    const [row] = await this.db
      .select({
        id: backups.id,
        guildId: backups.guildId,
        kind: backups.kind,
        state: backups.state,
        payload: sql<string | null>`${backups.payload}::text`,
        createdAt: backups.createdAt,
      })
      .from(backups)
      .where(eq(backups.id, id))
      .limit(1);
    return row ? toBackup(row) : undefined;
  }

  async deleteGuild(guildId: string, receipt: ImportReceipt): Promise<ImportRecord> {
    return this.db.transaction(async (tx) => {
      await tx.delete(backups).where(eq(backups.guildId, guildId));
      await tx.delete(caseEvents).where(
        sql`${caseEvents.caseId} IN (SELECT ${cases.id} FROM ${cases} WHERE ${cases.guildId} = ${guildId})`,
      );
      await tx.delete(cases).where(eq(cases.guildId, guildId));
      await tx.delete(tickets).where(eq(tickets.guildId, guildId));
      await tx.delete(levels).where(eq(levels.guildId, guildId));
      await tx.delete(xpEvents).where(eq(xpEvents.guildId, guildId));
      await tx.delete(economyLedger).where(eq(economyLedger.guildId, guildId));
      await tx.delete(auditEvents).where(eq(auditEvents.guildId, guildId));
      await tx.delete(communityRecords).where(eq(communityRecords.guildId, guildId));
      await tx.delete(aiDocuments).where(eq(aiDocuments.guildId, guildId));
      await tx.delete(aiUsage).where(eq(aiUsage.guildId, guildId));
      await tx.delete(members).where(eq(members.guildId, guildId));
      await tx.delete(settings).where(eq(settings.guildId, guildId));
      await tx.delete(caseCounters).where(eq(caseCounters.guildId, guildId));
      await tx.delete(configBaselines).where(eq(configBaselines.guildId, guildId));
      await tx.delete(guilds).where(eq(guilds.id, guildId));

      const [row] = await tx
        .insert(imports)
        .values({ guildId, source: "deletion", state: "deleted", receipt })
        .returning({ id: imports.id, createdAt: imports.createdAt, updatedAt: imports.updatedAt });
      if (!row) throw new Error("Could not write the deletion receipt");
      return {
        id: row.id,
        guildId,
        source: "deletion",
        state: "deleted",
        receipt,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  /** Keep each INSERT under Postgres's 65,535-parameter ceiling. */
  private async insertChunked<T>(
    values: readonly T[],
    insert: (chunk: T[]) => Promise<unknown>,
  ): Promise<void> {
    for (const chunk of chunked(values, 500)) {
      await insert(chunk);
    }
  }
}

function toImport(row: {
  id: string;
  guildId: string;
  source: string;
  state: string;
  receipt: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ImportRecord {
  return {
    id: row.id,
    guildId: row.guildId,
    source: row.source,
    state: row.state as ImportState,
    receipt: readJson(row.receipt) as ImportReceipt | null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toBackup(row: {
  id: string;
  guildId: string;
  kind: string;
  state: string;
  payload: string | null;
  createdAt: Date;
}): BackupRecord {
  return {
    id: row.id,
    guildId: row.guildId,
    kind: row.kind,
    state: row.state,
    payload: readJson(row.payload),
    createdAt: row.createdAt.toISOString(),
  };
}

function chunked<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size) as T[]);
  }
  return chunks;
}
