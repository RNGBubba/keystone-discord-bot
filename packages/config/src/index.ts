import { z } from "zod";

/** Empty strings from a copied .env count as "not set". */
const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional(),
);

const booleanFlag = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  return false;
}, z.boolean());

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  DISCORD_TOKEN: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().min(20).optional(),
  ),
  DATABASE_URL: optionalString,
  REDIS_URL: optionalString,
  /** BullMQ queue name. Separate from any other Redis usage. */
  QUEUE_NAME: z.string().min(1).default("keystone"),
  /**
   * `full` requests optional privileged intents (welcome, scanner, transcripts).
   * `minimal` requests only non-privileged intents and reports the lost features.
   * The Developer Portal must have the matching intents enabled or login fails
   * with close code 4014.
   */
  INTENT_PROFILE: z.enum(["minimal", "full"]).default("full"),
  /** Tracing is opt-in; with neither flag nor endpoint it costs nothing. */
  OTEL_ENABLED: booleanFlag.default(false),
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalString,
  /** Optional OpenAI-compatible provider. All values are server-side. */
  AI_API_KEY: optionalString,
  AI_BASE_URL: optionalString,
  AI_MODEL: z.string().min(1).default("gpt-4o-mini"),
  AI_EMBEDDING_MODEL: z.string().min(1).default("text-embedding-3-small"),
  AI_INPUT_USD_PER_MILLION: z.coerce.number().min(0).default(0.15),
  AI_OUTPUT_USD_PER_MILLION: z.coerce.number().min(0).default(0.6),
  /**
   * Qwen3 and other reasoning models can spend the entire output budget on a
   * hidden reasoning stream and return empty content. Ollama honours
   * `think: false`; other OpenAI-compatible providers reject the field, so it
   * is opt-in.
   */
  AI_DISABLE_THINKING: booleanFlag.default(false),
  /**
   * Development-only test guild. It seeds AI chat in the in-memory settings
   * store and enables `!` prefix commands plus bot-authored mention chat for
   * this guild only. Ignored in production.
   */
  DEV_GUILD_ID: optionalString,
  /** P6 web surface. OAuth values are operator secrets; never expose them. */
  WEB_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  WEB_ORIGIN: optionalString,
  DISCORD_CLIENT_ID: optionalString,
  DISCORD_CLIENT_SECRET: optionalString,
  DISCORD_OAUTH_REDIRECT_URI: optionalString,
  DISCORD_OAUTH_ISSUER: z.string().url().default("https://discord.com"),
  SESSION_SECRET: optionalString,
  /**
   * Signs button, select and modal custom ids. Optional: without it the bot
   * generates a per-process key, which makes every pre-restart panel stale
   * instead of sharing a weak default across deployments.
   */
  INTERACTION_SECRET: optionalString,
  /**
   * Reject a dashboard session that has been unused for this long. The absolute
   * 7-day lifetime is separate and never extended by activity. One minute is
   * the floor so a misconfiguration cannot disable the idle check entirely.
   */
  WEB_SESSION_IDLE_MS: z.coerce.number().int().min(60_000).default(1_800_000),
  /**
   * Comma-separated Discord user ids allowed to act on the whole instance.
   * Guild Manage Server is deliberately not enough; see the dashboard security
   * contract. Empty means the owner console stays closed to everyone.
   */
  WEB_OWNER_IDS: optionalString,
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${details}`);
  }
  return parsed.data;
}

export function requireToken(env: Env): string {
  if (!env.DISCORD_TOKEN) {
    throw new Error(
      "DISCORD_TOKEN is not set. Copy .env.example to .env and paste your bot token.",
    );
  }
  return env.DISCORD_TOKEN;
}
