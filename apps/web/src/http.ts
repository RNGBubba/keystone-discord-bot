import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError } from "./http-error";

const MAX_BODY_BYTES = 2_048;
const MAX_SETTINGS_BYTES = 32 * 1024;
/** Enough for a 1 MB bundle plus multipart or URL-encoding overhead. */
const MAX_CONFIG_BODY_BYTES = 4 * 1024 * 1024;

export function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export function securityHeaders(res: ServerResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
}

export function appendSetCookie(res: ServerResponse, cookie: string): void {
  const existing = res.getHeader("Set-Cookie");
  const prior = Array.isArray(existing)
    ? existing.map(String)
    : typeof existing === "string"
      ? [existing]
      : [];
  res.setHeader("Set-Cookie", [...prior, cookie]);
}

export function send(
  res: ServerResponse,
  status: number,
  body: string,
  contentType: string,
  headers: Record<string, string | string[]> = {},
): void {
  res.statusCode = status;
  res.setHeader("Content-Type", contentType);
  for (const [name, value] of Object.entries(headers)) {
    // A rotated session sets its replacement cookie before the route runs.
    // Appending keeps that cookie when a route also sets one (for example a
    // logout that clears it), instead of silently dropping the rotation.
    if (name === "Set-Cookie") {
      for (const cookie of Array.isArray(value) ? value : [value]) appendSetCookie(res, cookie);
      continue;
    }
    res.setHeader(name, value);
  }
  res.end(body);
}

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  cookies: string[] = [],
  extraHeaders: Record<string, string> = {},
): void {
  const headers: Record<string, string | string[]> = {
    "Cache-Control": "no-store",
    ...extraHeaders,
  };
  if (cookies.length > 0) headers["Set-Cookie"] = cookies;
  send(res, status, JSON.stringify(body), "application/json; charset=utf-8", headers);
}

export function redirect(
  res: ServerResponse,
  location: string,
  cookies: string[] = [],
): void {
  const headers: Record<string, string | string[]> = {
    Location: location,
    "Cache-Control": "no-store",
  };
  if (cookies.length > 0) headers["Set-Cookie"] = cookies;
  send(res, 302, "", "text/plain; charset=utf-8", headers);
}

export function parseBody(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new HttpError(413, "The request body is too large.", "body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseSettings(raw: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Settings must be a JSON object.", "settings_json_invalid");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Settings must be a JSON object.", "settings_json_invalid");
  }
  return value as Record<string, unknown>;
}

export async function parseApiSettings(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  return parseSettingsJson(await readApiSettingsBody(req));
}

/**
 * Read the JSON body once, before parsing it, so the API can fingerprint the
 * exact bytes an `Idempotency-Key` covers.
 */
export async function readApiSettingsBody(req: IncomingMessage): Promise<string> {
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Send settings as application/json.", "content_type_required");
  }
  return parseBody(req, MAX_SETTINGS_BYTES);
}

export function parseSettingsJson(raw: string): Record<string, unknown> {
  return parseSettings(raw);
}

export interface SettingsFormBody {
  readonly csrf: string | undefined;
  readonly params: URLSearchParams;
}

/**
 * The HTML form posts named widgets, not one JSON blob. Parsing the body is
 * part of reading the CSRF token, so the write gate can authorize before any
 * field is interpreted or validated.
 */
export async function parseSettingsFormBody(req: IncomingMessage): Promise<SettingsFormBody> {
  const params = new URLSearchParams(await parseBody(req, MAX_SETTINGS_BYTES));
  return { csrf: params.get("csrf") ?? undefined, params };
}

export interface ConfigUpload {
  readonly csrf: string | undefined;
  readonly text: string;
  readonly filename: string | undefined;
  readonly fields: ReadonlyMap<string, string>;
}

/**
 * Read a config file from either a multipart file field or a URL-encoded
 * `bundle` field. The apply page carries the previewed JSON in a hidden
 * textarea, so the same parser serves both steps; the bundle checksum is what
 * proves the second copy is the file the operator saw.
 */
export async function parseConfigUpload(req: IncomingMessage): Promise<ConfigUpload> {
  const contentType = req.headers["content-type"] ?? "";
  const raw = await parseBody(req, MAX_CONFIG_BODY_BYTES);
  if (contentType.toLowerCase().startsWith("multipart/form-data")) {
    return parseMultipartConfig(raw, contentType);
  }

  const params = new URLSearchParams(raw);
  const text = params.get("bundle") ?? "";
  const fields = new Map<string, string>();
  for (const [key, value] of params.entries()) fields.set(key, value);
  return {
    csrf: params.get("csrf") ?? undefined,
    text,
    filename: params.get("filename")?.trim() || undefined,
    fields,
  };
}

function parseMultipartConfig(raw: string, contentType: string): ConfigUpload {
  const boundaryMatch = /boundary="?([^";]+)"?/i.exec(contentType);
  if (!boundaryMatch?.[1]) {
    // No boundary means no CSRF field either; let the write gate return its
    // normal 403 instead of a parser error that runs before authorization.
    return { csrf: undefined, text: "", filename: undefined, fields: new Map() };
  }

  const boundary = `--${boundaryMatch[1]}`;
  const fields = new Map<string, string>();
  let text = "";
  let filename: string | undefined;

  for (const part of raw.split(boundary).slice(1, -1)) {
    const piece = part.replace(/^\r\n/, "").replace(/\r\n$/, "");
    const separator = piece.indexOf("\r\n\r\n");
    if (separator < 0) continue;
    const headers = piece.slice(0, separator);
    const body = piece.slice(separator + 4).replace(/\r\n$/, "");
    const name = /name="([^"]+)"/i.exec(headers)?.[1];
    if (!name) continue;
    fields.set(name, body);
    if (name === "csrf") continue;
    if (name === "file" || name === "bundle") {
      text = body;
      filename = /filename="([^"]*)"/i.exec(headers)?.[1] || undefined;
    }
  }

  return {
    csrf: fields.get("csrf"),
    text,
    filename,
    fields,
  };
}

export function csrfHeader(req: IncomingMessage): string | undefined {
  const header = req.headers["x-keystone-csrf"];
  return typeof header === "string" ? header : undefined;
}
