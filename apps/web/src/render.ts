import type { AuditEventRecord } from "@keystone/kernel";
import type { DashboardModule, DashboardView } from "./overview";
import type { DiscordGuild } from "./oauth";
import { encodePathSegment } from "./http";
import type { SettingsField, SettingsFormModel, SettingsGroup } from "./settings-form";

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

export function renderLanding(username?: string, csrfToken?: string): string {
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
     <div class="panel"><h2>Portability</h2>${latest}</div>
     ${modules}
     <p class="muted">Settings are validated by each module's own schema. Templates and fleet controls remain open.</p>
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

export function renderError(title: string, message: string): string {
  return layout(
    title,
    `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><a href="/">Back to Keystone</a></p>`,
  );
}
