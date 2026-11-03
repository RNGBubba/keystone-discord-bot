import type { Telemetry } from "@keystone/kernel";
import type { PostgresHandle } from "./client";
import { DrizzleSettingsRepository } from "./settings-repository";
import { DrizzleAuditStore } from "./audit-store";
import { DrizzleConfigBaselineStore } from "./config-baseline-store";
import { DrizzleSavedTemplateStore } from "./config-template-store";
import { PostgresIdempotencyStore } from "./idempotency";
import { DrizzleCaseStore } from "./case-store";
import { DrizzleMemberStore } from "./member-store";
import { DrizzleCommunityStore } from "./community-store";
import { DrizzleAiStore } from "./ai-store";
import { DrizzlePortabilityStore } from "./portability-store";
import { DrizzleSessionStore } from "./web-session-store";
import { DrizzleDashboardStore } from "./web-dashboard-store";
import { DrizzleInviteStore } from "./invite-store";
import { DrizzleLoggingStore } from "./logging-store";
import { DrizzleAnalyticsStore } from "./analytics-store";
import { DrizzleCommandUsageStore } from "./command-usage-store";
import { DrizzleMusicStore } from "./music-store";
import { DrizzleFormStore } from "./form-store";
import { DrizzleEventStore } from "./event-store";
import { DrizzleModmailStore } from "./modmail-store";
import { DrizzlePanicStore } from "./panic-store";

/**
 * Factories so the composition root never needs Drizzle's generic types.
 * Keeping the casts here is the difference between one awkward file and an
 * application layer that knows about query builders.
 */
export function createSettingsRepository(
  handle: PostgresHandle,
  telemetry?: Telemetry,
): DrizzleSettingsRepository {
  return new DrizzleSettingsRepository(handle.db as never, telemetry);
}

export function createAuditStore(handle: PostgresHandle): DrizzleAuditStore {
  return new DrizzleAuditStore(handle.db as never);
}

export function createConfigBaselineStore(
  handle: PostgresHandle,
): DrizzleConfigBaselineStore {
  return new DrizzleConfigBaselineStore(handle.db as never);
}

export function createSavedTemplateStore(
  handle: PostgresHandle,
): DrizzleSavedTemplateStore {
  return new DrizzleSavedTemplateStore(handle.db as never);
}

export function createIdempotencyStore(handle: PostgresHandle): PostgresIdempotencyStore {
  return new PostgresIdempotencyStore(handle.db as never);
}

export function createCaseStore(handle: PostgresHandle): DrizzleCaseStore {
  return new DrizzleCaseStore(handle.db as never);
}

export function createMemberStore(handle: PostgresHandle): DrizzleMemberStore {
  return new DrizzleMemberStore(handle.db as never);
}

export function createCommunityStore(handle: PostgresHandle): DrizzleCommunityStore {
  return new DrizzleCommunityStore(handle.db as never);
}

export function createAiStore(handle: PostgresHandle): DrizzleAiStore {
  return new DrizzleAiStore(handle.db as never);
}

export function createPortabilityStore(handle: PostgresHandle): DrizzlePortabilityStore {
  return new DrizzlePortabilityStore(handle.db as never);
}

export function createSessionStore(handle: PostgresHandle): DrizzleSessionStore {
  return new DrizzleSessionStore(handle.db as never);
}

export function createDashboardStore(handle: PostgresHandle): DrizzleDashboardStore {
  return new DrizzleDashboardStore(handle.db as never);
}

export function createInviteStore(handle: PostgresHandle): DrizzleInviteStore {
  return new DrizzleInviteStore(handle.db as never);
}

export function createLoggingStore(handle: PostgresHandle): DrizzleLoggingStore {
  return new DrizzleLoggingStore(handle.db as never);
}

export function createCommandUsageStore(handle: PostgresHandle): DrizzleCommandUsageStore {
  return new DrizzleCommandUsageStore(handle.db as never);
}

export function createAnalyticsStore(handle: PostgresHandle): DrizzleAnalyticsStore {
  return new DrizzleAnalyticsStore(handle.db as never);
}

export function createMusicStore(handle: PostgresHandle): DrizzleMusicStore {
  return new DrizzleMusicStore(handle.db as never);
}

export function createFormStore(handle: PostgresHandle): DrizzleFormStore {
  return new DrizzleFormStore(handle.db as never);
}

export function createEventStore(handle: PostgresHandle): DrizzleEventStore {
  return new DrizzleEventStore(handle.db as never);
}

export function createModmailStore(handle: PostgresHandle): DrizzleModmailStore {
  return new DrizzleModmailStore(handle.db as never);
}

export function createPanicStore(handle: PostgresHandle): DrizzlePanicStore {
  return new DrizzlePanicStore(handle.db as never);
}
