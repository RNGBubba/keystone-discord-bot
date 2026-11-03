/**
 * Discord OAuth2 and bot-membership port.
 *
 * The port exists so tests never touch the network. The production adapter is
 * deliberately the only file in the web app that knows Discord's URLs.
 */

export interface DiscordUser {
  id: string;
  username: string;
  globalName?: string | null;
}

export interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  /** Decimal permission bitfield from Discord; parse with BigInt. */
  permissions: string;
}

export interface OAuthTokens {
  accessToken: string;
}

export interface AuthorizationInput {
  state: string;
  codeChallenge: string;
  redirectUri: string;
}

export interface ExchangeInput {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export interface DiscordOAuth {
  authorizationUrl(input: AuthorizationInput): string;
  exchangeCode(input: ExchangeInput): Promise<OAuthTokens>;
  fetchUser(accessToken: string): Promise<DiscordUser>;
  fetchGuilds(accessToken: string): Promise<DiscordGuild[]>;
  botInGuild(guildId: string): Promise<boolean>;
  /**
   * Ask Discord to invalidate an access token. Logout calls this before it
   * deletes the local session; the port keeps the request testable without a
   * real Discord client.
   */
  revokeToken(accessToken: string): Promise<void>;
}

export interface DiscordOAuthOptions {
  clientId: string;
  clientSecret: string;
  botToken: string;
}

const DISCORD_AUTHORIZE = "https://discord.com/oauth2/authorize";
const DISCORD_API = "https://discord.com/api/v10";

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    // Never include response headers or request bodies: they can contain tokens.
    throw new Error(`Discord request failed with HTTP ${response.status}.`);
  }
  return (await response.json()) as T;
}

export class DiscordOAuthClient implements DiscordOAuth {
  constructor(private readonly options: DiscordOAuthOptions) {}

  authorizationUrl(input: AuthorizationInput): string {
    const url = new URL(DISCORD_AUTHORIZE);
    url.searchParams.set("client_id", this.options.clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("scope", "identify guilds");
    url.searchParams.set("state", input.state);
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  }

  async exchangeCode(input: ExchangeInput): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    });
    const tokens = await requestJson<{ access_token: string }>(`${DISCORD_API}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    return { accessToken: tokens.access_token };
  }

  async fetchUser(accessToken: string): Promise<DiscordUser> {
    const user = await requestJson<{ id: string; username: string; global_name?: string | null }>(
      `${DISCORD_API}/users/@me`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    return { id: user.id, username: user.username, globalName: user.global_name ?? null };
  }

  async fetchGuilds(accessToken: string): Promise<DiscordGuild[]> {
    const guilds = await requestJson<
      Array<{ id: string; name: string; icon: string | null; owner: boolean; permissions: string }>
    >(`${DISCORD_API}/users/@me/guilds`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return guilds.map((guild) => ({
      id: guild.id,
      name: guild.name,
      icon: guild.icon,
      owner: guild.owner,
      permissions: guild.permissions,
    }));
  }

  async botInGuild(guildId: string): Promise<boolean> {
    const response = await fetch(`${DISCORD_API}/guilds/${encodeURIComponent(guildId)}`, {
      headers: { Authorization: `Bot ${this.options.botToken}` },
    });
    if (response.status === 404 || response.status === 403) return false;
    if (!response.ok) throw new Error(`Discord guild check failed with HTTP ${response.status}.`);
    return true;
  }

  async revokeToken(accessToken: string): Promise<void> {
    const body = new URLSearchParams({
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      token: accessToken,
      token_type_hint: "access_token",
    });
    const response = await fetch(`${DISCORD_API}/oauth2/token/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    // 400 means Discord no longer recognises the token, which is the outcome
    // logout wants; anything else is a real failure the caller reports.
    if (!response.ok && response.status !== 400) {
      throw new Error(`Discord token revocation failed with HTTP ${response.status}.`);
    }
  }
}
