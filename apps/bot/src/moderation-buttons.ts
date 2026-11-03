import { UserError, type ComponentRouter } from "@keystone/kernel";
import type { ModerationPort, ModuleSettings, ReplyInput } from "@keystone/kernel";
import {
  completeVerification,
  moderationSettingsSchema,
  parseVerifyPayload,
} from "@keystone/module-moderation";

/**
 * The slice of an interaction the moderation handlers need. The router passes
 * its own `ComponentInteractionLike`, so these routes are exercised by the same
 * adapter and signature checks as every other panel.
 */
export interface ModerationButtonInteraction {
  readonly guildId: string | null;
  readonly userId: string;
  reply(input: ReplyInput): Promise<unknown>;
}

export interface ModerationButtonDeps {
  /** Already scoped to the moderation module by the composition root. */
  readonly settings: ModuleSettings;
  readonly moderation: ModerationPort;
}

/**
 * Register moderation's two member-facing buttons on the shared router. The
 * module mints the ids (`appealCustomId`, `verifyCustomId`); this adapter only
 * connects a verified id to the service call.
 */
export function registerModerationRoutes(
  router: ComponentRouter,
  deps: ModerationButtonDeps,
): ComponentRouter {
  router.register({
    namespace: "appeal",
    action: "open",
    kind: "button",
    guildOnly: true,
    async handle({ interaction, payload, guildId }) {
      if (!guildId) return;
      await handleAppealButton(interaction, guildId, payload, deps);
    },
  });

  router.register({
    namespace: "verify",
    action: "complete",
    kind: "button",
    // A DM has no guild, so the signed payload names the guild instead. The
    // router treats it as this id's guild: it satisfies `guildOnly` and a click
    // in another server is refused before the handler runs.
    guildOnly: true,
    guildFromPayload: (payload) => parseVerifyPayload(payload)?.guildId ?? null,
    async handle({ interaction, payload }) {
      const route = parseVerifyPayload(payload);
      if (!route) throw new UserError("That verification link is not valid.");
      await handleVerifyButton(interaction, route, deps);
    },
  });

  return router;
}

/**
 * The case button is member-facing: there is no staff permission to check.
 * Authorization is the case service's target-only rule, plus the operator's
 * `appealsEnabled` switch and the signed id's guild. The reply text is
 * intentionally unchanged from the inline version this replaced.
 */
export async function handleAppealButton(
  button: ModerationButtonInteraction,
  guildId: string,
  caseId: string,
  deps: ModerationButtonDeps,
): Promise<void> {
  try {
    const settings = moderationSettingsSchema.parse(await deps.settings.get(guildId));
    if (!settings.appealsEnabled) {
      await button.reply({ content: "Appeals are disabled in this server.", ephemeral: true });
      return;
    }

    // The signed payload is only the case id, so the guild check is explicit:
    // a panel from another server cannot mutate a case here.
    const existing = await deps.moderation.cases.getById(caseId);
    if (!existing || existing.guildId !== guildId) {
      throw new UserError("That case does not exist.");
    }

    const record = await deps.moderation.cases.appealById(
      caseId,
      button.userId,
      "Appeal requested from the case button.",
    );
    await button.reply({
      content: `Appeal opened for case #${record.caseNumber}. A moderator can review it with /mod review.`,
      ephemeral: true,
    });
  } catch (error) {
    await button.reply({
      content: error instanceof UserError ? error.message : "Could not open that appeal.",
      ephemeral: true,
    });
  }
}

/**
 * The verify button is also member-facing, but the encoded user id is an
 * identity check, not a hint: a click from anyone else is refused before any
 * settings or store read. `completeVerification` owns the rest of the state
 * machine (gate, quarantine row, action order).
 */
export async function handleVerifyButton(
  button: ModerationButtonInteraction,
  route: { readonly guildId: string; readonly userId: string },
  deps: ModerationButtonDeps,
): Promise<void> {
  // A DM has no guild, and Discord rejects ephemeral replies there. In a guild
  // the member's status stays private.
  const ephemeral = button.guildId !== null;

  if (button.userId !== route.userId) {
    await button.reply({
      content: "This verification belongs to another member.",
      ephemeral,
    });
    return;
  }

  try {
    const settings = moderationSettingsSchema.parse(await deps.settings.get(route.guildId));
    const outcome = await completeVerification({
      guildId: route.guildId,
      userId: route.userId,
      actorId: button.userId,
      settings,
      members: deps.moderation.members,
      actions: deps.moderation.actions,
    });
    await button.reply({ content: outcome.message, ephemeral });
  } catch (error) {
    await button.reply({
      content: error instanceof Error ? error.message : "Could not verify you.",
      ephemeral,
    });
  }
}
