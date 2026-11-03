import type { IncomingMessage, ServerResponse } from "node:http";
import { renderError } from "./render";
import { securityHeaders, send, sendJson } from "./http";
import { HttpError } from "./http-error";
import { rateLimitClassFor, rateLimitError } from "./rate-limit";
import {
  createRouteContext,
  type WebServerDeps,
} from "./request-context";
import { dispatchRoutes } from "./routes";

export type { WebServerDeps } from "./request-context";

export function createWebHandler(
  deps: WebServerDeps,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    securityHeaders(res);
    void handle(req, res, deps).catch((error: unknown) => {
      const httpError =
        error instanceof HttpError
          ? error
          : new HttpError(500, "Something went wrong. The error has been logged.", "internal_error");
      if (!(error instanceof HttpError)) {
        // A callback URL contains the one-use OAuth code; never log the query.
        const requestPath = (req.url ?? "/").split("?")[0] || "/";
        deps.logger.error("web request failed", {
          path: requestPath,
          error: error instanceof Error ? (error.stack ?? error.message) : String(error),
        });
      }
      const isApi = (req.url ?? "").startsWith("/api/");
      if (isApi) {
        sendJson(res, httpError.status, {
          error: { code: httpError.code, message: httpError.message },
        });
      } else {
        send(res, httpError.status, renderError("Request failed", httpError.message), "text/html; charset=utf-8", {
          "Cache-Control": "no-store",
        });
      }
    });
  };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  deps: WebServerDeps,
): Promise<void> {
  const ctx = await createRouteContext(req, res, deps);

  // Limits run after the session is resolved so a signed-in user is budgeted
  // by account, while an anonymous request falls back to its socket address.
  const limitClass = rateLimitClassFor(ctx.method, ctx.path);
  if (limitClass) {
    const identity = ctx.session ? `user:${ctx.session.userId}` : `ip:${clientAddress(req)}`;
    const decision = deps.rateLimiter.check(limitClass, identity);
    if (!decision.allowed) {
      res.setHeader("Retry-After", String(decision.retryAfterSeconds));
      throw rateLimitError(decision);
    }
  }

  if (await dispatchRoutes(ctx)) return;

  if (ctx.method !== "GET" && ctx.method !== "POST") {
    send(
      res,
      405,
      renderError("Method not allowed", "That method is not supported here."),
      "text/html; charset=utf-8",
    );
    return;
  }

  send(res, 404, renderError("Not found", "That page does not exist."), "text/html; charset=utf-8");
}

function clientAddress(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? "unknown";
}
