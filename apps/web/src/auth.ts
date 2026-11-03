import { createHash } from "node:crypto";
import type { SessionStore, WebSession } from "@keystone/kernel";
import {
  SecretBox,
  constantTimeEqual,
  openState,
  randomToken,
  sealState,
  sha256,
  type OAuthState,
} from "./crypto";
import { HttpError } from "./http-error";
import { OAuthRefreshRejected, type DiscordOAuth, type OAuthTokens } from "./oauth";

export interface AuthConfig {
  /** OAuth values are optional so the server can boot in degraded local mode. */
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  issuer: string;
  sessionTtlMs: number;
  /** Re-key a signed-in session after this age on a safe GET. 0 disables. */
  rotationIntervalMs?: number;
  /** Reject a session unused for this long. 0 disables (tests only). */
  idleTimeoutMs?: number;
  /** Write activity at most this often; 0 writes on every request. */
  touchIntervalMs?: number;
  /** Discord user ids allowed to act on the whole instance. */
  owners?: readonly string[];
}

export interface AuthDependencies {
  oauth?: DiscordOAuth;
  sessions: SessionStore;
  box: SecretBox;
  config: AuthConfig;
  now?: () => number;
}

export interface BeginResult {
  authorizationUrl: string;
  stateCookie: string;
}

export interface CompleteInput {
  code: string;
  state: string;
  iss: string;
  stateCookie: string | undefined;
}

export interface CompleteResult {
  sessionToken: string;
  csrfToken: string;
}

export interface SessionRotation {
  sessionToken: string;
  csrfToken: string;
  /** Remaining absolute lifetime, so the new cookie cannot outlive the row. */
  maxAgeMs: number;
}

export interface SessionResolution {
  session: WebSession | undefined;
  /** Present when the cookie was re-keyed during this request. */
  rotated?: SessionRotation;
}

export interface LogoutResult {
  /** True only when Discord accepted the revocation request. */
  revoked: boolean;
}

/**
 * OAuth2 authorization-code + PKCE with a server-side opaque session.
 *
 * `state` and the PKCE verifier live in an HttpOnly, AEAD-sealed cookie bound
 * to this one attempt. The session cookie is a random value; only its SHA-256
 * hash is stored. The Discord access and refresh tokens are sealed before they
 * reach the session store and are never returned by any route. The refresh
 * token is rotated on every use and persisted in the same write that stores the
 * new access token, so a used credential is never left where a later request
 * could present it again. Rotation re-keys the opaque cookie, not the grant.
 */
export class AuthService {
  private readonly now: () => number;
  /** One in-flight refresh per session, so two requests cannot spend one token. */
  readonly #refreshes = new Map<string, Promise<WebSession | undefined>>();

  constructor(private readonly deps: AuthDependencies) {
    this.now = deps.now ?? Date.now;
  }

  get oauthConfigured(): boolean {
    return Boolean(
      this.deps.oauth &&
        this.deps.config.clientId &&
        this.deps.config.clientSecret &&
        this.deps.config.redirectUri,
    );
  }

  get ttlMs(): number {
    return this.deps.config.sessionTtlMs;
  }

  get rotationIntervalMs(): number {
    return this.deps.config.rotationIntervalMs ?? 0;
  }

  get idleTimeoutMs(): number {
    return this.deps.config.idleTimeoutMs ?? 0;
  }

  get touchIntervalMs(): number {
    return this.deps.config.touchIntervalMs ?? 30_000;
  }

  get owners(): readonly string[] {
    return this.deps.config.owners ?? [];
  }

  isOwner(session: WebSession): boolean {
    return this.owners.includes(session.userId);
  }

  private requireOAuth(): DiscordOAuth {
    const oauth = this.deps.oauth;
    if (!this.oauthConfigured || !oauth) {
      throw new HttpError(
        503,
        "The dashboard OAuth client is not configured. Set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET and DISCORD_OAUTH_REDIRECT_URI.",
        "oauth_unconfigured",
      );
    }
    return oauth;
  }

  begin(): BeginResult {
    const oauth = this.requireOAuth();
    const state = randomToken(24);
    const verifier = randomToken(32);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const redirectUri = this.deps.config.redirectUri as string;
    const stateCookie = sealState(this.deps.box, {
      state,
      verifier,
      redirectUri,
      createdAt: this.now(),
    });
    return {
      authorizationUrl: oauth.authorizationUrl({ state, codeChallenge: challenge, redirectUri }),
      stateCookie,
    };
  }

  async complete(input: CompleteInput): Promise<CompleteResult> {
    const oauth = this.requireOAuth();
    if (!input.code) throw new HttpError(400, "The OAuth code is missing.", "code_missing");
    if (!input.stateCookie) throw new HttpError(400, "The OAuth state cookie is missing.", "state_missing");
    if (!input.state) throw new HttpError(400, "The OAuth state is missing.", "state_missing");
    if (input.iss !== this.deps.config.issuer) {
      throw new HttpError(400, "The OAuth issuer is not trusted.", "issuer_mismatch");
    }

    let state: OAuthState;
    try {
      state = openState(this.deps.box, input.stateCookie, this.now());
    } catch {
      throw new HttpError(400, "The OAuth state is invalid or expired.", "state_invalid");
    }
    if (!constantTimeEqual(state.state, input.state)) {
      throw new HttpError(400, "The OAuth state does not match this login attempt.", "state_mismatch");
    }
    if (state.redirectUri !== this.deps.config.redirectUri) {
      throw new HttpError(400, "The OAuth redirect URI changed during login.", "redirect_mismatch");
    }

    const tokens = await oauth.exchangeCode({
      code: input.code,
      codeVerifier: state.verifier,
      redirectUri: state.redirectUri,
    });
    const user = await oauth.fetchUser(tokens.accessToken);
    const sessionToken = randomToken(32);
    const csrfToken = randomToken(24);
    const now = this.now();
    const expiresAtMs = now + this.deps.config.sessionTtlMs;
    const accessExpiresAt = this.accessExpiry(tokens, now, expiresAtMs);
    const session: WebSession = {
      id: sha256(sessionToken),
      userId: user.id,
      username: user.username,
      accessToken: this.deps.box.seal(tokens.accessToken),
      ...(tokens.refreshToken ? { refreshToken: this.deps.box.seal(tokens.refreshToken) } : {}),
      accessExpiresAt,
      csrfHash: sha256(csrfToken),
      createdAt: new Date(now).toISOString(),
      lastSeenAt: new Date(now).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
    await this.deps.sessions.create(session);
    return { sessionToken, csrfToken };
  }

  async session(sessionToken: string | undefined): Promise<WebSession | undefined> {
    if (!sessionToken) return undefined;
    const session = await this.deps.sessions.get(sha256(sessionToken));
    if (!session) return undefined;
    const now = this.now();
    if (Date.parse(session.expiresAt) <= now) {
      await this.deps.sessions.delete(session.id);
      return undefined;
    }
    const idle = this.idleTimeoutMs;
    if (idle > 0 && now - Date.parse(session.lastSeenAt) > idle) {
      // The row is deleted, not merely refused: an abandoned credential should
      // stop existing, and the next request must not get a second chance with it.
      await this.deps.sessions.delete(session.id);
      return undefined;
    }
    return session;
  }

  /**
   * Resolve the browser cookie and, on a safe GET past the rotation interval,
   * re-key it. Rotation is deliberately limited to GET/HEAD: a POST carries a
   * CSRF token minted for the old cookie, so rotating before checking it would
   * turn a valid form into a 403. The absolute `expiresAt` never moves; only
   * `createdAt` becomes the issue time of the current credential.
   *
   * Before anything else, an expired Discord access token is refreshed once for
   * every concurrent caller. A session with no refresh credential and an expired
   * access token is deleted: it cannot do anything a signed-in user expects, so
   * pretending it is alive only defers the 401.
   */
  async resolve(sessionToken: string | undefined, method: string): Promise<SessionResolution> {
    let session = await this.session(sessionToken);
    if (!session) return { session: undefined };

    if (Date.parse(session.accessExpiresAt) <= this.now()) {
      if (!session.refreshToken) {
        await this.deps.sessions.delete(session.id);
        return { session: undefined };
      }
      const refreshed = await this.refresh(session);
      if (!refreshed) return { session: undefined };
      session = refreshed;
    }

    const interval = this.rotationIntervalMs;
    const now = this.now();
    if (
      interval > 0 &&
      (method === "GET" || method === "HEAD") &&
      now - Date.parse(session.createdAt) >= interval
    ) {
      const remaining = Date.parse(session.expiresAt) - now;
      if (remaining <= 0) return { session: undefined };

      const sessionTokenNext = randomToken(32);
      const csrfToken = randomToken(24);
      const next: WebSession = {
        ...session,
        id: sha256(sessionTokenNext),
        csrfHash: sha256(csrfToken),
        createdAt: new Date(now).toISOString(),
        lastSeenAt: new Date(now).toISOString(),
      };
      if (!(await this.deps.sessions.rotate(session.id, next))) {
        // Another request already rotated this credential; the presented value is
        // one-use, so treat it as gone instead of reviving it.
        return { session: undefined };
      }
      return { session: next, rotated: { sessionToken: sessionTokenNext, csrfToken, maxAgeMs: remaining } };
    }

    const active = await this.touch(session);
    if (!active) return { session: undefined };
    return { session: active };
  }

  /**
   * Record activity, throttled so a dashboard burst is one write rather than
   * one per asset. The idle window itself is read before this runs, so a stale
   * session never gets touched alive again.
   */
  private async touch(session: WebSession): Promise<WebSession | undefined> {
    const now = this.now();
    if (now - Date.parse(session.lastSeenAt) < this.touchIntervalMs) return session;
    const lastSeenAt = new Date(now).toISOString();
    if (!(await this.deps.sessions.touch(session.id, lastSeenAt))) return undefined;
    return { ...session, lastSeenAt };
  }

  /** The access-token lifetime, never past the session's absolute expiry. */
  private accessExpiry(tokens: OAuthTokens, now: number, absoluteExpiryMs: number): string {
    const lifetime =
      tokens.expiresInSeconds !== undefined
        ? tokens.expiresInSeconds * 1_000
        : this.deps.config.sessionTtlMs;
    return new Date(Math.min(now + lifetime, absoluteExpiryMs)).toISOString();
  }

  /** One refresh per session id; concurrent callers await the same promise. */
  private refresh(session: WebSession): Promise<WebSession | undefined> {
    const existing = this.#refreshes.get(session.id);
    if (existing) return existing;

    let promise: Promise<WebSession | undefined>;
    promise = this.#doRefresh(session).finally(() => {
      if (this.#refreshes.get(session.id) === promise) this.#refreshes.delete(session.id);
    });
    this.#refreshes.set(session.id, promise);
    return promise;
  }

  async #doRefresh(session: WebSession): Promise<WebSession | undefined> {
    const oauth = this.deps.oauth;
    let refreshToken: string;
    try {
      if (!oauth || !session.refreshToken) throw new Error("no refresh credential");
      refreshToken = this.deps.box.open(session.refreshToken);
    } catch {
      await this.deps.sessions.delete(session.id);
      return undefined;
    }

    let tokens: OAuthTokens;
    try {
      tokens = await oauth.refreshToken(refreshToken);
    } catch (error) {
      // A refused token is permanent: delete the row. A transport failure is not,
      // so leave it for a later request instead of logging the user out on a
      // network blip.
      if (error instanceof OAuthRefreshRejected) {
        await this.deps.sessions.delete(session.id);
      }
      return undefined;
    }

    const now = this.now();
    const credentials = {
      accessToken: this.deps.box.seal(tokens.accessToken),
      // Discord rotates the refresh token. If it ever omits the new value, keep
      // the current one rather than deleting a credential that still works.
      ...(tokens.refreshToken
        ? { refreshToken: this.deps.box.seal(tokens.refreshToken) }
        : session.refreshToken
          ? { refreshToken: session.refreshToken }
          : {}),
      accessExpiresAt: this.accessExpiry(tokens, now, Date.parse(session.expiresAt)),
      lastSeenAt: new Date(now).toISOString(),
    };
    if (!(await this.deps.sessions.updateTokens(session.id, credentials))) {
      return undefined;
    }
    return { ...session, ...credentials };
  }

  accessToken(session: WebSession): string {
    try {
      return this.deps.box.open(session.accessToken);
    } catch {
      throw new HttpError(401, "The session is no longer usable. Sign in again.", "session_invalid");
    }
  }

  csrfValid(session: WebSession, csrfToken: string | undefined): boolean {
    return Boolean(csrfToken) && constantTimeEqual(sha256(csrfToken as string), session.csrfHash);
  }

  /**
   * Revoke at Discord first, then delete the local session. Revocation is
   * best-effort: if Discord is unavailable the browser session must still die,
   * and the caller can report that the remote token was not confirmed dead.
   */
  async logout(session: WebSession): Promise<LogoutResult> {
    let revoked = false;
    const oauth = this.deps.oauth;
    if (this.oauthConfigured && oauth) {
      // Revoke the refresh credential when there is one: revoking only the
      // access token would leave the grant able to mint a replacement.
      let token: string;
      let hint: "access_token" | "refresh_token" = "refresh_token";
      try {
        token = session.refreshToken
          ? this.deps.box.open(session.refreshToken)
          : this.accessToken(session);
        if (!session.refreshToken) hint = "access_token";
      } catch {
        token = "";
      }
      if (token) {
        try {
          await oauth.revokeToken(token, hint);
          revoked = true;
        } catch {
          revoked = false;
        }
      }
    }
    await this.deps.sessions.delete(session.id);
    return { revoked };
  }

  /** Instance-owner action: sign a user out of every dashboard session. */
  async revokeUserSessions(userId: string): Promise<number> {
    return this.deps.sessions.deleteForUser(userId);
  }
}
