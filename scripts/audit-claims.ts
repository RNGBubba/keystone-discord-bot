/**
 * `pnpm audit:claims` — make the prose answer to the code.
 *
 * `memory:check` proves the machine files are shaped correctly and the vault
 * links resolve. It cannot tell that AGENTS.md says "twelve roots" while the
 * registry registers twenty, or that `/help changelog` still points at pass 26.
 * This script computes the facts from the same registry the bot uses and checks
 * the sentences that claim them. It is part of `pnpm check`.
 *
 * Rules of the road:
 * - Historical counts are allowed when they say "at pass N" / "was"; this audit
 *   only owns current-tense claims and the latest-pass pointer.
 * - A capability that has no code (Components V2 / `packages/ui`) must be
 *   labelled planned in every document that mentions it.
 * - Never invent a number to satisfy the audit; change the prose to point at the
 *   generated source instead.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ModuleRegistry, auditBudget } from "@keystone/kernel";
import { modules } from "../apps/bot/src/modules";
import { CHANGELOG, LATEST_PASS } from "../modules/diagnostics/src/changelog";

const root = path.resolve(import.meta.dirname, "..");
const checks: string[] = [];
const failures: string[] = [];

function check(label: string, ok: boolean, detail: string): void {
  checks.push(label);
  if (!ok) failures.push(detail);
}

async function read(relative: string): Promise<string> {
  return readFile(path.join(root, relative), "utf8");
}

async function readJson<T>(relative: string): Promise<T> {
  return JSON.parse(await read(relative)) as T;
}

function passNumber(id: string): number {
  return Number((id.match(/[0-9]+$/) ?? ["0"])[0]);
}

interface Project {
  updatedAt: string;
  lastPass: string;
  metrics: {
    commands: number;
    subcommands: number;
    actions: number;
    contextMenus: number;
    modules: number;
    tests: number;
  };
}

interface PassEntry {
  id: string;
  date: string;
  journal: string;
  checks?: { tests?: string };
}

interface TestReport {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  success: boolean;
  testResults: unknown[];
}

interface Feature {
  id: string;
  status: string;
  note?: string;
}

interface FeatureFile {
  domains: { features: Feature[] }[];
}

const report = auditBudget(new ModuleRegistry().registerAll(modules));
const project = await readJson<Project>("memory/machine/project.json");
const passes = (await readJson<{ passes: PassEntry[] }>("memory/machine/passes.json")).passes;
const latest = [...passes].sort((a, b) => passNumber(a.id) - passNumber(b.id)).at(-1);

// The suite writes this file, so the documented test count is measured rather
// than trusted. `pnpm check` runs tests before this audit; a standalone audit
// on a clean tree asks for `pnpm test` instead of guessing.
const testReportPath = "memory/machine/test-report.json";
const testReport = existsSync(path.join(root, testReportPath))
  ? await readJson<TestReport>(testReportPath)
  : undefined;
const measuredTests = testReport?.numTotalTests;
const measuredFiles = testReport?.testResults.length;
check(
  "test report exists and passed",
  Boolean(testReport && testReport.success && testReport.numFailedTests === 0 && testReport.numPassedTests === testReport.numTotalTests),
  `no passing ${testReportPath}; run \`pnpm test\` before \`pnpm audit:claims\``,
);
check(
  "project.metrics.tests matches the runner",
  Boolean(testReport && project.metrics.tests === measuredTests),
  `project.metrics.tests is ${project.metrics.tests}, the test runner reports ${measuredTests ?? "<no report>"}`,
);

// --- registry vs machine metrics ------------------------------------------
check(
  "project.metrics.commands equals the registry",
  project.metrics.commands === report.commands,
  `project.metrics.commands is ${project.metrics.commands}, registry has ${report.commands}`,
);
check(
  "project.metrics.subcommands equals the registry",
  project.metrics.subcommands === report.subcommands,
  `project.metrics.subcommands is ${project.metrics.subcommands}, registry has ${report.subcommands}`,
);
check(
  "project.metrics.actions equals the registry",
  project.metrics.actions === report.actions,
  `project.metrics.actions is ${project.metrics.actions}, registry has ${report.actions}`,
);
check(
  "project.metrics.contextMenus equals the registry",
  project.metrics.contextMenus === report.contextMenus,
  `project.metrics.contextMenus is ${project.metrics.contextMenus}, registry has ${report.contextMenus}`,
);
check(
  "project.metrics.modules equals the catalog",
  project.metrics.modules === modules.length,
  `project.metrics.modules is ${project.metrics.modules}, catalog has ${modules.length}`,
);


// --- AGENTS.md current-state bullet ---------------------------------------
const agents = await read("AGENTS.md");
check(
  "AGENTS.md names the current root count",
  agents.includes(`- **The command budget is a gate.** ${report.commands} global roots are used;`),
  `AGENTS.md no longer states the current ${report.commands}-root count in the budget rule`,
);
const agentsState = agents.match(
  /- (\d+) modules, (\d+) global command roots, (\d+) subcommands, (\d+) context menus, (\d+)\s+tests in (\d+) files\./,
);
check(
  "AGENTS.md current-state counts match the code",
  Boolean(
    agentsState &&
      Number(agentsState[1]) === modules.length &&
      Number(agentsState[2]) === report.commands &&
      Number(agentsState[3]) === report.subcommands &&
      Number(agentsState[4]) === report.contextMenus &&
      Number(agentsState[5]) === measuredTests &&
      Number(agentsState[6]) === measuredFiles,
  ),
  agentsState
    ? `AGENTS.md says ${agentsState[1]} modules / ${agentsState[2]} roots / ${agentsState[3]} subcommands / ${agentsState[4]} menus / ${agentsState[5]} tests in ${agentsState[6]} files; code has ${modules.length} / ${report.commands} / ${report.subcommands} / ${report.contextMenus} / ${measuredTests ?? "<no report>"} / ${measuredFiles ?? "<no report>"}`
    : "AGENTS.md is missing the current-state counts bullet",
);

// --- README current-tense claims ------------------------------------------
const readme = await read("README.md");
const readmeClaims: { pattern: RegExp; expected: number; label: string }[] = [
  { pattern: /\*\*(\d+)\/100 roots\*\*/g, expected: report.commands, label: "roots" },
  { pattern: /\*\*(\d+) real subcommands\*\*/g, expected: report.subcommands, label: "subcommands" },
  { pattern: /\*\*(\d+) actions\*\*/g, expected: report.actions, label: "actions" },
  { pattern: /\*\*(\d+) modules\*\*/g, expected: modules.length, label: "modules" },
];
for (const claim of readmeClaims) {
  const found = [...readme.matchAll(claim.pattern)];
  check(
    `README.md current ${claim.label} claim`,
    found.length > 0 && found.every((match) => Number(match[1]) === claim.expected),
    found.length === 0
      ? `README.md has no current ${claim.label} claim`
      : `README.md says ${found.map((match) => match[1]).join(", ")} ${claim.label}; code has ${claim.expected}`,
  );
}
const readmeTests = readme.match(/\*\*(\d+) tests across (\d+) files\*\*/);
check(
  "README.md current test claim",
  Boolean(readmeTests && Number(readmeTests[1]) === measuredTests && Number(readmeTests[2]) === measuredFiles),
  readmeTests
    ? `README.md says ${readmeTests[1]} tests in ${readmeTests[2]} files; the runner reports ${measuredTests ?? "<no report>"} in ${measuredFiles ?? "<no report>"}`
    : "README.md has no current test claim",
);

// --- latest pass pointer ---------------------------------------------------
check(
  "project.lastPass points at the latest pass",
  Boolean(latest && project.lastPass === latest.journal),
  `project.lastPass is ${project.lastPass}; latest pass journal is ${latest?.journal ?? "<none>"}`,
);
check(
  "changelog LATEST_PASS matches the pass ledger",
  Boolean(latest && LATEST_PASS === latest.id),
  `changelog LATEST_PASS is ${LATEST_PASS}; latest pass is ${latest?.id ?? "<none>"}`,
);
const newest = CHANGELOG[0];
check(
  "changelog newest entry matches the latest pass",
  Boolean(newest && latest && newest.pass === latest.id && newest.date === latest.date),
  newest
    ? `changelog newest is ${newest.pass} (${newest.date}); latest pass is ${latest?.id} (${latest?.date})`
    : "changelog is empty",
);
check(
  "changelog journal exists",
  Boolean(newest && existsSync(path.join(root, newest.journal))),
  `changelog journal does not exist: ${newest?.journal ?? "<none>"}`,
);
check(
  "changelog entries name real passes",
  CHANGELOG.every((entry) => passes.some((pass) => pass.id === entry.pass)),
  "a changelog entry names a pass that is not in memory/machine/passes.json",
);

// --- capability claims with no code ---------------------------------------
const v2Package = existsSync(path.join(root, "packages/ui"));
const adapter = await read("apps/bot/src/adapt.ts");
const v2Code = v2Package || adapter.includes("IsComponentsV2");
const features = await readJson<FeatureFile>("memory/machine/features.json");
const shippedV2 = features.domains
  .flatMap((domain) => domain.features)
  .filter((feature) => feature.status === "shipped-in-repo" && /Components V2|V2 panel/.test(feature.note ?? ""));
check(
  "no shipped feature claims Components V2 without code",
  v2Code || shippedV2.length === 0,
  `features.json claims V2 for shipped rows (${shippedV2.map((feature) => feature.id).join(", ")}) but no packages/ui or IsComponentsV2 exists`,
);

/** Every `packages/ui` mention must be future-tense while the package is absent. */
const uiClaimFiles = [
  "README.md",
  "AGENTS.md",
  "memory/vault/01-Mission/Master-Plan.md",
  "memory/vault/01-Mission/Roadmap.md",
  "memory/vault/03-Architecture/Command-Budget.md",
  "memory/vault/05-Learning/Curriculum.md",
  "memory/vault/02-Research/Platform-2026.md",
  "memory/vault/02-Research/Platform-Limits.md",
];
const futureMarker = /planned|future|will\b|not exist|no `packages\/ui`|when it exists|P7|post-v1/i;
for (const file of uiClaimFiles) {
  if (!existsSync(path.join(root, file))) continue;
  const lines = (await read(file)).split("\n");
  lines.forEach((line, index) => {
    if (!line.includes("packages/ui")) return;
    const context = [lines[index - 1] ?? "", line, lines[index + 1] ?? ""].join(" ");
    check(
      `${file}:${index + 1} marks packages/ui as future work`,
      v2Package || futureMarker.test(context),
      `${file}:${index + 1} mentions packages/ui without a planned/future marker while the package does not exist`,
    );
  });
}

// --- report ---------------------------------------------------------------
const passed = checks.length - failures.length;
console.log(
  `claims: ${passed}/${checks.length} checks passed ` +
    `(${report.commands} roots · ${report.subcommands} subcommands · ${report.actions} actions · ` +
    `${report.contextMenus} menus · ${modules.length} modules · ${project.metrics.tests} tests)`,
);
if (failures.length > 0) {
  console.error("\nFix the prose or the machine file; do not weaken this audit.\n");
  for (const failure of failures) console.error(`  x ${failure}`);
  process.exitCode = 1;
}
