import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError } from "./http-error";

const MAX_BODY_BYTES = 2_048;
const MAX_SETTINGS_BYTES = 32 * 1024;

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

export function send(
  res: ServerResponse,
  status: number,
  body: string,
  contentType: string,
  headers: Record<string, string | string[]> = {},
): void {
  res.statusCode = status;
  res.setHeader("Content-Type", contentType);
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.end(body);
}

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  cookies: string[] = [],
): void {
  const headers: Record<string, string | string[]> = { "Cache-Control": "no-store" };
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
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Send settings as application/json.", "content_type_required");
  }
  return parseSettings(await parseBody(req, MAX_SETTINGS_BYTES));
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

export function csrfHeader(req: IncomingMessage): string | undefined {
  const header = req.headers["x-keystone-csrf"];
  return typeof header === "string" ? header : undefined;
}
