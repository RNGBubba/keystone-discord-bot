import type {
  CaseServicePort,
  JobQueue,
  ModerationActions,
  ModerationCase,
} from "@keystone/kernel";
import { caseEmbed } from "./format";
import type { ModerationSettings } from "./settings";

export type ExpiryOutcome =
  | { status: "expired"; record: ModerationCase }
  | { status: "missing" }
  | { status: "not-temporary" }
  | { status: "already-final"; record: ModerationCase }
  | { status: "in-progress" }
  | { status: "not-due"; remainingMs: number }
  | { status: "failed"; detail: string }
  | { status: "unsupported"; action: string };

/**
 * Temporary moderation, without a second scheduler.
 *
 * A case is the durable record. `expiresAt` is written after the punitive
 * action succeeds, and one delayed queue job is enqueued with the case id as
 * the idempotency key. The handler re-reads the case, so a redelivered job is a
 * no-op, and an early delivery can reschedule instead of releasing too soon.
 *
 * `recover()` is the restart path: overdue cases expire immediately, future
 * cases are re-enqueued. That matters in memory mode, where a process restart
 * drops the in-process queue; BullMQ already keeps the delayed job.
 */
export class TemporaryActionService {
  constructor(
    private readonly cases: CaseServicePort,
    private readonly actions: ModerationActions,
    private readonly settings: ModerationSettings,
    private readonly now: () => number = Date.now,
  ) {}

  /** Enqueue one release. Returns the job id, or undefined for a permanent case. */
  async schedule(queue: JobQueue, record: ModerationCase): Promise<string | undefined> {
    if (!record.expiresAt) return undefined;
    const due = new Date(record.expiresAt).getTime();
    if (!Number.isFinite(due)) return undefined;
    return queue.enqueue(
      "moderation.expire",
      { caseId: record.id, guildId: record.guildId },
      {
        delayMs: Math.max(0, due - this.now()),
        // BullMQ 6 only allows a colon in a custom id for its legacy three-part
        // shape; any other colon-bearing id is rejected. This key is stable per case.
        idempotencyKey: `moderation:expire:${record.id}`,
      },
    );
  }

  async expire(caseId: string): Promise<ExpiryOutcome> {
    const record = await this.cases.getById(caseId);
    if (!record) return { status: "missing" };
    if (record.state === "closed" || record.state === "reversed") {
      return { status: "already-final", record };
    }
    if (!record.expiresAt) return { status: "not-temporary" };

    const remainingMs = new Date(record.expiresAt).getTime() - this.now();
    if (Number.isFinite(remainingMs) && remainingMs > 0) {
      return { status: "not-due", remainingMs };
    }

    // Clear the timestamp first. Two workers can see the same due case; only
    // the one that clears it owns the Discord side effect. On failure the
    // timestamp is restored, so the case remains retryable.
    const claimed = await this.cases.claimExpiry(caseId);
    if (!claimed) return { status: "in-progress" };

    const reason = `Temporary ${record.action} expired (case #${record.caseNumber})`;
    const restore = async (): Promise<void> => {
      if (record.expiresAt) await this.cases.setExpiry(record.id, record.expiresAt);
    };
    let result;
    if (record.action === "ban") {
      result = await this.actions.unban(record.guildId, record.targetId, reason);
    } else if (record.action === "temp-role") {
      const roleId = evidenceRoleId(record.evidence);
      if (!roleId) {
        await restore();
        return { status: "failed", detail: "The case has no role id to remove." };
      }
      result = await this.actions.removeRole(
        record.guildId,
        record.targetId,
        roleId,
        reason,
      );
    } else {
      await restore();
      return { status: "unsupported", action: record.action };
    }

    if (!result.ok) {
      // Leave the case open: the member still has the action, and the next
      // recovery sweep should try again rather than silently declaring it over.
      await restore();
      await this.cases.note(
        record.id,
        "expiry",
        `release failed: ${result.detail ?? "unknown error"}`,
      );
      return { status: "failed", detail: result.detail ?? "unknown error" };
    }

    const updated = await this.cases.expire(record.id, "expiry", reason);
    if (updated) {
      await this.actions.notify(record.guildId, this.settings.modLogChannelId, {
        embeds: [caseEmbed(updated, `Case #${updated.caseNumber} expired`)],
      });
    }
    return { status: "expired", record: updated ?? record };
  }

  /**
   * Restart reconciliation. It is deliberately the same service the timer
   * handler calls, so a recovered case takes exactly the same path.
   */
  async recover(
    guildId: string,
    queue: JobQueue,
  ): Promise<{ expired: number; failed: number; scheduled: number }> {
    const now = new Date(this.now()).toISOString();
    let expired = 0;
    let failed = 0;
    let scheduled = 0;

    for (const record of await this.cases.listDueExpiries(guildId, now)) {
      const result = await this.expire(record.id);
      if (result.status === "expired") expired += 1;
      else if (result.status === "failed") failed += 1;
    }

    for (const record of await this.cases.listPendingExpiries(guildId, now)) {
      if (await this.schedule(queue, record)) scheduled += 1;
    }

    return { expired, failed, scheduled };
  }
}

function evidenceRoleId(evidence: unknown): string | undefined {
  if (typeof evidence !== "object" || evidence === null) return undefined;
  const roleId = (evidence as { roleId?: unknown }).roleId;
  return typeof roleId === "string" && roleId.length > 0 ? roleId : undefined;
}
