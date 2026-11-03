import { createHmac, timingSafeEqual } from "node:crypto";
import { UserError } from "./errors";
import type { ComponentKind, ModalSpec, ReplyInput } from "./types";

/**
 * The structural slice of a button, select or modal submit the router needs.
 * `apps/bot/src/adapt.ts` is the only place that turns a real discord.js
 * interaction into this shape, so the routing rules below are token-free.
 */
export interface ComponentInteractionLike {
  readonly kind: ComponentKind;
  readonly customId: string;
  readonly guildId: string | null;
  readonly channelId: string | null;
  readonly userId: string;
  readonly permissions: readonly string[];
  /** Selected values for a string select; undefined otherwise. */
  readonly values?: readonly string[];
  /** Text input values for a modal submit, keyed by input custom id. */
  readonly fields?: Readonly<Record<string, string>>;
  readonly replied: boolean;
  reply(input: ReplyInput): Promise<unknown>;
  update?(input: ReplyInput): Promise<unknown>;
  showModal?(modal: ModalSpec): Promise<unknown>;
  deferReply?(input?: { ephemeral?: boolean }): Promise<unknown>;
  editReply?(input: ReplyInput): Promise<unknown>;
  followUp?(input: ReplyInput): Promise<unknown>;
}

export interface ComponentRouteContext {
  readonly interaction: ComponentInteractionLike;
  readonly namespace: string;
  readonly action: string;
  readonly payload: string;
  /**
   * The guild this id is bound to: the interaction's guild, or the guild a
   * signed payload supplies for a DM button that has no guild context.
   */
  readonly guildId: string | null;
  readonly now: number;
  /** The guild's locale; handlers translate their own replies. */
  readonly locale: string;
}

export interface ComponentRoute {
  readonly namespace: string;
  readonly action: string;
  readonly kind: ComponentKind;
  /** Any one of these Discord permission names is enough. */
  readonly permissions?: readonly string[];
  /** Refuse when the interaction has no guild id. */
  readonly guildOnly?: boolean;
  /**
   * The guild a signed id names when the interaction itself carries none, as in
   * a DM. The router treats the result as the id's guild: it satisfies
   * `guildOnly`, reaches the handler as `context.guildId`, and a click in a
   * different guild is refused before the handler runs.
   */
  guildFromPayload?(payload: string): string | null;
  handle(context: ComponentRouteContext): Promise<void>;
}

// --- signed, expiring custom ids -----------------------------------------

const PREFIX = "k1";
const NAME = /^[a-z0-9_-]{1,12}$/;
const PAYLOAD = /^[A-Za-z0-9_-]{0,40}$/;
/** Discord's hard limit; a longer id is rejected before it reaches a message. */
export const MAX_CUSTOM_ID_LENGTH = 100;

export interface ComponentIdInput {
  readonly namespace: string;
  readonly action: string;
  /** Optional opaque value, e.g. a form id or case id. */
  readonly payload?: string;
  readonly ttlMs: number;
}

export type ComponentIdParse =
  | {
      readonly ok: true;
      readonly namespace: string;
      readonly action: string;
      readonly payload: string;
      readonly expiresAt: number;
    }
  | { readonly ok: false; readonly reason: "foreign" | "malformed" | "expired" | "signature" };

export interface ComponentSigner {
  sign(input: ComponentIdInput, now?: number): string;
  parse(customId: string, now?: number): ComponentIdParse;
}

/** The signer shape a panel or button needs; the composition root owns the secret. */
export type PanelSigner = Pick<ComponentSigner, "sign">;

/**
 * Fail before a message is posted rather than shipping an unsigned control.
 * One refusal for every module: a bot composed without a signer cannot produce
 * a safe button, whichever module owns the panel.
 */
export function requirePanelSigner(signer: PanelSigner | undefined): PanelSigner {
  if (!signer) throw new UserError("Interactive panels are not configured on this bot.");
  return signer;
}

/**
 * A component id carries its own namespace, action, payload and expiry, signed
 * with an HMAC. That means a stale panel is refused without a database read,
 * and a forged id cannot point a handler at another guild's record. The format
 * is `k1:<sig>:<exp>:<namespace>:<action>:<payload>`; anything without the
 * prefix belongs to another feature and the router leaves it alone.
 */
export function createComponentSigner(secret: string, clock: () => number = Date.now): ComponentSigner {
  if (!secret) throw new Error("a component signer needs a non-empty secret");

  const signature = (namespace: string, action: string, expiresAt: number, payload: string): string =>
    createHmac("sha256", secret)
      .update(`${namespace}:${action}:${expiresAt}:${payload}`)
      .digest("base64url")
      .slice(0, 16);

  return {
    sign(input, now = clock()): string {
      if (!NAME.test(input.namespace)) throw new Error(`invalid component namespace "${input.namespace}"`);
      if (!NAME.test(input.action)) throw new Error(`invalid component action "${input.action}"`);
      const payload = input.payload ?? "";
      if (!PAYLOAD.test(payload)) throw new Error(`invalid component payload "${payload}"`);
      if (input.ttlMs <= 0) throw new Error("a component id must expire in the future");

      // Seconds keep the id short; the check below treats it as an instant.
      const expiresAt = Math.floor((now + input.ttlMs) / 1_000);
      const id = `${PREFIX}:${signature(input.namespace, input.action, expiresAt, payload)}:${expiresAt.toString(36)}:${input.namespace}:${input.action}:${payload}`;
      if (id.length > MAX_CUSTOM_ID_LENGTH) {
        throw new Error(`component id is ${id.length} chars; Discord allows ${MAX_CUSTOM_ID_LENGTH}`);
      }
      return id;
    },

    parse(customId, now = clock()): ComponentIdParse {
      if (!customId.startsWith(`${PREFIX}:`)) return { ok: false, reason: "foreign" };
      const parts = customId.split(":");
      if (parts.length !== 6) return { ok: false, reason: "malformed" };
      const [, sig, encodedExpiry, namespace, action, payload] = parts as [
        string,
        string,
        string,
        string,
        string,
        string,
      ];
      if (!NAME.test(namespace) || !NAME.test(action) || !PAYLOAD.test(payload)) {
        return { ok: false, reason: "malformed" };
      }
      if (!/^[0-9a-z]{1,10}$/.test(encodedExpiry) || sig.length !== 16) {
        return { ok: false, reason: "malformed" };
      }

      const expiresAt = parseInt(encodedExpiry, 36) * 1_000;
      const expected = signature(namespace, action, expiresAt / 1_000, payload);
      const given = Buffer.from(sig);
      const wanted = Buffer.from(expected);
      if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
        return { ok: false, reason: "signature" };
      }
      if (expiresAt <= now) return { ok: false, reason: "expired" };
      return { ok: true, namespace, action, payload, expiresAt };
    },
  };
}

// --- router ---------------------------------------------------------------

/** The three refusals the router owns, already translated by the caller. */
export interface ComponentMessages {
  readonly expired: string;
  readonly noPermission: string;
  readonly guildOnly: string;
  readonly wrongGuild: string;
}

export const DEFAULT_COMPONENT_MESSAGES: ComponentMessages = {
  expired: "That panel has expired. Run the command again to get a fresh one.",
  noPermission: "You do not have permission to use that button.",
  guildOnly: "That control only works inside a server.",
  wrongGuild: "That panel belongs to another server.",
};

export interface ComponentDispatchOptions {
  readonly locale?: string;
  readonly messages?: ComponentMessages;
}

/**
 * Routes signed component ids to one handler, checking the kind, the route's
 * permission gate and the id's expiry before the handler runs. Handlers own
 * their domain policy; the router owns the mechanics every panel shares.
 */
export class ComponentRouter {
  readonly #routes: ComponentRoute[] = [];

  register(route: ComponentRoute): this {
    this.#routes.push(route);
    return this;
  }

  get routes(): readonly ComponentRoute[] {
    return this.#routes;
  }

  /**
   * Returns true when this router owned the id, whether it handled it or
   * refused it. False means the id belongs to another listener.
   */
  async dispatch(
    interaction: ComponentInteractionLike,
    signer: ComponentSigner,
    now: number = Date.now(),
    options: ComponentDispatchOptions = {},
  ): Promise<boolean> {
    const messages = options.messages ?? DEFAULT_COMPONENT_MESSAGES;
    const parsed = signer.parse(interaction.customId, now);
    if (!parsed.ok) {
      if (parsed.reason === "foreign") return false;
      await refuse(interaction, messages.expired);
      return true;
    }

    const route = this.#routes.find(
      (candidate) =>
        candidate.namespace === parsed.namespace &&
        candidate.action === parsed.action &&
        candidate.kind === interaction.kind,
    );
    if (!route) return false;

    const guildId = route.guildFromPayload?.(parsed.payload) ?? interaction.guildId;
    if (route.guildOnly && !guildId) {
      await refuse(interaction, messages.guildOnly);
      return true;
    }
    if (interaction.guildId && guildId && interaction.guildId !== guildId) {
      await refuse(interaction, messages.wrongGuild);
      return true;
    }
    if (
      route.permissions?.length &&
      !route.permissions.some((permission) => interaction.permissions.includes(permission))
    ) {
      await refuse(interaction, messages.noPermission);
      return true;
    }

    try {
      await route.handle({
        interaction,
        namespace: parsed.namespace,
        action: parsed.action,
        payload: parsed.payload,
        guildId,
        now,
        locale: options.locale ?? "en",
      });
    } catch (error) {
      if (error instanceof UserError) {
        await refuse(interaction, error.message);
        return true;
      }
      throw error;
    }
    return true;
  }
}

async function refuse(interaction: ComponentInteractionLike, content: string): Promise<void> {
  if (interaction.replied && interaction.followUp) {
    await interaction.followUp({ content, ephemeral: true });
    return;
  }
  await interaction.reply({ content, ephemeral: true });
}
