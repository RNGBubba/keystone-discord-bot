import type {
  AnalyticsSnapshot,
  ApiTokenRecord,
  AuditEventRecord,
} from "@keystone/kernel";
import type {
  DashboardModule,
  DashboardView,
  FleetView,
  SavedTemplateDetail,
  SavedTemplateSummary,
} from "./overview";
import type { ConfigDrift, ConfigPlan } from "./config-bundle";
import type { DiscordGuild } from "./oauth";
import { encodePathSegment } from "./http";
import { labelFor, type SettingsField, type SettingsFormModel, type SettingsGroup } from "./settings-form";
import type { ConfigTemplate, TemplateGuildPlan, TemplatePlan } from "./templates";
import type { RateLimitPolicies } from "./rate-limit";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function layout(title: string, body: string, username?: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · Keystone</title>
<style>
:root{color-scheme:dark;--bg:#0d1117;--panel:#161b22;--line:#30363d;--text:#e6edf3;--muted:#8b949e;--accent:#5865f2}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
header{border-bottom:1px solid var(--line);padding:16px 24px;display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap}
main{max-width:960px;margin:0 auto;padding:32px 24px 64px}a{color:#8ea1ff;text-decoration:none}a:hover{text-decoration:underline}
.brand{font-weight:700;letter-spacing:.02em;color:var(--text)}.muted{color:var(--muted)}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:20px;margin:16px 0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.stat{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px}
.stat b{display:block;font-size:24px}.stat span{color:var(--muted);font-size:13px}
button{background:var(--accent);color:#fff;border:0;border-radius:7px;padding:8px 14px;font:inherit;cursor:pointer}
pre,textarea{white-space:pre-wrap;word-break:break-word;background:#0b0f14;border:1px solid var(--line);border-radius:8px;padding:14px;overflow:auto;font-size:13px;color:var(--text);width:100%}
textarea{font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;resize:vertical}
table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:8px;border-bottom:1px solid var(--line)}
p.error{color:#ffb4b4}
fieldset{border:1px solid var(--line);border-radius:10px;margin:16px 0;padding:4px 16px 14px}legend{padding:0 6px;font-weight:600}
.field{display:flex;flex-direction:column;gap:5px;margin:13px 0}.field.check{flex-direction:row;align-items:center;gap:9px;margin:10px 0}
.field label,.field .label{font-weight:600}.field input[type=text],.field input[type=number],.field select{background:#0b0f14;border:1px solid var(--line);border-radius:7px;padding:8px 10px;color:var(--text);font:inherit;width:100%;max-width:520px}
.field input[type=checkbox]{width:17px;height:17px;accent-color:var(--accent)}.field textarea{max-width:100%}
.field small{color:var(--muted);font-size:12px}.field p.error{margin:0;font-size:13px}
.notice{border:1px solid #2ea043;background:#0f2417;color:#b7f7c4;border-radius:9px;padding:12px 14px;margin:14px 0}
.form-error{border:1px solid #f85149;background:#2b1418;color:#ffd4d4;border-radius:9px;padding:12px 14px;margin:14px 0}
</style>
</head>
<body>
<header><a class="brand" href="/">Keystone</a><span class="muted">${username ? `signed in as ${escapeHtml(username)}` : "dashboard"}</span></header>
<main>${body}</main>
</body>
</html>`;
}

function logoutForm(csrfToken: string): string {
  return `<form method="post" action="/logout"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><button type="submit">Sign out</button></form>`;
}

export function renderLanding(username?: string, csrfToken?: string, owner = false): string {
  if (!username) {
    return layout(
      "Welcome",
      `<h1>Keystone dashboard</h1>
       <p class="muted">Sign in with Discord to manage a server. The dashboard only shows servers you can already manage, and every read re-checks your Discord permissions.</p>
       <p><a href="/login">Sign in with Discord</a></p>`,
    );
  }
  return layout(
    "Welcome",
    `<h1>Keystone dashboard</h1>
     <p>Signed in as <strong>${escapeHtml(username)}</strong>.</p>
     <p><a href="/dashboard">Open your servers</a></p>
     ${owner ? `<p><a href="/dashboard/instance">Instance owner console</a></p>` : ""}
     ${csrfToken ? logoutForm(csrfToken) : ""}`,
    username,
  );
}

export function renderGuildList(
  username: string,
  guilds: DiscordGuild[],
  csrfToken: string,
): string {
  const rows = guilds
    .map(
      (guild) =>
        `<tr><td><a href="/dashboard/guilds/${encodePathSegment(guild.id)}">${escapeHtml(guild.name)}</a></td><td class="muted">${escapeHtml(guild.id)}</td></tr>`,
    )
    .join("");
  return layout(
    "Your servers",
    `<h1>Your servers</h1>
     <p class="muted">Only servers where you are owner or hold Administrator / Manage Server are listed. Keystone must also be in the server for its detail page to load.</p>
     <p><a href="/dashboard/fleet">Open the fleet view and apply a template</a></p>
     <div class="panel">
       ${guilds.length === 0 ? "<p>No manageable servers yet.</p>" : `<table><thead><tr><th>Server</th><th>ID</th></tr></thead><tbody>${rows}</tbody></table>`}
     </div>
     ${logoutForm(csrfToken)}`,
    username,
  );
}

export function renderOverview(
  username: string,
  view: DashboardView,
  csrfToken: string,
): string {
  const stats = [
    ["Cases", view.counts.cases],
    ["Open tickets", view.counts.openTickets],
    ["Level rows", view.counts.levels],
    ["Imports", view.counts.imports],
    ["Backups", view.counts.backups],
  ]
    .map(
      ([label, value]) =>
        `<div class="stat"><b>${value}</b><span>${escapeHtml(String(label))}</span></div>`,
    )
    .join("");
  const modules = view.modules
    .map(
      (module) =>
        `<div class="panel"><h3>${escapeHtml(module.name)} <span class="muted">· ${escapeHtml(module.version)} · ${module.enabled ? "enabled" : "disabled"}</span></h3>
         <p class="muted">${escapeHtml(module.description)}</p>
         <pre>${escapeHtml(JSON.stringify(module.settings, null, 2))}</pre>
         <p><a href="/dashboard/guilds/${encodePathSegment(view.guild.id)}/settings/${encodePathSegment(module.id)}">Edit settings</a></p></div>`,
    )
    .join("");
  const latest = view.latestImport
    ? `<p class="muted">Latest import: ${escapeHtml(view.latestImport.source)} · ${escapeHtml(view.latestImport.state)} · ${escapeHtml(view.latestImport.createdAt)}</p>`
    : `<p class="muted">No import receipts yet.</p>`;
  return layout(
    view.guild.name,
    `<p><a href="/dashboard">← All servers</a></p>
     <h1>${escapeHtml(view.guild.name)}</h1>
     <p class="muted">Guild ${escapeHtml(view.guild.id)} · P6 foundation · settings writes enabled</p>
     <div class="grid">${stats}</div>
     <div class="panel"><h2>Analytics</h2>
       <p class="muted">See retained activity for this server: logged events, moderation cases, invite joins, command runs and tickets. Every figure names its source table; nothing here writes.</p>
       <p><a href="/dashboard/guilds/${encodePathSegment(view.guild.id)}/analytics">Open analytics</a></p>
     </div>
     <div class="panel"><h2>API tokens</h2>
       <p class="muted">Issue a guild-scoped <code>keystone_…</code> token for automation. The secret is shown once; only its hash is stored, and every route checks the token's guild and scopes.</p>
       <p><a href="/dashboard/guilds/${encodePathSegment(view.guild.id)}/tokens">Manage API tokens</a></p>
     </div>
     <div class="panel"><h2>Portability</h2>${latest}</div>
     <div class="panel"><h2>Config export, import and drift</h2>
       <p class="muted">Download this server's effective module settings as a checksummed JSON file, import a file from another server behind a preview, or compare live settings with the last baseline.</p>
       <p><a href="/dashboard/guilds/${encodePathSegment(view.guild.id)}/config/export">Download config bundle</a> · <a href="/dashboard/guilds/${encodePathSegment(view.guild.id)}/config/drift">Import a bundle and inspect drift</a></p>
     </div>
     ${modules}
     <p class="muted">Settings are validated by each module's own schema. <a href="/dashboard/fleet">Preview a built-in template across servers</a>.</p>
     ${logoutForm(csrfToken)}`,
    username,
  );
}

export function renderAnalytics(
  username: string,
  guild: DiscordGuild,
  snapshot: AnalyticsSnapshot | null,
  days: number,
  csrfToken: string,
): string {
  const base = `/dashboard/guilds/${encodePathSegment(guild.id)}/analytics`;
  const windowLinks = [7, 30, 90]
    .map(
      (value) =>
        `<a href="${base}?days=${value}"${value === days ? ' aria-current="page"' : ""}>${value} days</a>`,
    )
    .join(" · ");

  if (snapshot === null) {
    return layout(
      "Analytics",
      `<p><a href="/dashboard/guilds/${encodePathSegment(guild.id)}">← Back to ${escapeHtml(guild.name)}</a></p>
       <h1>Analytics</h1>
       <p class="muted">Read-only aggregates over the rows Keystone already stores.</p>
       <nav class="panel">Window: ${windowLinks}</nav>
       <div class="panel"><h2>Not available in this process</h2>
         <p class="muted">This dashboard is running without a shared analytics ledger adapter (memory mode). It will not show zeros as if they were measurements. Start the web process with <code>DATABASE_URL</code> to read the guild's retained rows.</p>
       </div>
       ${logoutForm(csrfToken)}`,
      username,
    );
  }

  const { overview, members, messages, commands, tickets } = snapshot;
  const hasRows =
    overview.loggedEvents +
      overview.casesOpened +
      overview.inviteJoins +
      overview.commandsRun +
      tickets.opened +
      tickets.closedInWindow +
      overview.activeCases +
      overview.openTickets >
    0;
  const windowLabel = `${snapshot.window.days}d · ${escapeHtml(snapshot.window.since.slice(0, 10))} → ${escapeHtml(snapshot.window.until.slice(0, 10))}`;

  const stats = [
    ["Logged events", overview.loggedEvents],
    ["Active cases (current)", overview.activeCases],
    ["Cases opened", overview.casesOpened],
    ["Invite joins", overview.inviteJoins],
    ["Retained invites", overview.retainedInvites],
    ["Command runs", overview.commandsRun],
    ["Open tickets (current)", overview.openTickets],
  ]
    .map(
      ([label, value]) =>
        `<div class="stat"><b>${Number(value)}</b><span>${escapeHtml(String(label))}</span></div>`,
    )
    .join("");

  const sourceRows = snapshot.sources
    .map(
      (source) =>
        `<tr><td><code>${escapeHtml(source.id)}</code></td><td>${escapeHtml(source.label)}</td><td>${source.rows}</td></tr>`,
    )
    .join("");

  const topCommands = commands.top.length
    ? `<table><thead><tr><th>Command</th><th>Runs</th><th>Ok</th><th>Blocked</th><th>Error</th><th>Avg latency</th></tr></thead><tbody>${commands.top
        .map(
          (row) =>
            `<tr><td><code>/${escapeHtml(row.command)}${row.path ? ` ${escapeHtml(row.path)}` : ""}</code></td><td>${row.total}</td><td>${row.ok}</td><td>${row.blocked}</td><td>${row.error}</td><td>${row.averageLatencyMs === null ? "—" : `${row.averageLatencyMs}ms`}</td></tr>`,
        )
        .join("")}</tbody></table>`
    : `<p class="muted">No command runs recorded in this window.</p>`;

  return layout(
    "Analytics",
    `<p><a href="/dashboard/guilds/${encodePathSegment(guild.id)}">← Back to ${escapeHtml(guild.name)}</a></p>
     <h1>Analytics</h1>
     <p class="muted">Guild ${escapeHtml(guild.id)} · read-only aggregate over retained rows · window ${windowLabel}</p>
     <nav class="panel">Window: ${windowLinks}</nav>
     ${
       hasRows
         ? ""
         : `<div class="notice">No rows in this window. These are counts of records Keystone retained, not an estimate of all Discord activity.</div>`
     }
     <div class="panel"><h2>Summary</h2><div class="grid">${stats}</div>
       <p class="muted">Open tickets and active cases are current state. Every other count is bounded by the window. These are counts of retained rows, not estimates: zero can mean the relevant logging event or module is off, not that nothing happened in Discord.</p>
     </div>
     <div class="panel"><h2>Source rows</h2>
       <p class="muted">Each figure below is a query over one of these tables; there is no analytics table or counter to reconcile.</p>
       <table><thead><tr><th>Table</th><th>Meaning</th><th>Rows</th></tr></thead><tbody>${sourceRows}</tbody></table>
     </div>
     <div class="panel"><h2>Members and invites</h2>
       <table><tbody>
         <tr><td>Logged joins</td><td>${members.loggedJoins}</td></tr>
         <tr><td>Logged leaves</td><td>${members.loggedLeaves}</td></tr>
         <tr><td>Invite joins</td><td>${members.inviteJoins}</td></tr>
         <tr><td>Left since</td><td>${members.leftSince}</td></tr>
         <tr><td>Retained</td><td>${members.retained}</td></tr>
         <tr><td>Flagged joins</td><td>${members.flagged}</td></tr>
         <tr><td>Unique inviters</td><td>${members.uniqueInviters}</td></tr>
       </tbody></table>
     </div>
     <div class="panel"><h2>Messages</h2>
       <table><tbody>
         <tr><td>Deleted</td><td>${messages.deleted}</td></tr>
         <tr><td>Edited</td><td>${messages.edited}</td></tr>
         <tr><td>Content-filter cases</td><td>${messages.contentFilterCases}</td></tr>
       </tbody></table>
       <p class="muted">Counts events captured by audit logging, not every message sent. Message content is not included.</p>
     </div>
     <div class="panel"><h2>Commands</h2>
       <p class="muted">${commands.total} runs · ${commands.ok} ok · ${commands.blocked} blocked · ${commands.error} error · average ${commands.averageLatencyMs === null ? "n/a" : `${commands.averageLatencyMs}ms`}</p>
       ${topCommands}
     </div>
     <div class="panel"><h2>Tickets</h2>
       <table><tbody>
         <tr><td>Open (current)</td><td>${tickets.open}</td></tr>
         <tr><td>Claimed (current)</td><td>${tickets.claimed}</td></tr>
         <tr><td>Closed (current)</td><td>${tickets.closed}</td></tr>
         <tr><td>Opened in window</td><td>${tickets.opened}</td></tr>
         <tr><td>Closed in window</td><td>${tickets.closedInWindow}</td></tr>
         <tr><td>Average close</td><td>${tickets.averageCloseMinutes === null ? "—" : `${tickets.averageCloseMinutes} min`}</td></tr>
         <tr><td>SLA breached</td><td>${tickets.slaBreached}</td></tr>
       </tbody></table>
     </div>
     ${logoutForm(csrfToken)}`,
    username,
  );
}

export interface FleetNotice {
  readonly applied?: number;
  readonly failed?: number;
}

function settingText(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function renderFleet(
  username: string,
  view: FleetView,
  templates: readonly ConfigTemplate[],
  csrfToken: string,
  notice: FleetNotice = {},
): string {
  const noticeHtml = notice.applied !== undefined
    ? notice.applied > 0
      ? `<div class="notice">Template applied: ${notice.applied} module setting${notice.applied === 1 ? "" : "s"} written. Every write is in that module's audit trail.</div>`
      : `<div class="notice">Nothing to apply: the selected guilds already match this template.</div>`
    : "";
  const failureHtml = notice.failed && notice.failed > 0
    ? `<div class="form-error">${notice.failed} write${notice.failed === 1 ? "" : "s"} failed. The remaining writes were still attempted; review the audit trail and try again.</div>`
    : "";

  const rows = view.guilds
    .map((guild) => {
      const enabled = guild.modules
        .filter((module) => module.enabled === true)
        .map((module) => module.name);
      const unreadable = guild.modules.filter((module) => module.enabled === null).length;
      return `<tr>
        <td><input type="checkbox" name="guild" value="${escapeHtml(guild.id)}" aria-label="${escapeHtml(guild.name)}"></td>
        <td><a href="/dashboard/guilds/${encodePathSegment(guild.id)}">${escapeHtml(guild.name)}</a></td>
        <td class="muted">${escapeHtml(guild.id)}</td>
        <td>${enabled.length > 0 ? escapeHtml(enabled.join(", ")) : "<span class=\"muted\">none</span>"}${
          unreadable > 0
            ? ` <span class="muted">· ${unreadable} unreadable</span>`
            : ""
        }</td>
      </tr>`;
    })
    .join("");

  const templateOptions = templates
    .map(
      (template, index) => `<div class="panel">
        <div class="field check">
          <input type="radio" id="template-${escapeHtml(template.id)}" name="template" value="${escapeHtml(template.id)}"${index === 0 ? " checked" : ""} required>
          <label for="template-${escapeHtml(template.id)}"><strong>${escapeHtml(template.name)}</strong></label>
        </div>
        <p class="muted">${escapeHtml(template.description)}</p>
        <p class="muted">Touches ${template.modules.map((entry) => escapeHtml(labelFor(entry.moduleId))).join(", ")}.</p>
      </div>`,
    )
    .join("");

  const form = view.guilds.length === 0
    ? `<p class="muted">No manageable servers yet. The fleet view lists the same guilds as the dashboard.</p>`
    : `<div class="panel">
        <h2>Apply a built-in template</h2>
        <p class="muted">Select servers and a template. Preview runs the template against each server's current settings and shows the exact diff; nothing is written until you confirm.</p>
        <form method="post" action="/dashboard/fleet/preview">
          <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
          <table><thead><tr><th></th><th>Server</th><th>ID</th><th>Enabled modules</th></tr></thead><tbody>${rows}</tbody></table>
          <fieldset><legend>Template</legend>${templateOptions}</fieldset>
          <p><button type="submit">Preview template</button></p>
        </form>
      </div>`;

  return layout(
    "Fleet",
    `<p><a href="/dashboard">← All servers</a></p>
     <h1>Fleet</h1>
     <p class="muted">One settings action across the servers you can manage. Each selected server is re-authorized, and every write goes through the module's own schema and audit trail.</p>
     ${noticeHtml}${failureHtml}${form}
     ${logoutForm(csrfToken)}`,
    username,
  );
}

function renderPlanRows(modules: TemplateGuildPlan["modules"]): string {
  return modules
    .flatMap((module) => {
      const issueRows = module.issues.map(
        (issue) => `<tr><td>${escapeHtml(module.moduleName)}</td><td>${escapeHtml(
          issue.path.split(".").map(labelFor).join(" · "),
        )}</td><td colspan="2" class="error">${escapeHtml(issue.message)}</td></tr>`,
      );
      const changeRows = Object.entries(module.changes).map(
        ([path, change]) => `<tr><td>${escapeHtml(module.moduleName)}</td><td>${escapeHtml(
          path.split(".").map(labelFor).join(" · "),
        )}</td><td><code>${escapeHtml(settingText(change.from))}</code></td><td><code>${escapeHtml(settingText(change.to))}</code></td></tr>`,
      );
      return [...issueRows, ...changeRows];
    })
    .join("");
}

export interface TemplatePreviewOptions {
  readonly applyAction?: string;
  readonly includeTemplateField?: boolean;
  readonly backHref?: string;
  readonly backLabel?: string;
}

export function renderTemplatePreview(
  username: string,
  plan: TemplatePlan,
  csrfToken: string,
  options: TemplatePreviewOptions = {},
): string {
  const applyAction = options.applyAction ?? "/dashboard/fleet/apply";
  const includeTemplateField = options.includeTemplateField ?? true;
  const backHref = options.backHref ?? "/dashboard/fleet";
  const backLabel = options.backLabel ?? "Back to the fleet";
  const templateIssues = plan.templateIssues ?? [];
  const issuePanel = templateIssues.length > 0
    ? `<div class="form-error"><p><strong>This saved template does not validate against the current module schemas.</strong></p>
        <table><thead><tr><th>Setting</th><th>Problem</th></tr></thead><tbody>${templateIssues
          .map((issue) => `<tr><td>${escapeHtml(issue.path.split(".").map(labelFor).join(" · "))}</td><td>${escapeHtml(issue.message)}</td></tr>`)
          .join("")}</tbody></table>
      </div>`
    : "";

  const panels = plan.guilds
    .map((guildPlan) => {
      if (guildPlan.modules.length === 0) {
        return `<div class="panel"><h2>${escapeHtml(guildPlan.guild.name)}</h2><p class="muted">No changes in this guild.</p></div>`;
      }

      return `<div class="panel">
        <h2>${escapeHtml(guildPlan.guild.name)} <span class="muted">· ${escapeHtml(guildPlan.guild.id)}</span></h2>
        <table><thead><tr><th>Module</th><th>Setting</th><th>Before</th><th>After</th></tr></thead><tbody>${renderPlanRows(guildPlan.modules)}</tbody></table>
      </div>`;
    })
    .join("");

  const summary = templateIssues.length > 0
    ? `This template has ${templateIssues.length} schema issue${templateIssues.length === 1 ? "" : "s"}. Apply is disabled until it is refreshed or fixed.`
    : plan.issueCount > 0
      ? `${plan.changeCount} change${plan.changeCount === 1 ? "" : "s"} across ${plan.guilds.length} guild${plan.guilds.length === 1 ? "" : "s"}; ${plan.issueCount} schema issue${plan.issueCount === 1 ? "" : "s"}. Apply is disabled until they are resolved.`
      : `${plan.changeCount} change${plan.changeCount === 1 ? "" : "s"} across ${plan.guilds.length} guild${plan.guilds.length === 1 ? "" : "s"}. Nothing has been written yet.`;

  const hiddenGuilds = plan.guilds
    .map((guildPlan) => `<input type="hidden" name="guild" value="${escapeHtml(guildPlan.guild.id)}">`)
    .join("");
  const apply = plan.issueCount > 0
    ? `<div class="form-error">This preview has schema issues, so apply is disabled. Reset or fix the affected module, then preview again.</div>`
    : plan.changeCount === 0
      ? `<p class="muted">No changes to apply: the selected guilds already match this template.</p>`
      : `<form method="post" action="${escapeHtml(applyAction)}">
          <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
          ${includeTemplateField ? `<input type="hidden" name="template" value="${escapeHtml(plan.template.id)}">` : ""}
          <input type="hidden" name="fingerprint" value="${escapeHtml(plan.fingerprint)}">
          ${hiddenGuilds}
          <p><button type="submit">Apply to ${plan.guilds.length} guild${plan.guilds.length === 1 ? "" : "s"}</button></p>
        </form>`;

  return layout(
    `${plan.template.name} preview`,
    `<p><a href="${escapeHtml(backHref)}">← ${escapeHtml(backLabel)}</a></p>
     <h1>${escapeHtml(plan.template.name)}</h1>
     <p class="muted">${escapeHtml(plan.template.description)}</p>
     <div class="notice">${escapeHtml(summary)}</div>
     ${issuePanel}${panels}
     ${apply}
     ${logoutForm(csrfToken)}`,
    username,
  );
}

export function renderConfigPreview(
  username: string,
  plan: ConfigPlan,
  bundleText: string,
  csrfToken: string,
): string {
  const rows = plan.modules.length === 0
    ? `<p class="muted">No changes: this guild already matches the bundle.</p>`
    : `<table><thead><tr><th>Module</th><th>Setting</th><th>Before</th><th>After</th></tr></thead><tbody>${renderPlanRows(plan.modules)}</tbody></table>`;
  const summary = plan.issueCount > 0
    ? `${plan.changeCount} change${plan.changeCount === 1 ? "" : "s"}; ${plan.issueCount} schema issue${plan.issueCount === 1 ? "" : "s"}. Apply is disabled.`
    : `${plan.changeCount} change${plan.changeCount === 1 ? "" : "s"} in ${plan.guild.name}. Nothing has been written yet.`;
  const action = `/dashboard/guilds/${encodePathSegment(plan.guild.id)}/config/import/apply`;
  const apply = plan.issueCount > 0
    ? `<div class="form-error">This bundle cannot be applied. Fix the reported fields and import it again.</div>`
    : `<form method="post" action="${action}">
        <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
        <input type="hidden" name="fingerprint" value="${escapeHtml(plan.fingerprint)}">
        <textarea name="bundle" hidden>${escapeHtml(bundleText)}</textarea>
        <p><button type="submit">Apply ${plan.changeCount} change${plan.changeCount === 1 ? "" : "s"}</button></p>
      </form>`;

  return layout(
    "Config import preview",
    `<p><a href="/dashboard/guilds/${encodePathSegment(plan.guild.id)}/config/drift">← Back to config and drift</a></p>
     <h1>Config import preview</h1>
     <p class="muted">Bundle from guild ${escapeHtml(plan.bundle.sourceGuildId)} · exported ${escapeHtml(plan.bundle.exportedAt)} · checksum <code>${escapeHtml(plan.bundle.checksum.slice(0, 12))}…</code> · ${plan.bundle.moduleCount} modules</p>
     <div class="notice">${escapeHtml(summary)}</div>
     <div class="panel"><h2>${escapeHtml(plan.guild.name)}</h2>${rows}</div>
     <div class="panel">
       <p class="muted">Apply re-parses and re-validates this exact file, recomputes the plan and refuses it if the checksum, the schemas or this guild's settings changed after the preview. Each accepted module write appends one dashboard audit row, and the bundle becomes this guild's baseline for drift.</p>
       ${apply}
     </div>
     ${logoutForm(csrfToken)}`,
    username,
  );
}

export interface ConfigDriftOptions {
  readonly imported?: number;
  readonly failed?: number;
  readonly importError?: string;
}

function configTime(ms: number): string {
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? "unknown" : `${date.toISOString().replace("T", " ").slice(0, 19)} UTC`;
}

export function renderConfigDrift(
  username: string,
  guild: DiscordGuild,
  drift: ConfigDrift,
  csrfToken: string,
  options: ConfigDriftOptions = {},
): string {
  const base = `/dashboard/guilds/${encodePathSegment(guild.id)}/config`;
  const notice = options.imported !== undefined
    ? `<div class="notice">Imported: ${options.imported} module setting${options.imported === 1 ? "" : "s"} written. Each accepted module write is in the audit trail, and this bundle is now the drift baseline.</div>`
    : "";
  const failure = options.failed && options.failed > 0
    ? `<div class="form-error">${options.failed} module write${options.failed === 1 ? "" : "s"} failed. The baseline was stored; review the audit trail and apply again.</div>`
    : "";
  const error = options.importError || drift.error;
  const errorHtml = error
    ? `<div class="form-error">${escapeHtml(error)}</div>`
    : "";

  const baseline = drift.baseline
    ? `<div class="panel"><h2>Baseline</h2>
        <p class="muted">source ${escapeHtml(drift.baseline.source)} · exported ${escapeHtml(drift.baseline.exportedAt || "unknown")} · from guild ${escapeHtml(drift.baseline.sourceGuildId || "unknown")} · stored ${escapeHtml(configTime(drift.baseline.createdAt))} · updated ${escapeHtml(configTime(drift.baseline.updatedAt))} · checksum <code>${escapeHtml(drift.baseline.checksum.slice(0, 12))}…</code></p>
      </div>`
    : `<div class="panel"><h2>Baseline</h2><p class="muted">No baseline yet. Applying an imported bundle stores it; until then there is nothing to compare.</p></div>`;

  const driftPanel = drift.baseline === null
    ? `<div class="panel"><h2>Drift</h2><p class="muted">Import a bundle to start a baseline.</p></div>`
    : drift.changeCount === 0 && drift.issueCount === 0
      ? `<div class="panel"><h2>Drift</h2><p class="muted">No drift: this guild's live settings match the baseline.</p></div>`
      : `<div class="panel"><h2>Drift <span class="muted">· baseline → live</span></h2>
          <p class="muted">${drift.changeCount} changed value${drift.changeCount === 1 ? "" : "s"}${drift.issueCount > 0 ? ` · ${drift.issueCount} unreadable value${drift.issueCount === 1 ? "" : "s"}` : ""}.</p>
          <table><thead><tr><th>Module</th><th>Setting</th><th>Baseline</th><th>Live</th></tr></thead><tbody>${renderPlanRows(drift.modules)}</tbody></table>
        </div>`;

  return layout(
    "Config and drift",
    `<p><a href="/dashboard/guilds/${encodePathSegment(guild.id)}">← Back to ${escapeHtml(guild.name)}</a></p>
     <h1>Config export, import and drift</h1>
     <p class="muted">A config bundle carries every module's effective settings and a checksum. Import validates it against the same Zod schemas the bot uses, previews the exact per-setting diff, and writes only after confirmation.</p>
     ${notice}${failure}${errorHtml}
     <div class="panel"><h2>Export</h2>
       <p class="muted">Download a portable JSON file. Stored values and schema defaults are included; credential-shaped keys are omitted.</p>
       <p><a href="${base}/export">Download config bundle</a></p>
     </div>
     <div class="panel"><h2>Import</h2>
       <p class="muted">Choose a bundle exported by any guild. Preview writes nothing; apply is bound to the preview and re-authorized.</p>
       <form method="post" enctype="multipart/form-data" action="${base}/import/preview">
         <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
         <div class="field"><label for="config-file">Config bundle (.json)</label><input id="config-file" type="file" name="file" accept="application/json,.json" required></div>
         <p><button type="submit">Preview import</button></p>
       </form>
     </div>
     ${baseline}
     ${driftPanel}
     ${logoutForm(csrfToken)}`,
    username,
  );
}

export interface SavedTemplateNotice {
  readonly created?: boolean;
  readonly updated?: boolean;
  readonly deleted?: boolean;
  readonly applied?: number;
  readonly failed?: number;
  readonly history?: readonly AuditEventRecord[];
}

export function renderSavedTemplates(
  username: string,
  guild: DiscordGuild,
  templates: readonly SavedTemplateSummary[],
  csrfToken: string,
  notice: SavedTemplateNotice = {},
): string {
  const base = `/dashboard/guilds/${encodePathSegment(guild.id)}/templates`;
  const noticeHtml = notice.created
    ? `<div class="notice">Saved. Open the template to edit it or preview an apply.</div>`
    : notice.deleted
      ? `<div class="notice">Template deleted. The deletion is in the audit trail.</div>`
      : "";
  const rows = templates
    .map(
      (template) => `<tr>
        <td><a href="${base}/${encodePathSegment(template.id)}">${escapeHtml(template.name)}</a>${
          template.invalidCount > 0
            ? ` <span class="error">· invalid (${template.invalidCount})</span>`
            : ""
        }</td>
        <td class="muted">${escapeHtml(template.description || "—")}</td>
        <td>${template.moduleCount}</td>
        <td class="muted">${escapeHtml(configTime(template.updatedAt))}</td>
      </tr>`,
    )
    .join("");

  return layout(
    "Saved templates",
    `<p><a href="/dashboard/guilds/${encodePathSegment(guild.id)}">← Back to ${escapeHtml(guild.name)}</a></p>
     <h1>Saved templates</h1>
     <p class="muted">A saved template is a snapshot of this server's effective module settings. It belongs to this server; applying it to another server always re-authorizes both and previews the exact diff first.</p>
     ${noticeHtml}
     <div class="panel"><h2>Your templates</h2>
       ${templates.length === 0
         ? `<p class="muted">No saved templates yet.</p>`
         : `<table><thead><tr><th>Name</th><th>Description</th><th>Modules</th><th>Updated</th></tr></thead><tbody>${rows}</tbody></table>`}
     </div>
     <div class="panel"><h2>Save the current settings</h2>
       <p class="muted">Every module's effective settings are re-parsed against its own Zod schema before the template is stored. Credential-shaped keys are omitted.</p>
       <form method="post" action="${base}">
         <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
         <div class="field"><label for="template-name">Name</label><input id="template-name" type="text" name="name" maxlength="60" required></div>
         <div class="field"><label for="template-description">Description</label><textarea id="template-description" name="description" rows="2" maxlength="280"></textarea></div>
         <p><button type="submit">Save template</button></p>
       </form>
     </div>
     ${logoutForm(csrfToken)}`,
    username,
  );
}

export function renderSavedTemplateEditor(
  username: string,
  guild: DiscordGuild,
  template: SavedTemplateDetail,
  targets: readonly DiscordGuild[],
  csrfToken: string,
  notice: SavedTemplateNotice = {},
): string {
  const base = `/dashboard/guilds/${encodePathSegment(guild.id)}/templates`;
  const action = `${base}/${encodePathSegment(template.id)}`;
  const noticeHtml = notice.created
    ? `<div class="notice">Template saved from this server's current settings.</div>`
    : notice.updated
    ? `<div class="notice">Template updated. The edit is in the audit trail below.</div>`
    : notice.applied !== undefined
      ? `<div class="notice">${notice.applied} module setting${notice.applied === 1 ? "" : "s"} written across the selected servers. Every write is in that module's audit trail.</div>`
      : "";
  const failureHtml = notice.failed && notice.failed > 0
    ? `<div class="form-error">${notice.failed} write${notice.failed === 1 ? "" : "s"} failed. The remaining writes were attempted; review the audit trail and try again.</div>`
    : "";
  const issues = template.issues.length > 0
    ? `<div class="form-error"><p><strong>This template no longer validates against the current module schemas.</strong> It cannot be applied until it is refreshed from this server or deleted.</p>
        <table><thead><tr><th>Setting</th><th>Problem</th></tr></thead><tbody>${template.issues
          .map((issue) => `<tr><td>${escapeHtml(issue.path.split(".").map(labelFor).join(" · "))}</td><td>${escapeHtml(issue.message)}</td></tr>`)
          .join("")}</tbody></table>
      </div>`
    : "";

  const targetRows = targets
    .map(
      (target) => `<tr><td><input type="checkbox" name="guild" value="${escapeHtml(target.id)}" aria-label="${escapeHtml(target.name)}"${
        target.id === guild.id ? " checked" : ""
      }></td><td>${escapeHtml(target.name)}</td><td class="muted">${escapeHtml(target.id)}</td></tr>`,
    )
    .join("");
  const applyPanel = template.issues.length > 0
    ? `<div class="panel"><h2>Apply</h2><p class="muted">Apply is disabled while this template has schema issues.</p></div>`
    : targets.length === 0
      ? `<div class="panel"><h2>Apply</h2><p class="muted">No manageable servers are available.</p></div>`
      : `<div class="panel"><h2>Apply to servers</h2>
          <p class="muted">Select the servers to preview. Nothing is written until you confirm the diff; each selected server is re-authorized and every accepted module write is audited.</p>
          <form method="post" action="${action}/preview">
            <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
            <table><thead><tr><th></th><th>Server</th><th>ID</th></tr></thead><tbody>${targetRows}</tbody></table>
            <p><button type="submit">Preview apply</button></p>
          </form>
        </div>`;

  return layout(
    `${template.name} template`,
    `<p><a href="${base}">← All saved templates</a></p>
     <h1>${escapeHtml(template.name)}</h1>
     <p class="muted">${escapeHtml(template.description || "No description.")} · ${template.moduleCount} modules · updated ${escapeHtml(configTime(template.updatedAt))} · created ${escapeHtml(configTime(template.createdAt))}</p>
     ${noticeHtml}${failureHtml}${issues}
     <div class="panel"><h2>Edit metadata</h2>
       <form method="post" action="${action}">
         <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
         <div class="field"><label for="template-name">Name</label><input id="template-name" type="text" name="name" maxlength="60" value="${escapeHtml(template.name)}" required></div>
         <div class="field"><label for="template-description">Description</label><textarea id="template-description" name="description" rows="2" maxlength="280">${escapeHtml(template.description)}</textarea></div>
         <div class="field check"><input id="refresh-settings" type="checkbox" name="refresh" value="1"><label for="refresh-settings">Replace the snapshot with this server's current settings</label></div>
         <p><button type="submit">Save changes</button></p>
       </form>
     </div>
     ${applyPanel}
     ${renderAudit(notice.history ?? [])}
     <div class="panel"><h2>Delete</h2>
       <p class="muted">Deleting removes the template and keeps its audit rows. It does not change any server's settings.</p>
       <form method="post" action="${action}/delete">
         <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
         <p><button type="submit">Delete template</button></p>
       </form>
     </div>
     ${logoutForm(csrfToken)}`,
    username,
  );
}

function fieldId(path: string): string {
  return `f-${path.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

function activeField(
  field: SettingsField,
  submitted: URLSearchParams | undefined,
  rendered: ReadonlySet<string> | undefined,
): boolean {
  if (!submitted) return false;
  return rendered ? rendered.has(field.path) : submitted.has(field.path);
}

function displayValue(
  field: SettingsField,
  submitted: URLSearchParams | undefined,
  rendered: ReadonlySet<string> | undefined,
): unknown {
  if (!activeField(field, submitted, rendered)) return field.value;
  if (field.kind === "boolean") return submitted?.has(field.path) ?? false;
  return submitted?.get(field.path) ?? "";
}

function linesText(value: unknown): string {
  return Array.isArray(value) ? value.map((entry) => String(entry)).join("\n") : "";
}

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, null, 2) ?? "";
  } catch {
    return "";
  }
}

function renderField(
  field: SettingsField,
  submitted: URLSearchParams | undefined,
  rendered: ReadonlySet<string> | undefined,
  errors: ReadonlyMap<string, string> | undefined,
): string {
  const id = fieldId(field.path);
  const value = displayValue(field, submitted, rendered);
  const error = errors?.get(field.path);
  const help = field.help ? `<small id="${id}-help">${escapeHtml(field.help)}</small>` : "";
  const errorText = error ? `<p class="error" id="${id}-error">${escapeHtml(error)}</p>` : "";
  const describedBy = [field.help ? `${id}-help` : "", error ? `${id}-error` : ""]
    .filter(Boolean)
    .join(" ");
  const aria = `${describedBy ? ` aria-describedby="${describedBy}"` : ""}${error ? ' aria-invalid="true"' : ""}`;

  if (field.kind === "boolean") {
    const checked = value === true;
    return `<div class="field check">
      <input type="checkbox" id="${id}" name="${escapeHtml(field.path)}"${checked ? " checked" : ""}${aria}>
      <label for="${id}">${escapeHtml(field.label)}</label>
    </div>${help}${errorText}`;
  }

  if (field.kind === "literal") {
    return `<input type="hidden" name="${escapeHtml(field.path)}" value="${escapeHtml(String(value ?? ""))}">
      <div class="field"><span class="label">${escapeHtml(field.label)}</span><span class="muted">Fixed at ${escapeHtml(String(value ?? ""))}</span>${help}</div>${errorText}`;
  }

  const label = `<label for="${id}">${escapeHtml(field.label)}</label>`;
  const common = `id="${id}" name="${escapeHtml(field.path)}"${aria}`;

  if (field.kind === "number") {
    const min = field.min !== undefined ? ` min="${field.min}"` : "";
    const max = field.max !== undefined ? ` max="${field.max}"` : "";
    const step = field.step !== undefined ? ` step="${field.step}"` : "";
    return `<div class="field">${label}<input type="number" ${common}${min}${max}${step} value="${escapeHtml(String(value ?? ""))}">${help}${errorText}</div>`;
  }

  if (field.kind === "select") {
    const blank = field.nullable || field.optional ? `<option value="">None</option>` : "";
    const options = (field.options ?? [])
      .map((option) => `<option value="${escapeHtml(option)}"${String(value) === option ? " selected" : ""}>${escapeHtml(option)}</option>`)
      .join("");
    return `<div class="field">${label}<select ${common}>${blank}${options}</select>${help}${errorText}</div>`;
  }

  if (field.kind === "textarea") {
    return `<div class="field">${label}<textarea ${common} rows="4" spellcheck="false">${escapeHtml(String(value ?? ""))}</textarea>${help}${errorText}</div>`;
  }

  if (field.kind === "lines") {
    return `<div class="field">${label}<textarea ${common} rows="3" spellcheck="false" placeholder="One value per line">${escapeHtml(linesText(value))}</textarea>${help}${errorText}</div>`;
  }

  if (field.kind === "json") {
    return `<div class="field">${label}<textarea ${common} rows="5" spellcheck="false" aria-label="${escapeHtml(field.label)} JSON">${escapeHtml(jsonText(value))}</textarea>${help}${errorText}</div>`;
  }

  const maxLength = field.max !== undefined ? ` maxlength="${field.max}"` : "";
  return `<div class="field">${label}<input type="text" ${common}${maxLength} value="${escapeHtml(String(value ?? ""))}">${help}${errorText}</div>`;
}

function renderGroup(
  group: SettingsGroup,
  submitted: URLSearchParams | undefined,
  rendered: ReadonlySet<string> | undefined,
  errors: ReadonlyMap<string, string> | undefined,
): string {
  const fields = group.fields.map((field) => renderField(field, submitted, rendered, errors)).join("");
  const groups = group.groups
    .map((child) => renderGroup(child, submitted, rendered, errors))
    .join("");
  if (!fields && !groups) return "";
  return `<fieldset><legend>${escapeHtml(group.label)}</legend>${fields}${groups}</fieldset>`;
}

function auditChanges(record: AuditEventRecord): string {
  const data = record.data;
  const changes = data && typeof data === "object" ? (data as Record<string, unknown>).changes : undefined;
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return record.action;
  const paths = Object.keys(changes);
  if (paths.length === 0) return record.action;
  return paths.length > 6 ? `${paths.slice(0, 6).join(", ")} +${paths.length - 6} more` : paths.join(", ");
}

function auditAction(record: AuditEventRecord): string {
  if (record.action === "settings.update") return "Settings update";
  if (record.action === "settings.reset") return "Settings reset";
  if (record.action === "template.create") return "Template created";
  if (record.action === "template.update") return "Template updated";
  if (record.action === "template.delete") return "Template deleted";
  if (record.action === "api_token.issue") return "API token issued";
  if (record.action === "api_token.revoke") return "API token revoked";
  return record.action;
}

function auditTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${parsed.toISOString().replace("T", " ").slice(0, 19)} UTC`;
}

function renderAudit(records: readonly AuditEventRecord[]): string {
  if (records.length === 0) {
    return `<div class="panel"><h2>Audit trail</h2><p class="muted">No settings changes have been recorded for this module yet.</p></div>`;
  }
  const rows = records
    .map(
      (record) =>
        `<tr><td>${escapeHtml(auditTime(record.createdAt))}</td><td>${escapeHtml(record.actorId ?? "system")}</td><td>${escapeHtml(auditAction(record))}</td><td>${escapeHtml(auditChanges(record))}</td></tr>`,
    )
    .join("");
  return `<div class="panel"><h2>Audit trail</h2>
    <p class="muted">Newest first. Every accepted settings write appends one row; a rejected write writes nothing.</p>
    <table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Changed</th></tr></thead><tbody>${rows}</tbody></table>
  </div>`;
}

export interface SettingsRenderOptions {
  readonly saved?: boolean;
  readonly submitted?: URLSearchParams;
  readonly rendered?: ReadonlySet<string>;
  readonly fieldErrors?: ReadonlyMap<string, string>;
  readonly formError?: string;
  readonly history?: readonly AuditEventRecord[];
}

export function renderSettingsEditor(
  username: string,
  guild: DiscordGuild,
  module: DashboardModule,
  form: SettingsFormModel,
  csrfToken: string,
  options: SettingsRenderOptions = {},
): string {
  const action = `/dashboard/guilds/${encodePathSegment(guild.id)}/settings/${encodePathSegment(module.id)}`;
  const notice = options.saved
    ? `<div class="notice">Settings saved. The change is in the audit trail below.</div>`
    : "";
  const formError = options.formError
    ? `<div class="form-error">${escapeHtml(options.formError)}</div>`
    : "";
  return layout(
    `${module.name} settings`,
    `<p><a href="/dashboard/guilds/${encodePathSegment(guild.id)}">← Back to ${escapeHtml(guild.name)}</a></p>
     <h1>${escapeHtml(module.name)} settings</h1>
     <p class="muted">${escapeHtml(module.description)} · version ${escapeHtml(module.version)} · ${form.fields.length} fields · generated from this module's Zod schema</p>
     ${notice}${formError}
     <div class="panel">
       <p class="muted">Every value is parsed by the same schema the bot uses. Invalid input is rejected before anything is stored.</p>
       <form method="post" action="${action}">
         <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
         <input type="hidden" name="__rendered" value="${escapeHtml(form.rendered.join(","))}">
         ${form.groups.map((group) => renderGroup(group, options.submitted, options.rendered, options.fieldErrors)).join("")}
         <p><button type="submit">Save settings</button></p>
       </form>
     </div>
     ${renderAudit(options.history ?? [])}
     ${logoutForm(csrfToken)}`,
    username,
  );
}

export interface ApiTokenRenderOptions {
  readonly issued?: { readonly secret: string; readonly record: ApiTokenRecord };
  readonly revoked?: boolean;
}

function tokenStatus(record: ApiTokenRecord): string {
  if (record.revokedAt) return "revoked";
  if (record.expiresAt && Date.parse(record.expiresAt) <= Date.now()) return "expired";
  return "active";
}

export function renderApiTokens(
  username: string,
  guild: DiscordGuild,
  tokens: readonly ApiTokenRecord[],
  csrfToken: string,
  options: ApiTokenRenderOptions = {},
): string {
  const base = `/dashboard/guilds/${encodePathSegment(guild.id)}`;
  const issued = options.issued
    ? `<div class="notice">Token <strong>${escapeHtml(options.issued.record.name)}</strong> created. Copy it now; this is the only time it is shown.</div>
       <pre>${escapeHtml(options.issued.secret)}</pre>
       <p class="muted">Only its SHA-256 hash is stored. A lost token must be revoked and reissued.</p>`
    : "";
  const revoked = options.revoked
    ? `<div class="notice">Token revoked. Requests using it now return 401.</div>`
    : "";
  const rows = tokens
    .map((token) => {
      const status = tokenStatus(token);
      return `<tr>
        <td>${escapeHtml(token.name)}</td>
        <td>${token.scopes.map((scope) => `<code>${escapeHtml(scope)}</code>`).join(" ")}</td>
        <td>${escapeHtml(status)}</td>
        <td>${escapeHtml(token.lastUsedAt ?? "never")}</td>
        <td>${escapeHtml(token.expiresAt ?? "never")}</td>
        <td>${
          status === "active"
            ? `<form method="post" action="${base}/tokens/${encodePathSegment(token.id)}/revoke"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><button type="submit">Revoke</button></form>`
            : ""
        }</td>
      </tr>`;
    })
    .join("");
  return layout(
    "API tokens",
    `<p><a href="${base}">← Back to ${escapeHtml(guild.name)}</a></p>
     <h1>API tokens</h1>
     <p class="muted">Tokens are scoped to <strong>${escapeHtml(guild.name)}</strong> and a subset of three API scopes. The secret is shown once; only a SHA-256 hash is stored. Revocation takes effect on the next request.</p>
     ${issued}${revoked}
     <div class="panel"><h2>Create a token</h2>
       <form method="post" action="${base}/tokens">
         <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
         <div class="field"><label for="token-name">Name</label><input id="token-name" name="name" type="text" maxlength="80" required></div>
         <fieldset><legend>Scopes</legend>
           <div class="field check"><input id="scope-guild" name="scope" type="checkbox" value="guild:read" checked><label for="scope-guild">guild:read — guild list, overview and module settings</label></div>
           <div class="field check"><input id="scope-analytics" name="scope" type="checkbox" value="analytics:read"><label for="scope-analytics">analytics:read — bounded analytics aggregates</label></div>
           <div class="field check"><input id="scope-settings" name="scope" type="checkbox" value="settings:write"><label for="scope-settings">settings:write — module settings PATCH</label></div>
         </fieldset>
         <div class="field"><label for="token-days">Lifetime (days)</label><input id="token-days" name="expiresInDays" type="number" min="1" max="365" value="30" required><small>1–365 days.</small></div>
         <p><button type="submit">Create token</button></p>
       </form>
     </div>
     <div class="panel"><h2>Issued tokens</h2>
       ${tokens.length === 0 ? `<p class="muted">No tokens have been issued for this server.</p>` : `<table><thead><tr><th>Name</th><th>Scopes</th><th>Status</th><th>Last used</th><th>Expires</th><th></th></tr></thead><tbody>${rows}</tbody></table>`}
     </div>
     ${logoutForm(csrfToken)}`,
    username,
  );
}

export interface InstanceView {
  readonly databaseMode: "memory" | "postgres";
  readonly oauthConfigured: boolean;
  readonly secureCookies: boolean;
  readonly sessionTtlMs: number;
  readonly rotationIntervalMs: number;
  readonly owners: readonly string[];
  readonly rateLimits: RateLimitPolicies;
}

function duration(value: number): string {
  const seconds = Math.round(value / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 120 ? `${minutes}m` : `${Math.round(minutes / 60)}h`;
}

export function renderInstance(
  username: string,
  view: InstanceView,
  csrfToken: string,
  revoked?: number,
): string {
  const owners =
    view.owners.length === 0
      ? `<p class="muted">No owners are configured. Set <code>WEB_OWNER_IDS</code> and restart the web process.</p>`
      : `<ul>${view.owners.map((owner) => `<li><code>${escapeHtml(owner)}</code></li>`).join("")}</ul>`;
  const limits = (Object.keys(view.rateLimits) as Array<keyof RateLimitPolicies>)
    .map((id) => {
      const policy = view.rateLimits[id];
      return `<tr><td>${escapeHtml(id)}</td><td>${policy.max}</td><td>${duration(policy.windowMs)}</td></tr>`;
    })
    .join("");
  const notice =
    revoked === undefined
      ? ""
      : `<div class="notice">Signed out ${revoked} dashboard session(s) for that user id.</div>`;
  return layout(
    "Instance",
    `<p><a href="/">← Back to Keystone</a></p>
     <h1>Instance</h1>
     <p class="muted">Deployment-wide facts and actions. This page is limited to the Discord user ids in <code>WEB_OWNER_IDS</code>; managing one server is not instance ownership.</p>
     ${notice}
     <div class="panel"><h2>Deployment</h2>
       <table><tbody>
         <tr><th>Database</th><td>${escapeHtml(view.databaseMode)}</td></tr>
         <tr><th>Discord OAuth</th><td>${view.oauthConfigured ? "configured" : "not configured"}</td></tr>
         <tr><th>Secure cookies</th><td>${view.secureCookies ? "yes" : "no (local HTTP)"}</td></tr>
         <tr><th>Session lifetime</th><td>${duration(view.sessionTtlMs)} absolute</td></tr>
         <tr><th>Session rotation</th><td>${view.rotationIntervalMs > 0 ? `every ${duration(view.rotationIntervalMs)} on a page load` : "disabled"}</td></tr>
       </tbody></table>
     </div>
     <div class="panel"><h2>Owners</h2>${owners}</div>
     <div class="panel"><h2>Rate limits</h2>
       <p class="muted">Fixed window per identity: a signed-in user, or the client address for anonymous routes. <code>/healthz</code> is exempt.</p>
       <table><thead><tr><th>Route class</th><th>Requests</th><th>Window</th></tr></thead><tbody>${limits}</tbody></table>
     </div>
     <div class="panel"><h2>End a user's sessions</h2>
       <p class="muted">Deletes every dashboard session row for the Discord user id and clears their cookies on the next request. Their Discord grant is untouched.</p>
       <form method="post" action="/dashboard/instance/sessions/revoke">
         <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
         <div class="field"><label for="userId">Discord user id</label><input id="userId" name="userId" type="text" inputmode="numeric" autocomplete="off" required></div>
         <p><button type="submit">Sign out every session</button></p>
       </form>
     </div>
     ${logoutForm(csrfToken)}`,
    username,
  );
}

export function renderError(title: string, message: string): string {
  return layout(
    title,
    `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><a href="/">Back to Keystone</a></p>`,
  );
}
